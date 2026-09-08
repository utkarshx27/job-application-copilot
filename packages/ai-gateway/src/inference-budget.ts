import { z } from "zod";

const Count = z.number().int().nonnegative().safe();
export const PriceSnapshotSchema = z
  .object({
    provider: z.enum(["OPENAI", "GEMINI", "LOCAL", "FIXTURE"]),
    model: z.string().min(1).max(200),
    checkedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    source: z.string().min(1).max(500),
    inputUsdPerMillion: z.number().finite().nonnegative().max(1000),
    outputUsdPerMillion: z.number().finite().nonnegative().max(1000),
  })
  .strict();
export const InferenceUsageSchema = z
  .object({
    inputTokens: Count,
    outputTokens: Count,
    reasoningTokens: Count.nullable(),
  })
  .strict()
  .refine(
    (x) => x.reasoningTokens === null || x.reasoningTokens <= x.outputTokens,
    "Reasoning is a subset of billed output",
  );
export type InferenceUsage = z.infer<typeof InferenceUsageSchema>;
export type PriceSnapshot = z.infer<typeof PriceSnapshotSchema>;
export function costMicros(price: PriceSnapshot, input: number, output: number) {
  return Math.ceil(input * price.inputUsdPerMillion + output * price.outputUsdPerMillion);
}
const AttemptSchema = z
  .object({
    id: z.uuid(),
    provider: PriceSnapshotSchema.shape.provider,
    model: z.string(),
    reservedMicros: Count,
    chargedMicros: Count.nullable(),
    maxInputTokens: Count,
    maxOutputTokens: Count,
    price: PriceSnapshotSchema,
    status: z.enum(["PENDING", "OK", "FAILED", "UNKNOWN"]),
    usage: InferenceUsageSchema.nullable(),
  })
  .strict();
export const InferenceBudgetSchema = z
  .object({
    version: z.literal(1),
    runId: z.uuid(),
    maxCostMicros: Count.max(5_000_000),
    maxAttempts: Count.min(1).max(50),
    expiresAt: Count,
    attempts: z.array(AttemptSchema).max(50),
  })
  .strict();
export type InferenceBudget = z.infer<typeof InferenceBudgetSchema>;
export function reserveInference(
  state: InferenceBudget,
  attempt: z.infer<typeof AttemptSchema>,
  now: number,
): InferenceBudget {
  const budget = InferenceBudgetSchema.parse(state);
  const next = AttemptSchema.parse(attempt);
  if (
    next.price.provider !== next.provider ||
    next.price.model !== next.model ||
    next.reservedMicros !== costMicros(next.price, next.maxInputTokens, next.maxOutputTokens)
  )
    throw new Error("INVALID_RESERVATION");
  if (budget.expiresAt <= now || budget.attempts.length >= budget.maxAttempts)
    throw new Error("BUDGET_EXHAUSTED");
  if (budget.attempts.some((x) => x.status === "UNKNOWN" || x.status === "PENDING"))
    throw new Error("METERING_UNRESOLVED");
  const used = budget.attempts.reduce((sum, x) => sum + (x.chargedMicros ?? x.reservedMicros), 0);
  if (used + next.reservedMicros > budget.maxCostMicros) throw new Error("BUDGET_EXHAUSTED");
  if (
    next.status !== "PENDING" ||
    next.chargedMicros !== null ||
    next.usage !== null ||
    budget.attempts.some((x) => x.id === next.id)
  )
    throw new Error("INVALID_RESERVATION");
  return InferenceBudgetSchema.parse({ ...budget, attempts: [...budget.attempts, next] });
}
export function settleInference(
  state: InferenceBudget,
  id: string,
  usageInput: unknown,
  ok: boolean,
): InferenceBudget {
  const budget = InferenceBudgetSchema.parse(state);
  const attempt = budget.attempts.find((x) => x.id === id);
  if (!attempt || attempt.status !== "PENDING") throw new Error("INVALID_SETTLEMENT");
  const parsed = InferenceUsageSchema.safeParse(usageInput);
  const usage = parsed.success ? parsed.data : null;
  const charge = usage ? costMicros(attempt.price, usage.inputTokens, usage.outputTokens) : null;
  const unknown =
    !usage ||
    usage.inputTokens > attempt.maxInputTokens ||
    usage.outputTokens > attempt.maxOutputTokens ||
    charge! > attempt.reservedMicros;
  return InferenceBudgetSchema.parse({
    ...budget,
    attempts: budget.attempts.map((x) =>
      x.id !== id
        ? x
        : {
            ...x,
            status: unknown ? "UNKNOWN" : ok ? "OK" : "FAILED",
            usage,
            chargedMicros: charge,
          },
    ),
  });
}
export interface InferenceBudgetStore {
  update(
    runId: string,
    reducer: (current: InferenceBudget) => InferenceBudget,
  ): Promise<InferenceBudget>;
}
// Tests only. Production callers must use the transactional IndexedDB implementation.
export class MemoryInferenceBudgetStore implements InferenceBudgetStore {
  private state: InferenceBudget;
  constructor(initial: InferenceBudget) {
    this.state = InferenceBudgetSchema.parse(initial);
  }
  async update(runId: string, reducer: (current: InferenceBudget) => InferenceBudget) {
    if (this.state.runId !== runId) throw new Error("UNKNOWN_RUN");
    this.state = InferenceBudgetSchema.parse(reducer(structuredClone(this.state)));
    return await Promise.resolve(structuredClone(this.state));
  }
}
