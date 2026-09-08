import { z } from "zod";
import { InferenceProviderError, type InferenceProvider } from "./inference-router";
import { InferenceUsageSchema } from "./inference-budget";

const capabilities = {
  text: true,
  image: false,
  structuredOutput: true,
  cancellation: true,
  usage: true,
};
const Count = z.number().int().nonnegative().safe();
async function jsonResponse(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  const response = await fetcher(url, {
    ...init,
    redirect: "error",
    credentials: "omit",
    cache: "no-store",
  });
  if (!response.ok)
    throw new InferenceProviderError(response.status === 429 ? "RATE_LIMITED" : "PROVIDER_FAILED");
  if (Number(response.headers.get("content-length")) > 1_000_000) {
    await response.body?.cancel();
    throw new InferenceProviderError("INVALID_OUTPUT");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new InferenceProviderError("INVALID_OUTPUT");
  let size = 0;
  let text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1_000_000) {
        await reader.cancel();
        throw new InferenceProviderError("INVALID_OUTPUT");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch {
    throw new InferenceProviderError("INVALID_OUTPUT");
  } finally {
    reader.releaseLock();
  }
}
function parseOutput(text: string, usage: unknown): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new InferenceProviderError("INVALID_OUTPUT", usage);
  }
}
export function createOpenAiInferenceProvider(options: {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}): InferenceProvider {
  const key = z.string().trim().min(1).max(500).parse(options.apiKey);
  const model = z
    .string()
    .regex(/^[a-zA-Z0-9_.:-]{1,200}$/)
    .parse(options.model);
  return {
    id: "OPENAI",
    model,
    capabilities,
    inputCeiling: 100_000,
    outputCeiling: 8192,
    async invoke(input) {
      const raw = await jsonResponse(
        options.fetch ?? fetch,
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          signal: input.signal,
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            store: false,
            instructions: input.instructions,
            input: JSON.stringify(input.request),
            max_output_tokens: input.maxOutputTokens,
            tools: [],
            text: {
              format: {
                type: "json_schema",
                name: input.request.task.toLowerCase(),
                strict: true,
                schema: input.schema,
              },
            },
          }),
        },
      );
      const response = z
        .object({
          status: z.string(),
          model: z.string(),
          output: z.array(
            z.object({
              type: z.string(),
              content: z
                .array(z.object({ type: z.string(), text: z.string().optional() }))
                .optional(),
            }),
          ),
          usage: z
            .object({
              input_tokens: Count,
              output_tokens: Count,
              output_tokens_details: z.object({ reasoning_tokens: Count }).optional(),
            })
            .nullable()
            .optional(),
        })
        .safeParse(raw);
      if (!response.success) throw new InferenceProviderError("INVALID_OUTPUT");
      const value = response.data;
      const usage = value.usage
        ? {
            inputTokens: value.usage.input_tokens,
            outputTokens: value.usage.output_tokens,
            reasoningTokens: value.usage.output_tokens_details?.reasoning_tokens ?? null,
          }
        : null;
      if (value.status !== "completed") throw new InferenceProviderError("REFUSED", usage);
      if (value.output.some((x) => x.type !== "message" && x.type !== "reasoning"))
        throw new InferenceProviderError("INVALID_OUTPUT", usage);
      const parts = value.output.flatMap((x) => x.content ?? []);
      if (parts.some((x) => x.type !== "output_text"))
        throw new InferenceProviderError("REFUSED", usage);
      const text = parts.map((x) => x.text ?? "").join("");
      return { output: parseOutput(text, usage), usage, modelVersion: value.model };
    },
  };
}
export function createGeminiInferenceProvider(options: {
  apiKey: string;
  fetch?: typeof fetch;
}): InferenceProvider {
  const key = z.string().trim().min(1).max(500).parse(options.apiKey);
  const model = "gemini-3.1-flash-lite";
  return {
    id: "GEMINI",
    model,
    capabilities,
    inputCeiling: 100_000,
    outputCeiling: 8192,
    async invoke(input) {
      const raw = await jsonResponse(
        options.fetch ?? fetch,
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          signal: input.signal,
          headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: input.instructions }] },
            contents: [{ role: "user", parts: [{ text: JSON.stringify(input.request) }] }],
            generationConfig: {
              candidateCount: 1,
              maxOutputTokens: input.maxOutputTokens,
              responseMimeType: "application/json",
              responseJsonSchema: input.schema,
            },
          }),
        },
      );
      const response = z
        .object({
          modelVersion: z.string(),
          candidates: z.array(
            z.object({
              finishReason: z.string(),
              content: z.object({
                parts: z.array(
                  z.object({
                    text: z.string().optional(),
                    thought: z.boolean().optional(),
                    functionCall: z.unknown().optional(),
                  }),
                ),
              }),
            }),
          ),
          usageMetadata: z
            .object({
              promptTokenCount: Count,
              candidatesTokenCount: Count,
              totalTokenCount: Count,
              thoughtsTokenCount: Count.optional(),
            })
            .optional(),
        })
        .safeParse(raw);
      if (!response.success) throw new InferenceProviderError("INVALID_OUTPUT");
      const value = response.data;
      const counts = value.usageMetadata;
      const reasoning = counts?.thoughtsTokenCount ?? 0;
      const usage =
        counts &&
        counts.totalTokenCount === counts.promptTokenCount + counts.candidatesTokenCount + reasoning
          ? {
              inputTokens: counts.promptTokenCount,
              outputTokens: counts.candidatesTokenCount + reasoning,
              reasoningTokens: reasoning,
            }
          : null;
      const candidate = value.candidates[0];
      if (value.candidates.length !== 1 || candidate?.finishReason !== "STOP")
        throw new InferenceProviderError("REFUSED", usage);
      if (candidate.content.parts.some((x) => x.functionCall !== undefined))
        throw new InferenceProviderError("INVALID_OUTPUT", usage);
      const text = candidate.content.parts
        .filter((x) => !x.thought)
        .map((x) => x.text ?? "")
        .join("");
      return { output: parseOutput(text, usage), usage, modelVersion: value.modelVersion };
    },
  };
}
export const LOCAL_MODEL = "qwen3:1.7b";
export const LOCAL_MODEL_CANDIDATES = [LOCAL_MODEL, "qwen3:4b-instruct-2507-q4_K_M"] as const;
export const LOCAL_ORIGIN = "http://127.0.0.1:11434";
// Ollama's grammar compiler expands nested bounded repeats and can reject our full
// validation schema. Keep object/types/enums in its grammar; enforce ALL original
// length, reference and cardinality constraints after generation in the router.
function localGrammar(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(localGrammar);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !["$schema", "minLength", "maxLength", "minItems", "maxItems", "pattern"].includes(key),
        )
        .map(([key, child]) => [key, localGrammar(child)]),
    );
  return value;
}
const LocalTags = z.object({
  models: z
    .array(
      z.object({
        name: z.string(),
        digest: z.string().regex(/^[a-f0-9]{64}$/),
        size: Count,
        details: z.object({ quantization_level: z.string(), parameter_size: z.string() }),
      }),
    )
    .max(100),
});
export async function inspectLocalModel(
  fetcher: typeof fetch = fetch,
  signal = AbortSignal.timeout(3000),
  modelName: (typeof LOCAL_MODEL_CANDIDATES)[number] = LOCAL_MODEL,
) {
  const raw = await jsonResponse(fetcher, `${LOCAL_ORIGIN}/api/tags`, { signal });
  const model = LocalTags.parse(raw).models.find((x) => x.name === modelName);
  if (!model) throw new Error("LOCAL_MODEL_NOT_INSTALLED");
  return model;
}
export function createLocalInferenceProvider(options: {
  digest: string;
  model?: (typeof LOCAL_MODEL_CANDIDATES)[number];
  fetch?: typeof fetch;
}): InferenceProvider {
  const model = z.enum(LOCAL_MODEL_CANDIDATES).parse(options.model ?? LOCAL_MODEL);
  const digest = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(options.digest);
  const fetcher = options.fetch ?? fetch;
  return {
    id: "LOCAL",
    model,
    capabilities,
    inputCeiling: 7168,
    outputCeiling: 1024,
    async invoke(input) {
      const installed = await inspectLocalModel(fetcher, input.signal, model);
      if (installed.digest !== digest) throw new InferenceProviderError("PROVIDER_FAILED");
      const raw = await jsonResponse(fetcher, `${LOCAL_ORIGIN}/api/chat`, {
        method: "POST",
        signal: input.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          ...(model === LOCAL_MODEL ? { think: false } : {}),
          keep_alive: "1m",
          format: localGrammar(input.schema),
          messages: [
            {
              role: "system",
              content: `${input.instructions}\nOutput JSON schema: ${JSON.stringify(localGrammar(input.schema))}`,
            },
            { role: "user", content: JSON.stringify(input.request) },
          ],
          options: { num_ctx: 8192, num_predict: input.maxOutputTokens, temperature: 0, seed: 7 },
        }),
      });
      const result = z
        .object({
          model: z.literal(model),
          done: z.literal(true),
          done_reason: z.string(),
          message: z.object({
            content: z.string(),
            thinking: z.string().optional(),
            tool_calls: z.array(z.unknown()).optional(),
          }),
          prompt_eval_count: Count,
          eval_count: Count,
        })
        .safeParse(raw);
      if (!result.success) throw new InferenceProviderError("INVALID_OUTPUT");
      const value = result.data;
      const usage = InferenceUsageSchema.parse({
        inputTokens: value.prompt_eval_count,
        outputTokens: value.eval_count,
        reasoningTokens: 0,
      });
      if (
        value.done_reason !== "stop" ||
        value.message.tool_calls?.length ||
        value.message.thinking
      )
        throw new InferenceProviderError("INVALID_OUTPUT", usage);
      return { output: parseOutput(value.message.content, usage), usage, modelVersion: digest };
    },
  };
}
export function createInferenceFixtureProvider(
  responder: InferenceProvider["invoke"],
): InferenceProvider {
  return {
    id: "FIXTURE",
    model: "agent-fixture-v1",
    capabilities,
    inputCeiling: 100_000,
    outputCeiling: 8192,
    invoke: responder,
  };
}
