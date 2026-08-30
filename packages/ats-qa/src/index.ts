import { createHash } from "node:crypto";

import { greenhouseAdapter } from "@copilot/ats-greenhouse";
import { leverAdapter } from "@copilot/ats-lever";
import { CandidateProfileSchema, type CandidateProfile } from "@copilot/candidate-schema";
import { analyzeForm, classifyField, type FieldClassifier } from "@copilot/form-engine";
import {
  CanonicalQuestionSchema,
  PageSnapshotSchema,
  RawFieldSchema,
  type CanonicalQuestion,
  type FieldMapping,
  type PageSnapshot,
  type RawField,
} from "@copilot/form-schema";
import { createEmptyVault, saveProfileDraft } from "@copilot/profile-core";
import { z } from "zod";

export const QaAdapterSchema = z.enum(["GREENHOUSE", "LEVER"]);
export const ReviewPrioritySchema = z.enum(["P0", "P1", "P2"]);
export const ReviewSeveritySchema = z.enum(["SEVERE", "NORMAL"]);
const ReviewCheckSchema = z.enum(["UNREVIEWED", "PASS", "FAIL"]);

const BoundedRawFieldSchema = RawFieldSchema.extend({
  fieldId: z.string().min(1).max(160),
  accessibleName: z.string().max(500),
  labelText: z.string().max(500),
  ariaLabel: z.string().max(500),
  placeholder: z.string().max(500),
  name: z.string().max(300),
  domId: z.string().max(300),
  autocomplete: z.string().max(100),
  groupLabel: z.string().max(500),
  optionValue: z.string().max(500),
  options: z
    .array(
      z.object({
        value: z.string().max(500),
        text: z.string().max(500),
        disabled: z.boolean(),
      }),
    )
    .max(5000),
});

const BoundedPageSnapshotSchema = PageSnapshotSchema.extend({
  title: z.string().max(200),
  fields: z.array(BoundedRawFieldSchema).max(500),
});

