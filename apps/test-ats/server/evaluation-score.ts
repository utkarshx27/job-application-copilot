import type { EvaluationCase } from "./evaluation-corpus";

export type EvaluationObservation = {
  caseId: string;
  seed: number;
  arm: string;
  outcomeCorrect: boolean;
  correctCompletion: boolean;
  critical: boolean;
  duplicates: number;
  attempts: number;
  manualInterventions: number;
  memoryUses: number;
  actionCount: number;
  elapsedMs: number;
};
export function scoreEvaluation(
  cases: EvaluationCase[],
  seeds: readonly number[],
  observations: EvaluationObservation[],
) {
  const key = (id: string, seed: number, arm: string) => `${id}/${seed}/${arm}`;
  const records = new Map<string, EvaluationObservation>();
  for (const item of observations) {
    const id = key(item.caseId, item.seed, item.arm);
    if (records.has(id)) throw new Error("Duplicate evaluation observation");
    if (
      !cases.some((entry) => entry.id === item.caseId) ||
      !seeds.includes(item.seed) ||
      !["baseline", "correction"].includes(item.arm)
    )
      throw new Error("Unplanned evaluation observation");
    records.set(id, item);
  }
  const planned = cases.flatMap((item) =>
    seeds.map((seed) => ({ item, seed, observation: records.get(key(item.id, seed, "baseline")) })),
  );
  const ratio = (rows: typeof planned, match: (item: EvaluationObservation) => boolean) => ({
    numerator: rows.filter((row) => row.observation && match(row.observation)).length,
    denominator: rows.length,
  });
  const completable = planned.filter(({ item }) => item.expected === "ACCEPTED");
  const completion = ratio(completable, (item) => item.correctCompletion);
  const noExtraInput = ratio(
    completable,
    (item) => item.correctCompletion && item.manualInterventions === 0,
  );
  const recovery = ratio(
    planned.filter(({ item }) => item.workflow === "restart"),
    (item) => item.correctCompletion,
  );
  const boundary = ratio(
    planned.filter(({ item }) => item.expected !== "ACCEPTED"),
    (item) => item.outcomeCorrect,
  );
  const pairs = planned
    .filter(({ item }) => item.workflow === "renamed")
    .map(({ item, seed, observation }) => ({
      baseline: observation,
      correction: records.get(key(item.id, seed, "correction")),
    }));
  const completePairs = pairs.filter(
    (pair) => pair.baseline?.correctCompletion && pair.correction?.correctCompletion,
  );
  const baselinePrompts = completePairs.reduce(
    (sum, pair) => sum + pair.baseline!.manualInterventions,
    0,
  );
  const correctionPrompts = completePairs.reduce(
    (sum, pair) => sum + pair.correction!.manualInterventions,
    0,
  );
  const sorted = planned
    .flatMap(({ observation }) => (observation ? [observation.elapsedMs] : []))
    .sort((a, b) => a - b);
  const criticalFailures = observations.filter((item) => item.critical).length;
  const meets = (metric: { numerator: number; denominator: number }, threshold: number) =>
    metric.denominator > 0 && metric.numerator / metric.denominator >= threshold;
  const gates = {
    completion: meets(completion, 0.9),
    noExtraInput: meets(noExtraInput, 0.7),
    recovery: meets(recovery, 0.9),
    boundary: meets(boundary, 1),
    critical: criticalFailures === 0 && planned.every((row) => row.observation),
    correction:
      completePairs.length === pairs.length &&
      pairs.length > 0 &&
      baselinePrompts > 0 &&
      correctionPrompts / baselinePrompts <= 0.5,
    actionBudget: observations.length > 0 && observations.every((item) => item.actionCount <= 60),
  };
  return {
    baselineRuns: planned.length,
    measuredBaselineRuns: planned.filter((row) => row.observation).length,
    schemaGroups: new Set(cases.map((item) => item.family)).size,
    completion,
    noExtraInput,
    recovery,
    boundary,
    criticalFailures,
    duplicateAttempts: observations.reduce((sum, item) => sum + item.duplicates, 0),
    correction: {
      plannedPairs: pairs.length,
      completePairs: completePairs.length,
      baselinePrompts,
      correctionPrompts,
      relativePromptReduction: baselinePrompts > 0 ? 1 - correctionPrompts / baselinePrompts : null,
    },
    latencyMs: {
      measured: sorted.length,
      median: sorted[Math.floor(sorted.length * 0.5)] ?? null,
      p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? null,
    },
    gates,
    measuredGatesPassed: Object.values(gates).every(Boolean),
    releaseAccepted: false,
    unmeasured: [
      "Five-user study",
      "Harmful-transfer paired counterfactual suite",
      "Independent employer implementations",
      "Company/discovery held-out metrics",
    ],
  };
}
