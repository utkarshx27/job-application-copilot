import type { PortalField } from "../src/portal-contract";
import type { Scenario } from "./portal-catalog";

// Server/runner only. Never import this module into an extension or page bundle.
export const CORPUS_VERSION = "ag09-synthetic-v1";
export const EVALUATION_SEEDS = [17, 29, 43] as const;
export const WORKFLOWS = [
  "native",
  "renamed",
  "dialog",
  "frame",
  "shadow",
  "combobox",
  "lost-response",
  "false-confirmation",
  "challenge",
  "restart",
] as const;
export type EvaluationPartition = "development" | "validation" | "test";
export type EvaluationCase = {
  id: string;
  family: string;
  partition: EvaluationPartition;
  fieldMask: number;
  workflow: (typeof WORKFLOWS)[number];
  expected: "ACCEPTED" | "PAUSE" | "OUTCOME_UNKNOWN";
};

export function evaluationCorpus(): EvaluationCase[] {
  return Array.from({ length: 30 }, (_, index) => {
    const mask = index + 1;
    // Each five-family block assigns three development, one validation and one
    // test family. No field-set family crosses partitions, including variants.
    const partition: EvaluationPartition =
      index % 5 < 3 ? "development" : index % 5 === 3 ? "validation" : "test";
    const family = `screening-${String(mask).padStart(2, "0")}`;
    return WORKFLOWS.map((workflow): EvaluationCase => ({
      id: `${family}-${workflow}`,
      family,
      partition,
      fieldMask: mask,
      workflow,
      expected:
        workflow === "challenge"
          ? "PAUSE"
          : workflow === "false-confirmation"
            ? "OUTCOME_UNKNOWN"
            : "ACCEPTED",
    }));
  }).flat();
}

export function evaluationScenario(id: string, seed: number): Scenario {
  const item = evaluationCorpus().find((entry) => entry.id === id);
  if (!item) throw new Error("Unknown evaluation scenario");
  const optional: PortalField[] = [
    {
      key: "experienceMonths",
      label: "Total experience in months",
      kind: "number",
      required: true,
    },
    { key: "noticeDays", label: "Notice period in days", kind: "number", required: true },
    { key: "expectedSalary", label: "Expected compensation", kind: "number", required: true },
    {
      key: "currency",
      label: "Compensation currency",
      kind: "select",
      required: true,
      options: ["INR", "USD", "EUR"],
    },
    {
      key: "salaryPeriod",
      label: "Compensation period",
      kind: "select",
      required: true,
      options: ["Year", "Month", "Hour"],
    },
  ];
  const fields: PortalField[] = [
    { key: "name", label: "Full name", kind: "text", required: true },
    { key: "email", label: "Email", kind: "email", required: true },
    { key: "phone", label: "Phone number", kind: "text", required: true },
    { key: "currentLocation", label: "Current city", kind: "text", required: true },
    {
      key: "workArrangement",
      label: "Work arrangement",
      kind: "select",
      required: true,
      options: ["Remote", "Hybrid", "On-site"],
    },
    {
      key: "currentSalary",
      label: item.workflow === "renamed" ? "Annual earnings" : "Current compensation",
      kind: "number",
      required: true,
    },
    ...optional.filter((_, bit) => (item.fieldMask & (1 << bit)) !== 0),
    { key: "resume", label: "Resume document", kind: "file", required: true },
  ];
  // Seeds reorder options and opaque IDs; these are repeated runs, not new templates.
  for (const field of fields) if (field.options && seed % 2) field.options.reverse();
  return {
    id: item.id,
    publicId: "portal-30",
    family: item.family,
    title: "Synthetic evaluation application",
    seed,
    fields,
    mode:
      item.workflow === "renamed"
        ? "LABELLED"
        : item.workflow === "frame"
          ? "FRAME"
          : item.workflow === "shadow"
            ? "SHADOW"
            : item.workflow === "combobox"
              ? "COMBOBOX"
              : "NATIVE",
    modal: item.workflow === "dialog",
    repeatHistory: false,
    delayMs: 0,
    replaceOnFocus: false,
    evidenceOnly: false,
    applicationAvailable: true,
    access: item.workflow === "challenge" ? "CHALLENGE_PRESENT" : "AVAILABLE",
    fault:
      item.workflow === "lost-response"
        ? "LOST_RESPONSE"
        : item.workflow === "false-confirmation"
          ? "FALSE_CONFIRMATION"
          : "NONE",
  };
}
