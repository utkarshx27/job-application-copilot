import { z } from "zod";
import {
  inferenceInstructions,
  INFERENCE_PROMPT_VERSION,
  inferenceJsonSchema,
  InferenceRequestSchema,
  validateInferenceOutput,
  type InferenceRequest,
  type InferenceOutput,
} from "./agent-contracts";
import {
  PriceSnapshotSchema,
  costMicros,
  reserveInference,
  settleInference,
  type InferenceBudgetStore,
  type PriceSnapshot,
} from "./inference-budget";

export type InferenceProviderId = "OPENAI" | "GEMINI" | "LOCAL" | "FIXTURE";
export interface InferenceProvider {
  id: InferenceProviderId;
  model: string;
  inputCeiling: number;
  outputCeiling: number;
  capabilities: {
    text: boolean;
    image: boolean;
    structuredOutput: boolean;
    cancellation: boolean;
    usage: boolean;
  };
  invoke(input: {
    request: InferenceRequest;
    instructions: string;
    schema: Record<string, unknown>;
    maxOutputTokens: number;
    signal: AbortSignal;
  }): Promise<{ output: unknown; usage: unknown; modelVersion: string }>;
}
export class InferenceProviderError extends Error {
  constructor(
    readonly code: "RATE_LIMITED" | "PROVIDER_FAILED" | "INVALID_OUTPUT" | "REFUSED",
    readonly usage: unknown = null,
  ) {
    super(code);
  }
}
const Options = z
  .object({
    runId: z.uuid(),
    localOnly: z.boolean(),
    approvedCloudProviders: z.array(z.enum(["OPENAI", "GEMINI"])).max(2),
    maxInputTokens: z.number().int().min(256).max(100_000),
    maxOutputTokens: z.number().int().min(64).max(8192),
    timeoutMs: z.number().int().min(10).max(60_000),
    retries: z.number().int().min(0).max(2),
  })
  .strict();
export type InferenceOptions = z.infer<typeof Options>;
export class InferenceRouter {
  constructor(private readonly budgets: InferenceBudgetStore) {}
  async execute(
    provider: InferenceProvider,
    requestInput: InferenceRequest,
    priceInput: PriceSnapshot,
    optionsInput: InferenceOptions,
    signal?: AbortSignal,
  ): Promise<{ output: InferenceOutput; modelVersion: string; promptVersion: string }> {
    const options = Options.parse(optionsInput);
    const request = InferenceRequestSchema.parse(requestInput);
    const price = PriceSnapshotSchema.parse(priceInput);
    const cloud = provider.id === "OPENAI" || provider.id === "GEMINI";
    if (
      cloud &&
      (options.localOnly ||
        !options.approvedCloudProviders.includes(provider.id as "OPENAI" | "GEMINI"))
    )
      throw new Error("CLOUD_NOT_APPROVED");
    if (
      !provider.capabilities.text ||
      !provider.capabilities.structuredOutput ||
      !provider.capabilities.cancellation ||
      !provider.capabilities.usage
    )
      throw new Error("UNSUPPORTED_CAPABILITY");
    if (
      price.provider !== provider.id ||
      price.model !== provider.model ||
      Date.parse(price.checkedAt) > Date.now() ||
      Date.parse(price.expiresAt) <= Date.now()
    )
      throw new Error("INVALID_PRICE_SNAPSHOT");
    const schema = inferenceJsonSchema(request);
    const instructions = inferenceInstructions(request.task);
    if (
      options.maxInputTokens > provider.inputCeiling ||
      options.maxOutputTokens > provider.outputCeiling
    )
      throw new Error("UNSUPPORTED_TOKEN_LIMIT");
    // Conservative preflight, not a provider billing count. Reserve the entire configured input ceiling.
    if (
      new TextEncoder().encode(
        JSON.stringify({
          request,
          schema,
          instructions,
        }),
      ).length +
        1024 >
      options.maxInputTokens
    )
      throw new Error("INPUT_LIMIT");
    for (let index = 0; index <= options.retries; index++) {
      if (signal?.aborted) throw new Error("CANCELLED");
      const id = crypto.randomUUID();
      await this.budgets.update(options.runId, (current) =>
        reserveInference(
          current,
          {
            id,
            provider: provider.id,
            model: provider.model,
            reservedMicros: costMicros(price, options.maxInputTokens, options.maxOutputTokens),
            chargedMicros: null,
            maxInputTokens: options.maxInputTokens,
            maxOutputTokens: options.maxOutputTokens,
            price,
            status: "PENDING",
            usage: null,
          },
          Date.now(),
        ),
      );
      const controller = new AbortController();
      let timedOut = false;
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) controller.abort();
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, options.timeoutMs);
      let usage: unknown = null;
      let result:
        { output: InferenceOutput; modelVersion: string; promptVersion: string } | undefined;
      let failure: unknown;
      try {
        const response = await new Promise<Awaited<ReturnType<InferenceProvider["invoke"]>>>(
          (resolve, reject) => {
            const rejectAbort = () => reject(new Error(timedOut ? "TIMEOUT" : "CANCELLED"));
            if (controller.signal.aborted) {
              rejectAbort();
              return;
            }
            controller.signal.addEventListener("abort", rejectAbort, { once: true });
            provider
              .invoke({
                request,
                instructions,
                schema,
                maxOutputTokens: options.maxOutputTokens,
                signal: controller.signal,
              })
              .then(resolve, reject)
              .finally(() => controller.signal.removeEventListener("abort", rejectAbort));
          },
        );
        usage = response.usage;
        result = {
          output: validateInferenceOutput(request, response.output),
          modelVersion: response.modelVersion,
          promptVersion: INFERENCE_PROMPT_VERSION,
        };
      } catch (error) {
        failure = error;
        if (error instanceof InferenceProviderError) usage = error.usage;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
      const state = await this.budgets.update(options.runId, (current) =>
        settleInference(current, id, usage, !!result),
      );
      if (state.attempts.at(-1)?.status === "UNKNOWN") throw new Error("METERING_UNKNOWN");
      if (signal?.aborted) throw new Error("CANCELLED");
      if (result) return result;
      if (
        !(failure instanceof InferenceProviderError) ||
        failure.code !== "RATE_LIMITED" ||
        index >= options.retries
      )
        throw new Error(
          failure instanceof InferenceProviderError ? failure.code : "INVALID_OUTPUT",
        );
      // Only an explicitly metered rate limit may retry. No provider switching or hidden cloud fallback.
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("CANCELLED"));
          return;
        }
        const cancel = () => {
          clearTimeout(wait);
          reject(new Error("CANCELLED"));
        };
        const wait = setTimeout(
          () => {
            signal?.removeEventListener("abort", cancel);
            resolve();
          },
          100 * 2 ** index,
        );
        signal?.addEventListener("abort", cancel, { once: true });
      });
    }
    throw new Error("PROVIDER_FAILED");
  }
}