export const AtsQaFixtureSchema = z.object({
  qaFixtureVersion: z.literal(1),
  id: z.string().regex(/^(greenhouse|lever)-[a-f0-9]{16}$/),
  adapter: QaAdapterSchema,
  adapterVersion: z.string().min(1).max(30),
  capturedAt: z.iso.datetime({ offset: true }),
  source: z.object({
    host: z.string().min(1).max(253),
    pathPattern: z.string().startsWith("/").max(500),
    urlSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  snapshot: BoundedPageSnapshotSchema,
  safety: z.object({
    valuesCaptured: z.literal(false),
    cookiesCaptured: z.literal(false),
    storageCaptured: z.literal(false),
    mutatingRequestsBlocked: z.literal(true),
    formInteractionsPerformed: z.literal(false),
  }),
  sanitized: z.literal(true),
});

const FieldReviewBaseSchema = z.object({
  fieldId: z.string().min(1).max(160),
  severityIfWrong: ReviewSeveritySchema,
  reviewContext: z
    .object({
      capturedLabel: z.string().max(500),
      predictedCanonicalQuestion: CanonicalQuestionSchema.nullable(),
      confidence: z.number().min(0).max(1),
      tier: z.enum(["R0", "R1", "R2", "UNMAPPED"]),
      priority: ReviewPrioritySchema,
      reasons: z.array(z.string().max(1000)).max(10),
    })
    .optional(),
  notes: z.string().max(1000).optional(),
});

export const QaFieldReviewSchema = z.discriminatedUnion("decision", [
  FieldReviewBaseSchema.extend({ decision: z.literal("UNREVIEWED") }),
  FieldReviewBaseSchema.extend({
    decision: z.literal("MAPPED"),
    expectedCanonicalQuestion: CanonicalQuestionSchema,
  }),
  FieldReviewBaseSchema.extend({ decision: z.literal("UNMAPPED") }),
  FieldReviewBaseSchema.extend({
    decision: z.literal("UNSUPPORTED"),
    reason: z.string().min(1).max(1000),
  }),
]);

export const AtsQaReviewSchema = z.object({
  reviewVersion: z.literal(1),
  fixtureId: z.string().min(1),
  status: z.enum(["PENDING", "REVIEWED"]),
  reviewer: z.string().max(100).optional(),
  reviewedAt: z.iso.datetime({ offset: true }).optional(),
  pageChecks: z.object({
    correctAts: ReviewCheckSchema,
    allVisibleFieldsCaptured: ReviewCheckSchema,
    containsNoPersonalData: ReviewCheckSchema,
    noFormInteractionOccurred: ReviewCheckSchema,
  }),
  fields: z.array(QaFieldReviewSchema).max(500),
});

export type QaAdapter = z.infer<typeof QaAdapterSchema>;
export type AtsQaFixture = z.infer<typeof AtsQaFixtureSchema>;
export type AtsQaReview = z.infer<typeof AtsQaReviewSchema>;
export type ReviewPriority = z.infer<typeof ReviewPrioritySchema>;

export type QaReviewQueueItem = {
  fixtureId: string;
  adapter: QaAdapter;
  fieldId: string;
  label: string;
  predictedCanonicalQuestion: CanonicalQuestion | null;
  confidence: number;
  tier: FieldMapping["tier"];
  priority: ReviewPriority;
  reasons: string[];
  severityIfWrong: "SEVERE" | "NORMAL";
  controlKind: RawField["controlKind"];
  required: boolean;
};

export type QaManualReviewBatch = {
  id: string;
  adapter: QaAdapter;
  priority: ReviewPriority;
  label: string;
  predictedCanonicalQuestion: CanonicalQuestion | null;
  confidence: number;
  tier: FieldMapping["tier"];
  controlKind: RawField["controlKind"];
  required: boolean;
  reasons: string[];
  occurrences: number;
  fixtureIds: string[];
  exampleFieldIds: string[];
};

export type FixtureQaResult = {
  fixtureId: string;
  adapter: QaAdapter;
  fullyReviewed: boolean;
  totalFields: number;
  reviewedFields: number;
  evaluatedMappings: number;
  correctMappings: number;
  mappingAccuracy: number | null;
  eligibleAutoFillFields: number;
  successfulAutoFillFields: number;
  supportedFieldFillSuccess: number | null;
  severeWrongFieldIncidents: number;
  unsupportedFields: number;
  reviewQueue: QaReviewQueueItem[];
};

export type QaGateReport = {
  generatedAt: string;
  fixtures: FixtureQaResult[];
  manualReviewBatches: QaManualReviewBatch[];
  totals: {
    greenhouseForms: number;
    leverForms: number;
    fullyReviewedForms: number;
    totalForms: number;
    reviewedFields: number;
    totalFields: number;
    evaluatedMappings: number;
    correctMappings: number;
    mappingAccuracy: number | null;
    eligibleAutoFillFields: number;
    successfulAutoFillFields: number;
    supportedFieldFillSuccess: number | null;
    severeWrongFieldIncidents: number;
    pendingReviewItems: number;
    pendingManualBatches: number;
  };
  gate: {
    greenhouseSample: boolean;
    leverSample: boolean;
    allFormsReviewed: boolean;
    fillSuccess: boolean;
    noSevereWrongFieldIncidents: boolean;
    passed: boolean;
  };
};

function manualReviewBatchKey(item: QaReviewQueueItem): string {
  return JSON.stringify([
    item.adapter,
    item.priority,
    item.controlKind,
    item.required,
    normalizedReviewLabel(item.label),
    item.predictedCanonicalQuestion,
    item.confidence,
    item.tier,
    item.reasons,
  ]);
}

export function manualReviewBatchId(item: QaReviewQueueItem): string {
  return `batch-${sha256(manualReviewBatchKey(item)).slice(0, 16)}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLocaleLowerCase();
  if (host === "localhost" || host === "::1" || host.endsWith(".localhost")) return true;
  if (/^(0|10|127)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host))
    return true;
  const match = /^172\.(\d{1,3})\./.exec(host);
  if (match?.[1] && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  return /^(fc|fd|fe80):/i.test(host);
}

export function validatePublicCaptureUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "https:") throw new Error("QA capture URLs must use HTTPS.");
  if (url.username || url.password) throw new Error("QA capture URLs cannot contain credentials.");
  if (isPrivateHost(url.hostname)) throw new Error("QA capture URLs cannot target local networks.");
  return url;
}

export function pathPattern(pathname: string): string {
  const parts = pathname.split("/").map((part) => {
    if (!part) return part;
    let decoded = part;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      // Keep malformed public path segments encoded.
    }
    if (
      /^\d{3,}$/.test(decoded) ||
      /^[a-f0-9]{16,}$/i.test(decoded) ||
      /^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(decoded) ||
      decoded.length > 80
    )
      return ":id";
    return part;
  });
  const result = parts.join("/");
  return result.startsWith("/") ? result : `/${result}`;
}

function normalizeMetadata(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\p{Cc}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeMetadata(value: string, limit = 500): string {
  return normalizeMetadata(value)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/https?:\/\/[^\s]+/gi, "[redacted-url]")
    .replace(/(?<![A-Fa-f0-9-])\+?\d[\d ()-]{7,}\d(?![A-Fa-f0-9-])/g, "[redacted-phone]")
    .slice(0, limit);
}

export function sanitizeMachineMetadata(value: string, limit = 500): string {
  return normalizeMetadata(value)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted]")
    .replace(/https?:\/\/[^\s]+/gi, "[redacted]")
    .slice(0, limit);
}

function sanitizeField(field: RawField): RawField {
  if (field.options.length > 5000) throw new Error("Captured controls cannot exceed 5000 options.");
  return BoundedRawFieldSchema.parse({
    ...field,
    fieldId: sanitizeMachineMetadata(field.fieldId, 160),
    accessibleName: sanitizeMetadata(field.accessibleName),
    labelText: sanitizeMetadata(field.labelText),
    ariaLabel: sanitizeMetadata(field.ariaLabel),
    placeholder: sanitizeMetadata(field.placeholder),
    name: sanitizeMachineMetadata(field.name, 300),
    domId: sanitizeMachineMetadata(field.domId, 300),
    autocomplete: sanitizeMachineMetadata(field.autocomplete, 100),
    groupLabel: sanitizeMetadata(field.groupLabel),
    optionValue: sanitizeMachineMetadata(field.optionValue),
    checked: false,
    userEdited: false,
    options: field.options.map((option) => ({
      value: sanitizeMachineMetadata(option.value),
      text: sanitizeMetadata(option.text),
      disabled: option.disabled,
    })),
  });
}

function normalizedQaSourceUrl(urlInput: string, adapter: QaAdapter): URL {
  const url = validatePublicCaptureUrl(urlInput);
  if (adapter === "GREENHOUSE" && url.hostname === "boards.greenhouse.io")
    url.hostname = "job-boards.greenhouse.io";
  url.hash = "";
  const greenhouseJobId = adapter === "GREENHOUSE" ? url.searchParams.get("gh_jid") : null;
  url.search = greenhouseJobId ? `?gh_jid=${encodeURIComponent(greenhouseJobId)}` : "";
  return url;
}

export function createSanitizedQaFixture(
  snapshotInput: PageSnapshot,
  adapter: QaAdapter,
  adapterVersion: string,
): AtsQaFixture {
  const snapshot = PageSnapshotSchema.parse(snapshotInput);
  if (snapshot.fields.length > 500) throw new Error("Captured pages cannot exceed 500 fields.");
  const url = normalizedQaSourceUrl(snapshot.url, adapter);
  const urlDigest = sha256(url.href);
  url.search = "";
  const pattern = pathPattern(url.pathname);
  const capturedAt = snapshot.capturedAt;
  return AtsQaFixtureSchema.parse({
    qaFixtureVersion: 1,
    id: `${adapter.toLocaleLowerCase()}-${urlDigest.slice(0, 16)}`,
    adapter,
    adapterVersion,
    capturedAt,
    source: { host: url.hostname, pathPattern: pattern, urlSha256: urlDigest },
    snapshot: {
      ...snapshot,
      url: `https://${url.hostname}${pattern}`,
      title: `${adapter === "GREENHOUSE" ? "Greenhouse" : "Lever"} application fixture`,
      fields: snapshot.fields.map(sanitizeField),
    },
    safety: {
      valuesCaptured: false,
      cookiesCaptured: false,
      storageCaptured: false,
      mutatingRequestsBlocked: true,
      formInteractionsPerformed: false,
    },
    sanitized: true,
  });
}

