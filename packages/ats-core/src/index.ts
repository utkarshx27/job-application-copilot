import {
  AtsDetectionSchema,
  AtsPageReportSchema,
  ConfirmationEvidenceSchema,
  NormalizedJobSchema,
  type AtsDetection,
  type AtsId,
  type AtsPageReport,
  type ConfirmationEvidence,
  type NormalizedJob,
  type WorkdayWorkflowPage,
} from "@copilot/job-schema";
import {
  FieldMappingSchema,
  type CanonicalQuestion,
  type FieldMapping,
  type RawField,
} from "@copilot/form-schema";

export interface AtsAdapter {
  readonly id: Extract<AtsId, "GREENHOUSE" | "LEVER" | "ASHBY" | "SMARTRECRUITERS" | "WORKDAY">;
  readonly version: string;
  detect(targetDocument: Document): AtsDetection;
  extractJob(targetDocument: Document, detection: AtsDetection): NormalizedJob | null;
  detectConfirmation(targetDocument: Document): ConfirmationEvidence;
  classifyField(field: RawField): FieldMapping | null;
  inspectWorkflow?(targetDocument: Document, detection: AtsDetection): WorkdayWorkflowPage | null;
}

export function atsFieldRule(
  field: RawField,
  adapter: Extract<AtsId, "GREENHOUSE" | "LEVER" | "ASHBY" | "SMARTRECRUITERS" | "WORKDAY">,
  canonicalQuestion: CanonicalQuestion,
  evidence: string,
): FieldMapping {
  return FieldMappingSchema.parse({
    fieldId: field.fieldId,
    canonicalQuestion,
    confidence: 0.999,
    tier: "R0",
    evidence: [`ats:${adapter.toLocaleLowerCase()}:${evidence}`],
    fillable: false,
  });
}

export function compactText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, 100_000);
}

export function metaContent(targetDocument: Document, name: string): string {
  const meta = [...targetDocument.querySelectorAll<HTMLMetaElement>("meta")].find(
    (candidate) => candidate.name === name || candidate.getAttribute("property") === name,
  );
  return compactText(meta?.content);
}

export function selectorText(targetDocument: Document, selectors: string[]): string {
  for (const selector of selectors) {
    const value = compactText(targetDocument.querySelector(selector)?.textContent);
    if (value) return value;
  }
  return "";
}

function stripMarkup(value: string): string {
  const container = new DOMParser().parseFromString(value, "text/html").body;
  return compactText(container.textContent);
}

export type JsonLdJob = {
  title?: string;
  description?: string;
  hiringOrganization?: { name?: string };
  jobLocation?: { address?: { addressLocality?: string; addressRegion?: string } };
  employmentType?: string;
  identifier?: { value?: string } | string;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readJsonLdJob(record: Record<string, unknown>): JsonLdJob {
  const hiring = objectValue(record.hiringOrganization);
  const location = objectValue(record.jobLocation);
  const address = objectValue(location?.address);
  const identifierRecord = objectValue(record.identifier);
  const title = optionalString(record.title);
  const description = optionalString(record.description);
  const company = optionalString(hiring?.name);
  const locality = optionalString(address?.addressLocality);
  const region = optionalString(address?.addressRegion);
  const employmentType = optionalString(record.employmentType);
  const identifier = optionalString(record.identifier) ?? optionalString(identifierRecord?.value);
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(company ? { hiringOrganization: { name: company } } : {}),
    ...(locality || region
      ? {
          jobLocation: {
            address: {
              ...(locality ? { addressLocality: locality } : {}),
              ...(region ? { addressRegion: region } : {}),
            },
          },
        }
      : {}),
    ...(employmentType ? { employmentType } : {}),
    ...(identifier ? { identifier } : {}),
  };
}

export function jsonLdJob(targetDocument: Document): JsonLdJob | null {
  for (const script of targetDocument.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"]',
  )) {
    try {
      const parsed: unknown = JSON.parse(script.textContent ?? "null");
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const candidate of candidates) {
        const record = objectValue(candidate);
        if (!record) continue;
        if (record["@type"] === "JobPosting") return readJsonLdJob(record);
        const graph = record["@graph"];
        if (Array.isArray(graph)) {
          for (const item of graph) {
            const nested = objectValue(item);
            if (nested?.["@type"] === "JobPosting") return readJsonLdJob(nested);
          }
        }
      }
    } catch {
      // Invalid page JSON-LD is untrusted data and is ignored.
    }
  }
  return null;
}

export function jsonLdLocation(job: JsonLdJob | null): string {
  const locality = compactText(job?.jobLocation?.address?.addressLocality);
  const region = compactText(job?.jobLocation?.address?.addressRegion);
  return [locality, region].filter(Boolean).join(", ");
}

export function jsonLdDescription(job: JsonLdJob | null): string {
  return job?.description ? stripMarkup(job.description) : "";
}

export function stableJobId(adapter: AtsId, externalId: string, url: string): string {
  const input = `${adapter}:${externalId || new URL(url).pathname}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${adapter.toLocaleLowerCase()}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function normalizedJob(input: Omit<NormalizedJob, "schemaVersion">): NormalizedJob {
  return NormalizedJobSchema.parse({ schemaVersion: 1, ...input });
}

export function noConfirmation(): ConfirmationEvidence {
  return ConfirmationEvidenceSchema.parse({ confirmed: false, evidence: [] });
}

export function inspectWithAdapters(
  targetDocument: Document,
  adapters: AtsAdapter[],
): AtsPageReport {
  const detections = adapters.map((adapter) => ({
    adapter,
    result: adapter.detect(targetDocument),
  }));
  const selected = detections.sort(
    (left, right) => right.result.confidence - left.result.confidence,
  )[0];
  if (!selected || selected.result.confidence < 0.8) {
    return AtsPageReportSchema.parse({
      reportVersion: 1,
      detection: {
        adapter: "GENERIC",
        adapterVersion: "1",
        confidence: 1,
        supported: true,
        evidence: ["No supported ATS-specific signature matched."],
      },
      job: null,
      confirmation: noConfirmation(),
      workflow: null,
    });
  }
  return AtsPageReportSchema.parse({
    reportVersion: 1,
    detection: AtsDetectionSchema.parse(selected.result),
    job: selected.adapter.extractJob(targetDocument, selected.result),
    confirmation: selected.adapter.detectConfirmation(targetDocument),
    workflow: selected.adapter.inspectWorkflow?.(targetDocument, selected.result) ?? null,
  });
}
