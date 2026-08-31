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
  readonly id: Exclude<AtsId, "GENERIC" | "UNKNOWN">;
  readonly version: string;
  detect(targetDocument: Document): AtsDetection;
  extractJob(targetDocument: Document, detection: AtsDetection): NormalizedJob | null;
  detectConfirmation(targetDocument: Document): ConfirmationEvidence;
  classifyField(field: RawField): FieldMapping | null;
  inspectWorkflow?(targetDocument: Document, detection: AtsDetection): WorkdayWorkflowPage | null;
}

export function atsFieldRule(
  field: RawField,
  adapter: Exclude<AtsId, "GENERIC" | "UNKNOWN">,
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

export const STANDARD_APPLICATION_FIELD_RULES: Array<[RegExp, CanonicalQuestion]> = [
  [/\b(first_?name|firstname|given_?name)\b/, "IDENTITY.legal_name.given"],
  [/\b(last_?name|lastname|family_?name|surname)\b/, "IDENTITY.legal_name.family"],
  [/\b(full_?name|fullname|candidate_?name)\b/, "IDENTITY.legal_name.full"],
  [/\b(email|email_?address)\b/, "CONTACT.email"],
  [/\b(phone|phone_?number|mobile|mobile_?phone)\b/, "CONTACT.phone"],
  [/\b(linkedin|linkedin_?url|linkedin_?profile)\b/, "LINKS.linkedin"],
  [/\b(portfolio|portfolio_?url|website|website_?url)\b/, "LINKS.portfolio"],
  [/\b(resume|resume_?file|resume_?upload|cv|cv_?file)\b/, "APPLICATION.resume"],
  [/\b(cover_?letter|coverletter)\b/, "APPLICATION.cover_letter"],
  [/\b(current_?company|company_?name|employer)\b/, "WORK_HISTORY.0.employer"],
  [/\b(current_?title|job_?title|position_?title)\b/, "WORK_HISTORY.0.title"],
  [/\b(school|college|institution|university)\b/, "EDUCATION.0.institution"],
  [/\bdegree\b/, "EDUCATION.0.degree"],
];

export type StandardAtsAdapterConfig = {
  id: Exclude<AtsId, "GENERIC" | "UNKNOWN">;
  slug: string;
  version?: string;
  hostPatterns: RegExp[];
  domSelectors: string[];
  routeId(url: URL): string;
  fieldRules?: Array<[RegExp, CanonicalQuestion]>;
  titleSelectors?: string[];
  companySelectors?: string[];
  descriptionSelectors?: string[];
  locationSelectors?: string[];
};

export function createStandardAtsAdapter(config: StandardAtsAdapterConfig): AtsAdapter {
  const version = config.version ?? "1";
  return {
    id: config.id,
    version,

    detect(targetDocument) {
      const url = new URL(targetDocument.location.href);
      const evidence: string[] = [];
      if (config.hostPatterns.some((pattern) => pattern.test(url.hostname)))
        evidence.push(`host:${url.hostname}`);
      if (metaContent(targetDocument, "copilot-ats").toLocaleLowerCase() === config.slug)
        evidence.push(`meta:copilot-ats=${config.slug}`);
      if (config.domSelectors.some((selector) => targetDocument.querySelector(selector)))
        evidence.push(`dom:${config.slug}-job`);
      return AtsDetectionSchema.parse({
        adapter: config.id,
        adapterVersion: version,
        confidence: evidence.some((item) => item.startsWith("host:"))
          ? 0.999
          : evidence.length
            ? 0.98
            : 0,
        supported: evidence.length > 0,
        evidence,
      });
    },

    extractJob(targetDocument, detection) {
      if (!detection.supported) return null;
      const url = new URL(targetDocument.location.href);
      const json = jsonLdJob(targetDocument);
      const title =
        compactText(json?.title) ||
        selectorText(
          targetDocument,
          config.titleSelectors ?? ["[data-job-title]", "[itemprop='title']", "h1"],
        );
      const company =
        compactText(json?.hiringOrganization?.name) ||
        metaContent(targetDocument, "copilot-company") ||
        selectorText(
          targetDocument,
          config.companySelectors ?? ["[data-company-name]", "[itemprop='hiringOrganization']"],
        ) ||
        metaContent(targetDocument, "og:site_name");
      if (!title || !company) return null;
      const jsonIdentifier =
        typeof json?.identifier === "string"
          ? json.identifier
          : compactText(json?.identifier?.value);
      const externalRequisitionId =
        compactText(jsonIdentifier) ||
        metaContent(targetDocument, "copilot-requisition-id") ||
        compactText(targetDocument.querySelector<HTMLElement>("[data-job-id]")?.dataset.jobId) ||
        compactText(config.routeId(url));
      const description =
        jsonLdDescription(json) ||
        selectorText(
          targetDocument,
          config.descriptionSelectors ?? [
            "[data-job-description]",
            "[itemprop='description']",
            ".job-description",
          ],
        ) ||
        metaContent(targetDocument, "description");
      const location =
        jsonLdLocation(json) ||
        selectorText(
          targetDocument,
          config.locationSelectors ?? [
            "[data-job-location]",
            "[itemprop='jobLocation']",
            ".job-location",
          ],
        );
      const employmentType = compactText(json?.employmentType);
      const workplaceType = selectorText(targetDocument, ["[data-workplace-type]"]);
      return normalizedJob({
        id: stableJobId(config.id, externalRequisitionId, url.href),
        ats: config.id,
        ...(externalRequisitionId ? { externalRequisitionId } : {}),
        title,
        company,
        description,
        ...(location ? { location } : {}),
        remotePolicy: /\bremote\b/i.test(`${location} ${workplaceType}`)
          ? "REMOTE"
          : /\bhybrid\b/i.test(`${location} ${workplaceType}`)
            ? "HYBRID"
            : /\bon.?site\b/i.test(workplaceType)
              ? "ONSITE"
              : "UNKNOWN",
        ...(employmentType ? { employmentType } : {}),
        requiredSkills: [],
        preferredSkills: [],
        sourceUrl: url.href,
        applicationUrl: url.href,
        snapshotAt: new Date().toISOString(),
      });
    },

    detectConfirmation(targetDocument) {
      const container = targetDocument.querySelector(
        `.${config.slug}-application-confirmation, [data-ats-confirmation='${config.slug}'], [data-testid='application-success'], [data-application-confirmation='true']`,
      );
      const heading = compactText(
        container?.querySelector("h1, h2, [role='heading']")?.textContent,
      );
      const content = compactText(container?.textContent);
      if (
        !container ||
        !/thank you|application (was )?(received|submitted|complete)/i.test(`${heading} ${content}`)
      )
        return noConfirmation();
      const referenceId = compactText(
        targetDocument.querySelector("[data-confirmation-id]")?.textContent,
      );
      return ConfirmationEvidenceSchema.parse({
        confirmed: true,
        heading: heading || "Application received",
        ...(referenceId ? { referenceId } : {}),
        evidence: [`dom:${config.slug}-confirmation`],
      });
    },

    classifyField(field) {
      const machine = `${field.name} ${field.domId}`.toLocaleLowerCase();
      const match = (config.fieldRules ?? STANDARD_APPLICATION_FIELD_RULES).find(([pattern]) =>
        pattern.test(machine),
      );
      return match ? atsFieldRule(field, config.id, match[1], machine) : null;
    },
  };
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