export function qaFixtureIdForUrl(urlInput: string, adapter: QaAdapter): string {
  const url = normalizedQaSourceUrl(urlInput, adapter);
  return `${adapter.toLocaleLowerCase()}-${sha256(url.href).slice(0, 16)}`;
}

export function classifierForAdapter(adapter: QaAdapter): FieldClassifier {
  const atsAdapter = adapter === "GREENHOUSE" ? greenhouseAdapter : leverAdapter;
  return (field) => atsAdapter.classifyField(field) ?? classifyField(field);
}

export function adapterVersionFor(adapter: QaAdapter): string {
  return adapter === "GREENHOUSE" ? greenhouseAdapter.version : leverAdapter.version;
}

export function createSyntheticQaProfile(now = "2026-08-29T08:00:00.000Z"): CandidateProfile {
  const vault = createEmptyVault(now);
  const profile = saveProfileDraft(
    vault,
    {
      identity: { full: "Priya Example", given: "Priya", family: "Example" },
      email: "priya@example.test",
      phone: "+12025550117",
      portfolio: "https://portfolio.example.test",
      github: "https://github.example.test/priya",
      linkedin: "https://linkedin.example.test/in/priya",
      workHistory: [
        {
          id: "synthetic-work",
          employer: "Example Systems",
          title: "Software Engineer",
          location: "Example City",
          start: "2022-01-01",
          end: "",
          current: true,
          description: "Built accessible synthetic test systems.",
        },
      ],
      education: [
        {
          id: "synthetic-education",
          institution: "Aalborg University",
          degree: "BSc",
          fieldOfStudy: "Computer Science",
          start: "2018-08-01",
          end: "2028-08-01",
          current: false,
        },
      ],
      skills: ["TypeScript", "Accessibility"],
      workAuthorization: [
        {
          id: "synthetic-auth",
          countryCode: "US",
          currentlyAuthorized: "YES",
          currentSponsorshipRequired: "NO",
          futureSponsorshipRequired: "NO",
        },
      ],
    },
    now,
  ).currentProfile;
  const fact = <T>(path: string, value: T, sensitivity: "PERSONAL" | "SENSITIVE") => ({
    id: `fact:${path}`,
    path,
    value,
    status: "VERIFIED_USER" as const,
    sensitivity,
    sourceIds: ["synthetic-qa"],
    confidence: 1,
    verifiedAt: now,
    reuseScope: "GLOBAL" as const,
    version: profile.profileVersion,
  });
  return CandidateProfileSchema.parse({
    ...profile,
    contact: {
      ...profile.contact,
      addresses: [
        fact(
          "contact.addresses.0",
          {
            line1: "1 Example Way",
            city: "Example City",
            region: "CA",
            postalCode: "00000",
            countryCode: "US",
            kind: "HOME" as const,
          },
          "PERSONAL",
        ),
      ],
    },
    workAuthorization: profile.workAuthorization.map((authorization, index) => ({
      ...authorization,
      visaType: fact(`workAuthorization.${index}.visaType`, "Not applicable", "SENSITIVE"),
    })),
  });
}

