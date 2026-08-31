import { ReuseScopeSchema } from "@copilot/candidate-schema";
import { FormAnalysisSchema, PageSnapshotSchema, RawFieldSchema } from "@copilot/form-schema";
import { QuestionClassificationSchema } from "@copilot/question-ontology";
import { SavedResponseSuggestionSchema } from "@copilot/saved-response-engine";
import { z } from "zod";

export const AtsIdSchema = z.enum([
  "GREENHOUSE",
  "LEVER",
  "ASHBY",
  "SMARTRECRUITERS",
  "WORKDAY",
  "ICIMS",
  "TALEO",
  "WORKABLE",
  "BAMBOOHR",
  "JOBVITE",
  "COMEET",
  "GENERIC",
  "UNKNOWN",
]);

export const AtsDetectionSchema = z.object({
  adapter: AtsIdSchema,
  adapterVersion: z.string().min(1),
  confidence: z.number().min(0).max(1),
  supported: z.boolean(),
  evidence: z.array(z.string().max(500)).max(20),
});

export const NormalizedJobSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  ats: AtsIdSchema,
  externalRequisitionId: z.string().min(1).max(500).optional(),
  title: z.string().min(1).max(500),
  company: z.string().min(1).max(500),
  description: z.string().max(100_000),
  location: z.string().min(1).max(1_000).optional(),
  remotePolicy: z.enum(["REMOTE", "HYBRID", "ONSITE", "UNKNOWN"]).default("UNKNOWN"),
  employmentType: z.string().min(1).optional(),
  salary: z.string().min(1).optional(),
  requiredSkills: z.array(z.string()).default([]),
  preferredSkills: z.array(z.string()).default([]),
  sourceUrl: z.url(),
  applicationUrl: z.url(),
  snapshotAt: z.iso.datetime({ offset: true }),
});

export const ConfirmationEvidenceSchema = z.object({
  confirmed: z.boolean(),
  evidence: z.array(z.string().max(500)).max(20),
  heading: z.string().min(1).optional(),
  referenceId: z.string().min(1).optional(),
});

export const WorkdayPageTypeSchema = z.enum([
  "JOB",
  "AUTH",
  "INTRO",
  "MY_INFORMATION",
  "MY_EXPERIENCE",
  "APPLICATION_QUESTIONS",
  "VOLUNTARY_DISCLOSURES",
  "TERMS",
  "REVIEW",
  "CONFIRMATION",
  "UNKNOWN",
]);

export const WorkdayAuthBoundarySchema = z.enum([
  "NONE",
  "SIGN_IN_REQUIRED",
  "ACCOUNT_REQUIRED",
  "VERIFICATION_REQUIRED",
  "SESSION_EXPIRED",
  "UNKNOWN",
]);

export const WorkdayWorkflowPageSchema = z.object({
  schemaVersion: z.literal(1),
  tenant: z.string().min(1).max(200),
  site: z.string().min(1).max(200),
  pageType: WorkdayPageTypeSchema,
  pageKey: z.string().min(1).max(500),
  fingerprint: z.string().regex(/^workday:[a-f0-9]{8}$/),
  heading: z.string().max(500),
  stepLabel: z.string().min(1).max(200).optional(),
  stepIndex: z.number().int().positive().optional(),
  stepCount: z.number().int().positive().optional(),
  visibleSections: z.array(z.string().min(1).max(200)).max(30),
  authBoundary: WorkdayAuthBoundarySchema,
  prefilledFieldCount: z.number().int().nonnegative(),
  resumeReconciliationRequired: z.boolean(),
  navigation: z.object({
    mode: z.literal("MANUAL_ONLY"),
    backVisible: z.boolean(),
    nextVisible: z.boolean(),
    submitVisible: z.boolean(),
    blockedReason: z.string().min(1).max(1_000).optional(),
  }),
  errorState: z
    .object({
      kind: z.enum(["VALIDATION", "SESSION_EXPIRED", "UNSUPPORTED"]),
      message: z.string().min(1).max(1_000),
      recoverable: z.boolean(),
    })
    .nullable(),
});

export const WorkdayWorkflowProgressSchema = z.object({
  schemaVersion: z.literal(1),
  recoveryKey: z.string().min(1).max(500),
  currentPageKey: z.string().min(1).max(500),
  currentPageType: WorkdayPageTypeSchema,
  currentStepIndex: z.number().int().positive().optional(),
  stepCount: z.number().int().positive().optional(),
  observedPageKeys: z.array(z.string().min(1).max(500)).max(50),
  observationCount: z.number().int().positive(),
  recovered: z.boolean(),
  revisitDetected: z.boolean(),
  lastFingerprint: z.string().regex(/^workday:[a-f0-9]{8}$/),
  lastObservedAt: z.iso.datetime({ offset: true }),
});

