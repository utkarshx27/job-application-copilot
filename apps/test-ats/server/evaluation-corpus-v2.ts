import {
  evaluationCorpus as originalCorpus,
  evaluationScenario as originalScenario,
} from "@copilot/test-ats/evaluation";
import type { EvaluationCase } from "@copilot/test-ats/evaluation";

// New composition protocol, frozen before execution. V1 stays byte-for-byte intact.
// Shared primitives and field semantics are NOT new independent employer layouts.
export const CORPUS_VERSION = "ag09-compositions-v2";
export const EVALUATION_SEEDS = [53, 71, 89] as const;
export function evaluationCorpus(): EvaluationCase[] {
  return originalCorpus().map((item) => ({
    ...item,
    id: `composition-v2-${item.id}`,
    family: `composition-v2-${item.family}`,
  }));
}
export function evaluationScenario(id: string, seed: number) {
  const item = evaluationCorpus().find((entry) => entry.id === id);
  if (!item) throw new Error("Unknown v2 evaluation scenario");
  const scenario = originalScenario(id.replace("composition-v2-", ""), seed);
  scenario.id = id;
  scenario.family = item.family;
  scenario.title = "Synthetic composition evaluation";
  // Every v2 case has a changed field order and bounded delayed rendering.
  scenario.fields = [...scenario.fields].reverse();
  scenario.delayMs = 100 + (item.fieldMask % 3) * 100;
  if (item.workflow === "frame") scenario.mode = "NESTED_FRAME";
  else if (item.workflow === "dialog") scenario.mode = item.fieldMask % 2 ? "SHADOW" : "COMBOBOX";
  else if (["native", "restart", "lost-response", "false-confirmation"].includes(item.workflow))
    scenario.mode = item.fieldMask % 2 ? "COMBOBOX" : "SHADOW";
  if (item.workflow !== "frame" && item.workflow !== "challenge") scenario.modal = true;
  return scenario;
}