function fieldLabel(field: RawField): string {
  const individual =
    field.accessibleName || field.labelText || field.ariaLabel || field.placeholder || field.name;
  if (!field.groupLabel) return individual;
  if (["radio", "checkbox"].includes(field.controlKind) && individual !== field.groupLabel)
    return `${field.groupLabel} — ${individual}`;
  if ([field.name, field.domId, field.fieldId].includes(individual)) return field.groupLabel;
  return individual;
}

function severityFor(mapping: FieldMapping, field: RawField): "SEVERE" | "NORMAL" {
  if (mapping.fillable || ["file", "radio", "checkbox"].includes(field.controlKind))
    return "SEVERE";
  if (
    mapping.canonicalQuestion?.startsWith("WORK_AUTH.") ||
    mapping.canonicalQuestion?.startsWith("CONSENT.") ||
    mapping.canonicalQuestion?.startsWith("APPLICATION.")
  )
    return "SEVERE";
  return "NORMAL";
}

function reviewReasons(mapping: FieldMapping, field: RawField): string[] {
  const reasons: string[] = [];
  if (mapping.fillable)
    reasons.push("Will be autofilled after user approval; verify the destination.");
  if (!mapping.canonicalQuestion)
    reasons.push(field.required ? "Required field is unmapped." : "Field is unmapped.");
  if (mapping.canonicalQuestion && mapping.confidence < 0.98)
    reasons.push("Mapping confidence is below 0.98.");
  if (["file", "radio", "checkbox"].includes(field.controlKind))
    reasons.push(`Sensitive control kind: ${field.controlKind}.`);
  if (mapping.blockedReason) reasons.push(mapping.blockedReason);
  return reasons.length ? reasons : ["Routine high-confidence mapping verification."];
}