export const AtsPageReportSchema = z.object({
  reportVersion: z.literal(1),
  detection: AtsDetectionSchema,
  job: NormalizedJobSchema.nullable(),
  confirmation: ConfirmationEvidenceSchema,
  workflow: WorkdayWorkflowPageSchema.nullable().default(null),
});

export const InspectedApplicationPageSchema = z.object({
  snapshot: PageSnapshotSchema,
  atsReport: AtsPageReportSchema,
});

export const CustomQuestionSchema = z.object({
  field: RawFieldSchema,
  label: z.string().min(1),
  required: z.boolean(),
  responseMode: z.enum(["TEXT", "SELECT", "MANUAL"]),
  reviewReason: z.string().min(1),
  classification: QuestionClassificationSchema,
  savedResponse: SavedResponseSuggestionSchema,
});

export const ApplicationPageAnalysisSchema = FormAnalysisSchema.extend({
  applicationId: z.string().min(1).optional(),
  ats: AtsDetectionSchema,
  job: NormalizedJobSchema.nullable(),
  customQuestions: z.array(CustomQuestionSchema).max(200),
  confirmation: ConfirmationEvidenceSchema,
  workflow: WorkdayWorkflowPageSchema.nullable().default(null),
  workflowProgress: WorkdayWorkflowProgressSchema.optional(),
  duplicateWarnings: z
    .array(
      z.object({
        kind: z.enum([
          "ALREADY_TRACKED",
          "EXACT_REQUISITION",
          "EXACT_APPLICATION_URL",
          "MATCHING_JOB_DETAILS",
        ]),
        confidence: z.number().min(0).max(1),
        existingApplicationId: z.string().min(1),
        message: z.string().min(1).max(1_000),
        evidence: z.array(z.string().min(1).max(500)).min(1).max(10),
      }),
    )
    .max(20)
    .default([]),
});

