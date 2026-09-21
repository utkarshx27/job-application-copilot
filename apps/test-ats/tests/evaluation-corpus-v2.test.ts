import { expect, it } from "vitest";
import { evaluationCorpus, evaluationScenario } from "../server/evaluation-corpus-v2";
import { evaluationCorpus as v1Corpus } from "../server/evaluation-corpus";

it("defines 300 new composition IDs with disjoint 180/60/60 families", () => {
  const cases = evaluationCorpus();
  expect(cases).toHaveLength(300);
  expect(new Set(cases.map((c) => c.id)).size).toBe(300);
  const old = new Set(v1Corpus().map((c) => c.id));
  expect(cases.every((c) => !old.has(c.id))).toBe(true);
  expect(
    ["development", "validation", "test"].map((p) => cases.filter((c) => c.partition === p).length),
  ).toEqual([180, 60, 60]);
  for (const family of new Set(cases.map((c) => c.family)))
    expect(new Set(cases.filter((c) => c.family === family).map((c) => c.partition)).size).toBe(1);
});
it("uses delayed reversed fields and new compound surfaces without changing the v1 generator", () => {
  for (const item of evaluationCorpus()) {
    const scenario = evaluationScenario(item.id, 53);
    expect(scenario.fields[0]?.key).toBe("resume");
    expect(scenario.delayMs).toBeGreaterThan(0);
    if (item.workflow === "frame") expect(scenario.mode).toBe("NESTED_FRAME");
    if (item.workflow === "dialog") expect(["SHADOW", "COMBOBOX"]).toContain(scenario.mode);
  }
  expect(() => evaluationScenario("screening-01-native", 53)).toThrow();
});