function priorityFor(
  mapping: FieldMapping,
  field: RawField,
  severity: "SEVERE" | "NORMAL",
): ReviewPriority {
  if (severity === "SEVERE" || (field.required && !mapping.canonicalQuestion)) return "P0";
  if (!mapping.canonicalQuestion || mapping.confidence < 0.98 || mapping.blockedReason) return "P1";
  return "P2";
}

export function analyzeQaFixture(fixtureInput: AtsQaFixture, profile = createSyntheticQaProfile()) {
  const fixture = AtsQaFixtureSchema.parse(fixtureInput);
  return analyzeForm(
    fixture.snapshot,
    profile,
    `qa:${fixture.id}`,
    classifierForAdapter(fixture.adapter),
  );
}

export function createReviewTemplate(fixtureInput: AtsQaFixture): AtsQaReview {
  const fixture = AtsQaFixtureSchema.parse(fixtureInput);
  const analysis = analyzeQaFixture(fixture);
  const fieldsById = new Map(fixture.snapshot.fields.map((field) => [field.fieldId, field]));
  return AtsQaReviewSchema.parse({
    reviewVersion: 1,
    fixtureId: fixture.id,
    status: "PENDING",
    pageChecks: {
      correctAts: "UNREVIEWED",
      allVisibleFieldsCaptured: "UNREVIEWED",
      containsNoPersonalData: "UNREVIEWED",
      noFormInteractionOccurred: "UNREVIEWED",
    },
    fields: analysis.mappings.map((mapping) => {
      const field = fieldsById.get(mapping.fieldId);
      if (!field) throw new Error(`Missing captured field ${mapping.fieldId}.`);
      const severity = severityFor(mapping, field);
      return {
        fieldId: mapping.fieldId,
        decision: "UNREVIEWED" as const,
        severityIfWrong: severity,
        reviewContext: {
          capturedLabel: fieldLabel(field),
          predictedCanonicalQuestion: mapping.canonicalQuestion,
          confidence: mapping.confidence,
          tier: mapping.tier,
          priority: priorityFor(mapping, field, severity),
          reasons: reviewReasons(mapping, field),
        },
      };
    }),
  });
}

