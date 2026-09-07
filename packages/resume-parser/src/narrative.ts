import { ResumeDraftSchema, type ResumeDraft } from "@copilot/profile-core";

// Narrow, labelled extraction. Unstructured wishes/history remain context for review.
export function parseNarrativeIntake(text: string): ResumeDraft {
  if (text.length > 20_000) throw new Error("Background notes must be 20,000 characters or fewer.");
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^(name|email|phone|linkedin|github|portfolio)\s*:\s*(.+)$/i.exec(line.trim());
    if (match?.[1] && match[2]) {
      const key = match[1].toLowerCase();
      if (values.has(key)) throw new Error(`Use only one ${key} line, then review it.`);
      values.set(key, match[2].trim());
    }
  }
  const full = values.get("name");
  const names = full?.split(/\s+/) ?? [];
  return ResumeDraftSchema.parse({
    ...(full
      ? { identity: { full, given: names[0], family: names.slice(1).join(" ") || null } }
      : {}),
    ...Object.fromEntries([...values].filter(([key]) => key !== "name")),
    warnings: [
      "Only explicitly labelled contact details are suggested. Names need review. Background notes and aspirations are context, not verified experience.",
    ],
  });
}
