import { describe, expect, it } from "vitest";
import {
  evaluationCorpus,
  evaluationScenario,
  EVALUATION_SEEDS,
} from "../server/evaluation-corpus";

describe("frozen evaluation design", () => {
  it("has 300 distinct workflow specifications and family-disjoint 180/60/60 partitions", () => {
    const cases = evaluationCorpus();
    expect(cases).toHaveLength(300);
    expect(new Set(cases.map((item) => item.id)).size).toBe(300);
    for (const [partition, size] of [
      ["development", 180],
      ["validation", 60],
      ["test", 60],
    ] as const)
      expect(cases.filter((item) => item.partition === partition)).toHaveLength(size);
    for (const family of new Set(cases.map((item) => item.family)))
      expect(
        new Set(cases.filter((item) => item.family === family).map((item) => item.partition)).size,
      ).toBe(1);
    const signatures = cases.map((item) => {
      const scenario = evaluationScenario(item.id, 17);
      return JSON.stringify({
        fields: scenario.fields,
        mode: scenario.mode,
        modal: scenario.modal,
        access: scenario.access,
        fault: scenario.fault,
        interruption: item.workflow === "restart",
      });
    });
    expect(new Set(signatures).size).toBe(300);
    expect(EVALUATION_SEEDS).toHaveLength(3);
  });
  it("rejects unknown cases and does not put ground truth into public form definitions", () => {
    expect(() => evaluationScenario("invented", 17)).toThrow();
    expect(evaluationScenario("screening-05-native", 17)).not.toHaveProperty("expected");
  });
});