function isSpecialManualQuestion(canonical: CanonicalQuestion): boolean {
  return canonical.startsWith("APPLICATION.") || canonical === "CONSENT.terms";
}

function reviewComplete(review: AtsQaReview, fixture: AtsQaFixture): boolean {
  const checks = Object.values(review.pageChecks);
  const reviewedIds = new Set(review.fields.map((field) => field.fieldId));
  return (
    review.status === "REVIEWED" &&
    checks.every((check) => check === "PASS") &&
    review.fields.length === fixture.snapshot.fields.length &&
    fixture.snapshot.fields.every((field) => reviewedIds.has(field.fieldId)) &&
    review.fields.every((field) => field.decision !== "UNREVIEWED")
  );
}

export function evaluateQaFixture(
  fixtureInput: AtsQaFixture,
  reviewInput?: AtsQaReview,
): FixtureQaResult {
  const fixture = AtsQaFixtureSchema.parse(fixtureInput);
  const review = reviewInput ? AtsQaReviewSchema.parse(reviewInput) : createReviewTemplate(fixture);
  if (review.fixtureId !== fixture.id) throw new Error("Review fixtureId does not match fixture.");

  const analysis = analyzeQaFixture(fixture);
  const mappings = new Map(analysis.mappings.map((mapping) => [mapping.fieldId, mapping]));
  const reviews = new Map(review.fields.map((field) => [field.fieldId, field]));
  const reviewQueue: QaReviewQueueItem[] = [];
  let reviewedFields = 0;
  let evaluatedMappings = 0;
  let correctMappings = 0;
  let eligibleAutoFillFields = 0;
  let successfulAutoFillFields = 0;
  const eligibleRadioGroups = new Set<string>();
  const successfulRadioGroups = new Set<string>();
  let severeWrongFieldIncidents = 0;
  let unsupportedFields = 0;

  for (const field of fixture.snapshot.fields) {
    const mapping = mappings.get(field.fieldId);
    if (!mapping) throw new Error(`Missing analysis mapping for ${field.fieldId}.`);
    const fieldReview = reviews.get(field.fieldId);
    if (!fieldReview || fieldReview.decision === "UNREVIEWED") {
      const severity = fieldReview?.severityIfWrong ?? severityFor(mapping, field);
      reviewQueue.push({
        fixtureId: fixture.id,
        adapter: fixture.adapter,
        fieldId: field.fieldId,
        label: fieldLabel(field),
        predictedCanonicalQuestion: mapping.canonicalQuestion,
        confidence: mapping.confidence,
        tier: mapping.tier,
        priority: priorityFor(mapping, field, severity),
        reasons: reviewReasons(mapping, field),
        severityIfWrong: severity,
        controlKind: field.controlKind,
        required: field.required,
      });
      continue;
    }

    reviewedFields += 1;
    if (fieldReview.decision === "UNSUPPORTED") {
      unsupportedFields += 1;
      continue;
    }
    evaluatedMappings += 1;
    const expected =
      fieldReview.decision === "MAPPED" ? fieldReview.expectedCanonicalQuestion : null;
    const correct = mapping.canonicalQuestion === expected;
    if (correct) correctMappings += 1;
    if (mapping.canonicalQuestion !== null && !correct && fieldReview.severityIfWrong === "SEVERE")
      severeWrongFieldIncidents += 1;

    if (
      fieldReview.decision === "MAPPED" &&
      !isSpecialManualQuestion(fieldReview.expectedCanonicalQuestion)
    ) {
      if (field.controlKind === "radio") {
        const group = `${fieldReview.expectedCanonicalQuestion}:${field.name || field.groupLabel || field.fieldId}`;
        eligibleRadioGroups.add(group);
        if (correct && mapping.fillable) successfulRadioGroups.add(group);
      } else {
        eligibleAutoFillFields += 1;
        if (correct && mapping.fillable) successfulAutoFillFields += 1;
      }
    }
  }

  eligibleAutoFillFields += eligibleRadioGroups.size;
  successfulAutoFillFields += successfulRadioGroups.size;

  reviewQueue.sort((left, right) =>
    left.priority === right.priority
      ? left.fieldId.localeCompare(right.fieldId)
      : left.priority.localeCompare(right.priority),
  );
  return {
    fixtureId: fixture.id,
    adapter: fixture.adapter,
    fullyReviewed: reviewComplete(review, fixture),
    totalFields: fixture.snapshot.fields.length,
    reviewedFields,
    evaluatedMappings,
    correctMappings,
    mappingAccuracy: evaluatedMappings ? correctMappings / evaluatedMappings : null,
    eligibleAutoFillFields,
    successfulAutoFillFields,
    supportedFieldFillSuccess: eligibleAutoFillFields
      ? successfulAutoFillFields / eligibleAutoFillFields
      : null,
    severeWrongFieldIncidents,
    unsupportedFields,
    reviewQueue,
  };
}