export const ApprovedUploadFileSchema = z
  .object({
    fileName: z.string().min(1).max(255),
    mimeType: z.enum([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    base64: z
      .string()
      .min(1)
      .max(7_000_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .superRefine((file, context) => {
    const expectedExtension = file.mimeType === "application/pdf" ? ".pdf" : ".docx";
    if (!file.fileName.toLocaleLowerCase().endsWith(expectedExtension)) {
      context.addIssue({
        code: "custom",
        path: ["fileName"],
        message: `The filename must end with ${expectedExtension}.`,
      });
    }
  });

export const ApprovedUploadPlanSchema = z.object({
  approvalId: z.string().min(1),
  analysisId: z.string().min(1),
  fieldId: z.string().min(1),
  expiresAt: z.iso.datetime({ offset: true }),
  file: ApprovedUploadFileSchema,
});

export const UploadResultSchema = z.object({
  analysisId: z.string().min(1),
  fieldId: z.string().min(1),
  fileName: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  uploaded: z.boolean(),
  reason: z.string().optional(),
});

export const ReviewedCustomAnswerSchema = z.object({
  fieldId: z.string().min(1),
  value: z.string().max(20_000),
  saveScope: ReuseScopeSchema.optional(),
});

export const ApplicationStatusSchema = z.enum([
  "DISCOVERED",
  "SAVED",
  "SHORTLISTED",
  "APPLYING",
  "APPLIED",
  "SCREEN",
  "INTERVIEW",
  "FINAL",
  "OFFER",
  "REJECTED",
  "WITHDRAWN",
  "ARCHIVED",
]);

export const CanonicalJobIdentitySchema = z.object({
  identityVersion: z.literal(1),
  key: z.string().regex(/^job:[a-f0-9]{8}$/),
  strategy: z.enum(["ATS_REQUISITION", "APPLICATION_URL", "JOB_DETAILS"]),
  normalizedCompany: z.string().min(1).max(500),
  normalizedTitle: z.string().min(1).max(500),
  normalizedLocation: z.string().max(1_000),
  ats: AtsIdSchema,
  externalRequisitionId: z.string().min(1).max(500).optional(),
  normalizedApplicationUrl: z.url(),
});

export const JobSnapshotSchema = z.object({
  snapshotVersion: z.literal(1),
  snapshotId: z.string().regex(/^snapshot:[a-f0-9]{8}$/),
  capturedAt: z.iso.datetime({ offset: true }),
  fingerprint: z.string().regex(/^job:[a-f0-9]{8}$/),
  changedFields: z
    .array(
      z.enum([
        "title",
        "company",
        "description",
        "location",
        "remotePolicy",
        "employmentType",
        "salary",
        "requiredSkills",
        "preferredSkills",
        "sourceUrl",
        "applicationUrl",
      ]),
    )
    .max(20),
  job: NormalizedJobSchema,
});

export const DuplicateWarningSchema = z.object({
  kind: z.enum([
    "ALREADY_TRACKED",
    "EXACT_REQUISITION",
    "EXACT_APPLICATION_URL",
    "MATCHING_JOB_DETAILS",
  ]),
  confidence: z.number().min(0).max(1),
  existingApplicationId: z.string().min(1),
  message: z.string().min(1).max(1_000),
  evidence: z.array(z.string().min(1).max(500)).min(1).max(10),
});

export const LegacyApplicationRecordSchema = z.object({
  id: z.string().min(1),
  canonicalJobId: z.string().min(1),
  profileVersion: z.number().int().positive(),
  resumeFileName: z.string().min(1).optional(),
  resumeSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  discoveredAt: z.iso.datetime({ offset: true }),
  appliedAt: z.iso.datetime({ offset: true }).optional(),
  updatedAt: z.iso.datetime({ offset: true }),
  sourceUrl: z.url(),
  applicationUrl: z.url(),
  status: ApplicationStatusSchema,
  ats: AtsIdSchema,
  job: NormalizedJobSchema,
  confirmation: ConfirmationEvidenceSchema.optional(),
  workflowProgress: WorkdayWorkflowProgressSchema.optional(),
});

export const LegacyApplicationTrackerSchema = z.object({
  trackerVersion: z.literal(1),
  updatedAt: z.iso.datetime({ offset: true }),
  applications: z.array(LegacyApplicationRecordSchema).max(5_000),
});

export const ApplicationRecordSchema = LegacyApplicationRecordSchema.extend({
  canonicalIdentity: CanonicalJobIdentitySchema,
  snapshots: z.array(JobSnapshotSchema).min(1).max(50),
});

export const ApplicationTrackerSchema = z.object({
  trackerVersion: z.literal(2),
  updatedAt: z.iso.datetime({ offset: true }),
  applications: z.array(ApplicationRecordSchema).max(5_000),
});

export const TrackerCsvExportSchema = z.object({
  formatVersion: z.literal(1),
  csv: z.string().min(1),
  exported: z.number().int().nonnegative(),
});

export const TrackerCsvImportResultSchema = z.object({
  tracker: ApplicationTrackerSchema,
  imported: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  warnings: z.array(z.string().min(1).max(1_000)).max(500),
});

export type AtsId = z.infer<typeof AtsIdSchema>;
export type AtsDetection = z.infer<typeof AtsDetectionSchema>;
export type NormalizedJob = z.infer<typeof NormalizedJobSchema>;
export type ConfirmationEvidence = z.infer<typeof ConfirmationEvidenceSchema>;
export type WorkdayPageType = z.infer<typeof WorkdayPageTypeSchema>;
export type WorkdayAuthBoundary = z.infer<typeof WorkdayAuthBoundarySchema>;
export type WorkdayWorkflowPage = z.infer<typeof WorkdayWorkflowPageSchema>;
export type WorkdayWorkflowProgress = z.infer<typeof WorkdayWorkflowProgressSchema>;
export type AtsPageReport = z.infer<typeof AtsPageReportSchema>;
export type InspectedApplicationPage = z.infer<typeof InspectedApplicationPageSchema>;
export type CustomQuestion = z.infer<typeof CustomQuestionSchema>;
export type ApplicationPageAnalysis = z.infer<typeof ApplicationPageAnalysisSchema>;
export type ApprovedUploadFile = z.infer<typeof ApprovedUploadFileSchema>;
export type ApprovedUploadPlan = z.infer<typeof ApprovedUploadPlanSchema>;
export type UploadResult = z.infer<typeof UploadResultSchema>;
export type ReviewedCustomAnswer = z.infer<typeof ReviewedCustomAnswerSchema>;
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;
export type CanonicalJobIdentity = z.infer<typeof CanonicalJobIdentitySchema>;
export type JobSnapshot = z.infer<typeof JobSnapshotSchema>;
export type DuplicateWarning = z.infer<typeof DuplicateWarningSchema>;
export type LegacyApplicationTracker = z.infer<typeof LegacyApplicationTrackerSchema>;
export type ApplicationRecord = z.infer<typeof ApplicationRecordSchema>;
export type ApplicationTracker = z.infer<typeof ApplicationTrackerSchema>;
export type TrackerCsvExport = z.infer<typeof TrackerCsvExportSchema>;
export type TrackerCsvImportResult = z.infer<typeof TrackerCsvImportResultSchema>;
