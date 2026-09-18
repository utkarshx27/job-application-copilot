import { describe, expect, it } from "vitest";
import { evaluationCorpus } from "../server/evaluation-corpus";
import { scoreEvaluation, type EvaluationObservation } from "../server/evaluation-score";

describe("evaluation denominators", () => {
  const cases = evaluationCorpus().filter((item) => item.partition === "test");
  it("counts absent and timed-out runs as unsuccessful, not skipped", () => {
    const result = scoreEvaluation(cases, [17, 29, 43], []);
    expect(result.baselineRuns).toBe(180);
    expect(result.completion).toEqual({ numerator: 0, denominator: 144 });
    expect(result.measuredBaselineRuns).toBe(0);
    expect(result.measuredGatesPassed).toBe(false);
    expect(result.releaseAccepted).toBe(false);
  });
  it("rejects duplicate observations instead of increasing a success numerator", () => {
    const item: EvaluationObservation = {
      caseId: cases[0]!.id,
      seed: 17,
      arm: "baseline",
      outcomeCorrect: true,
      correctCompletion: true,
      critical: false,
      duplicates: 0,
      attempts: 1,
      manualInterventions: 0,
      memoryUses: 0,
      actionCount: 12,
      elapsedMs: 1000,
    };
    expect(() => scoreEvaluation(cases, [17], [item, item])).toThrow("Duplicate");
    expect(() => scoreEvaluation(cases, [29], [item])).toThrow("Unplanned");
  });
  it("does not claim correction benefit from incomplete pairs or a zero baseline", () => {
    const result = scoreEvaluation(cases, [17], []);
    expect(result.correction.plannedPairs).toBe(6);
    expect(result.correction.completePairs).toBe(0);
    expect(result.correction.relativePromptReduction).toBeNull();
    expect(result.gates.correction).toBe(false);
  });
});