export function aggregateQaResults(
  fixtures: FixtureQaResult[],
  generatedAt = new Date().toISOString(),
): QaGateReport {
  const distinctFixtureIds = new Set(fixtures.map((fixture) => fixture.fixtureId));
  if (distinctFixtureIds.size !== fixtures.length)
    throw new Error("QA gate input contains duplicate fixture IDs.");
  const sum = (select: (fixture: FixtureQaResult) => number) =>
    fixtures.reduce((total, fixture) => total + select(fixture), 0);
  const evaluatedMappings = sum((fixture) => fixture.evaluatedMappings);
  const correctMappings = sum((fixture) => fixture.correctMappings);
  const eligibleAutoFillFields = sum((fixture) => fixture.eligibleAutoFillFields);
  const successfulAutoFillFields = sum((fixture) => fixture.successfulAutoFillFields);
  const greenhouseForms = fixtures.filter((fixture) => fixture.adapter === "GREENHOUSE").length;
  const leverForms = fixtures.filter((fixture) => fixture.adapter === "LEVER").length;
  const fullyReviewedForms = fixtures.filter((fixture) => fixture.fullyReviewed).length;
  const severeWrongFieldIncidents = sum((fixture) => fixture.severeWrongFieldIncidents);
  const supportedFieldFillSuccess = eligibleAutoFillFields
    ? successfulAutoFillFields / eligibleAutoFillFields
    : null;
  const manualReviewBatches = buildManualReviewBatches(
    fixtures.flatMap((fixture) => fixture.reviewQueue),
  );
  const gate = {
    greenhouseSample: greenhouseForms >= 100,
    leverSample: leverForms >= 100,
    allFormsReviewed: fixtures.length > 0 && fullyReviewedForms === fixtures.length,
    fillSuccess: supportedFieldFillSuccess !== null && supportedFieldFillSuccess >= 0.98,
    noSevereWrongFieldIncidents: severeWrongFieldIncidents === 0,
  };
  return {
    generatedAt,
    fixtures,
    manualReviewBatches,
    totals: {
      greenhouseForms,
      leverForms,
      fullyReviewedForms,
      totalForms: fixtures.length,
      reviewedFields: sum((fixture) => fixture.reviewedFields),
      totalFields: sum((fixture) => fixture.totalFields),
      evaluatedMappings,
      correctMappings,
      mappingAccuracy: evaluatedMappings ? correctMappings / evaluatedMappings : null,
      eligibleAutoFillFields,
      successfulAutoFillFields,
      supportedFieldFillSuccess,
      severeWrongFieldIncidents,
      pendingReviewItems: sum((fixture) => fixture.reviewQueue.length),
      pendingManualBatches: manualReviewBatches.length,
    },
    gate: { ...gate, passed: Object.values(gate).every(Boolean) },
  };
}

function normalizedReviewLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function buildManualReviewBatches(queue: QaReviewQueueItem[]): QaManualReviewBatch[] {
  const batches = new Map<string, QaManualReviewBatch>();
  for (const item of queue) {
    const key = manualReviewBatchKey(item);
    const existing = batches.get(key);
    if (existing) {
      existing.occurrences += 1;
      if (!existing.fixtureIds.includes(item.fixtureId)) existing.fixtureIds.push(item.fixtureId);
      if (existing.exampleFieldIds.length < 5 && !existing.exampleFieldIds.includes(item.fieldId))
        existing.exampleFieldIds.push(item.fieldId);
      continue;
    }
    batches.set(key, {
      id: manualReviewBatchId(item),
      adapter: item.adapter,
      priority: item.priority,
      label: item.label,
      predictedCanonicalQuestion: item.predictedCanonicalQuestion,
      confidence: item.confidence,
      tier: item.tier,
      controlKind: item.controlKind,
      required: item.required,
      reasons: item.reasons,
      occurrences: 1,
      fixtureIds: [item.fixtureId],
      exampleFieldIds: [item.fieldId],
    });
  }
  return [...batches.values()].sort((left, right) =>
    left.priority === right.priority
      ? left.adapter === right.adapter
        ? left.label.localeCompare(right.label)
        : left.adapter.localeCompare(right.adapter)
      : left.priority.localeCompare(right.priority),
  );
}

function percent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(2)}%`;
}

export function qaReportMarkdown(report: QaGateReport): string {
  const rows = report.manualReviewBatches.length
    ? report.manualReviewBatches
        .map(
          (item) =>
            `| ${item.priority} | ${item.adapter} | ${item.occurrences} | ${item.controlKind}${item.required ? ", required" : ""} | ${item.label.replace(/\|/g, "\\|")} | ${item.predictedCanonicalQuestion ?? "UNMAPPED"} | ${item.id} | ${item.reasons.join(" ").replace(/\|/g, "\\|")} |`,
        )
        .join("\n")
    : "| - | - | 0 | - | No pending field reviews | - | - | - |";
  return `# ATS QA report

Generated: ${report.generatedAt}

## Gate summary

| Metric | Result | Requirement |
| --- | ---: | ---: |
| Greenhouse forms | ${report.totals.greenhouseForms} | 100 |
| Lever forms | ${report.totals.leverForms} | 100 |
| Fully reviewed forms | ${report.totals.fullyReviewedForms}/${report.totals.totalForms} | all |
| Mapping accuracy | ${percent(report.totals.mappingAccuracy)} | diagnostic |
| Supported-field fill success | ${percent(report.totals.supportedFieldFillSuccess)} | at least 98% |
| Severe wrong-field incidents | ${report.totals.severeWrongFieldIncidents} | 0 |
| Pending field reviews | ${report.totals.pendingReviewItems} | 0 |
| Unique manual field checks | ${report.totals.pendingManualBatches} | 0 |

Overall gate: **${report.gate.passed ? "PASS" : "NOT YET PASSED"}**

## Manual review queue

Identical controls are grouped by ATS, label, control kind, required state, prediction, confidence, tier, priority, and review reasons. Review each row once, then apply that decision to all occurrences only when the captured meaning is genuinely identical. Expand the batch from \`report.json\` if anything looks ambiguous. P0 is potentially severe, P1 is uncertain or unmapped, and P2 is routine high-confidence verification.

| Priority | ATS | Occurrences | Control | Captured label | Prediction | Batch | Why manual |
| --- | --- | ---: | --- | --- | --- | --- | --- |
${rows}

## Page-level manual checks

For every captured URL, confirm the ATS identity, confirm that all visible controls were represented (including iframe/custom widgets), confirm the fixture contains no personal data, and confirm the capture run did not interact with the form. Do not submit or upload anything.
`;
}
