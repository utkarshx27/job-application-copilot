import { AiConfigStatusSchema, AiSessionConfigSchema } from "@copilot/ai-gateway";
import {
  AgentLabStatusSchema,
  MemoryMeaningSchema,
  MemoryViewSchema,
  PreparationViewSchema,
  PreparationAnswersSchema,
  PreparationForgottenSchema,
  PreparationExtraAnswersSchema,
  PreparationFileSchema,
} from "@copilot/agent-core";
import {
  FillPlanSchema,
  FillResultSchema,
  FormAnalysisSchema,
  HighlightResultSchema,
  PageSnapshotSchema,
} from "@copilot/form-schema";
import {
  ApplicationPageAnalysisSchema,
  ApplicationStatusSchema,
  ApplicationTrackerSchema,
  ApprovedUploadFileSchema,
  ApprovedUploadPlanSchema,
  InspectedApplicationPageSchema,
  ReviewedCustomAnswerSchema,
  TrackerCsvExportSchema,
  TrackerCsvImportResultSchema,
  UploadResultSchema,
} from "@copilot/job-schema";
import {
  ProfileDraftSchema,
  CareerSetupDraftSchema,
  ProfileSourceSchema,
  ProfileVaultSchema,
  ResumeDraftSchema,
} from "@copilot/profile-core";
import { GroundedDraftResultSchema } from "@copilot/grounded-generation";
import {
  AutoNextActionResultSchema,
  AutoNextPanelStateSchema,
  ControlledNextClickResultSchema,
  ControlledNextPlanSchema,
} from "@copilot/navigation-core";
import {
  ControlledSubmitClickResultSchema,
  ControlledSubmitPlanSchema,
  SubmissionActionResultSchema,
  SubmissionPanelStateSchema,
} from "@copilot/submission-core";
import {
  SyncAccountStatusSchema,
  SyncBackupResultSchema,
  SyncDeletionResultSchema,
  SyncDevicesResultSchema,
  SyncLoginSchema,
  SyncRegistrationSchema,
  SyncRunResultSchema,
} from "@copilot/sync-core";
import { z } from "zod";
import { DiscoveryViewSchema, DiscoveryJobSchema } from "@copilot/agent-core";

const FieldCommandBaseSchema = z.object({
  applicationId: z.string().min(1),
  fieldId: z.string().min(1),
});

export const BrowserCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("READ_VISIBLE_FORM") }),
  FieldCommandBaseSchema.extend({ type: z.literal("FILL_TEXT"), value: z.string() }),
  FieldCommandBaseSchema.extend({ type: z.literal("SELECT_OPTION"), value: z.string() }),
  FieldCommandBaseSchema.extend({ type: z.literal("CHECK_BOX"), checked: z.boolean() }),
  FieldCommandBaseSchema.extend({
    type: z.literal("UPLOAD_APPROVED_FILE"),
    approvedFileId: z.string().min(1),
    expectedSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  }),
  z.object({ type: z.literal("READ_VALIDATION"), applicationId: z.string().min(1) }),
  z.object({ type: z.literal("READ_CONFIRMATION"), applicationId: z.string().min(1) }),
  z.object({ type: z.literal("CLICK_CONTROLLED_NEXT"), plan: ControlledNextPlanSchema }),
  z.object({ type: z.literal("CLICK_CONTROLLED_TEST_SUBMIT"), plan: ControlledSubmitPlanSchema }),
]);

export const PanelRequestSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("PANEL_PREPARATION_PAUSE"),
      id: z.uuid(),
      revision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("PANEL_PREPARATION_CLEAR_PRIVATE"),
      id: z.uuid(),
      revision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({ type: z.literal("PANEL_PREPARATION_REVIEW"), jobId: z.string().min(1).max(200) })
    .strict(),
  z.object({ type: z.literal("PANEL_PREPARATION_GET"), id: z.uuid() }).strict(),
  z
    .object({
      type: z.literal("PANEL_PREPARATION_COMPLETE"),
      id: z.uuid(),
      revision: z.number().int().positive(),
      confirmed: z.literal(true),
      answers: PreparationAnswersSchema.pick({ currentLocation: true, workArrangement: true }),
      extraAnswers: PreparationExtraAnswersSchema.nullable(),
      file: PreparationFileSchema.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("PANEL_PREPARATION_RESUME"),
      id: z.uuid(),
      revision: z.number().int().positive(),
      confirmed: z.literal(true),
      answers: z
        .array(
          z
            .object({
              key: z.string().min(1).max(100),
              value: z.string().max(5000),
              meaning: MemoryMeaningSchema.nullable(),
              remember: z.boolean(),
            })
            .strict(),
        )
        .max(30),
    })
    .strict(),
  z
    .object({
      type: z.literal("PANEL_PREPARATION_SUBMIT"),
      id: z.uuid(),
      revision: z.number().int().positive(),
      confirmed: z.literal(true),
    })
    .strict(),
  z.object({ type: z.literal("PANEL_PREPARATION_RECEIPT"), id: z.uuid() }).strict(),
  z
    .object({
      type: z.literal("PANEL_PREPARATION_WORKFLOW"),
      id: z.uuid(),
      confirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("PANEL_PREPARATION_CANCEL"),
      id: z.uuid(),
      revision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("PANEL_PREPARATION_FORGET"),
      id: z.uuid(),
      revision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("PANEL_PREPARATION_APPROVE"),
      id: z.uuid(),
      revision: z.number().int().positive(),
      confirmed: z.literal(true),
      answers: PreparationAnswersSchema.pick({ currentLocation: true, workArrangement: true }),
    })
    .strict(),
  z.object({ type: z.literal("PANEL_JOBS_GET") }).strict(),
  z.object({ type: z.literal("PANEL_JOBS_SEARCH"), query: z.string().max(200) }).strict(),
  z.object({ type: z.literal("PANEL_JOBS_CANCEL") }).strict(),
  z
    .object({
      type: z.literal("PANEL_JOBS_IMPORT"),
      title: z.string().min(1).max(300),
      company: z.string().min(1).max(80),
      location: z.string().max(80),
      url: DiscoveryJobSchema.shape.sourceUrl,
      description: z.string().max(20000),
    })
    .strict(),
  z
    .object({
      type: z.literal("PANEL_JOBS_DISMISS"),
      id: z.string().min(1),
      dismissed: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal("PANEL_JOBS_FORGET"), id: z.string().min(1) }).strict(),
  z
    .object({
      type: z.literal("PANEL_JOBS_EVIDENCE"),
      id: z.string().min(1),
      rating: z
        .object({
          source: z.string().min(1).max(300),
          sourceUrl: DiscoveryJobSchema.shape.sourceUrl,
          value: z.number().finite().nonnegative(),
          scale: z.number().finite().positive().max(100),
          count: z.number().int().nonnegative(),
          retrievedAt: z.iso.date(),
        })
        .strict()
        .refine((rating) => rating.value <= rating.scale),
      confirmed: z.literal(true),
    })
    .strict(),
  z.object({ type: z.literal("PANEL_JOBS_FORGET_EVIDENCE"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("PANEL_WORKFLOW_CAPTURE"), runId: z.string().uuid() }).strict(),
  z
    .object({
      type: z.literal("PANEL_WORKFLOW_CHANGE"),
      id: z.string().uuid(),
      revision: z.number().int().positive(),
      action: z.enum(["VALIDATE", "ACTIVATE", "RETIRE", "FORGET"]),
      runId: z.string().uuid().optional(),
    })
    .strict(),
  z.object({ type: z.literal("PANEL_MEMORY_GET") }).strict(),
  z
    .object({
      type: z.literal("PANEL_MEMORY_CORRECT"),
      analysisId: z.string().min(1),
      fieldId: z.string().min(1),
      accepted: MemoryMeaningSchema,
      confirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("PANEL_MEMORY_EDIT"),
      id: z.string().uuid(),
      revision: z.number().int().positive(),
      accepted: MemoryMeaningSchema,
      confirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("PANEL_MEMORY_FORGET"),
      id: z.string().uuid(),
      revision: z.number().int().positive(),
    })
    .strict(),
  z.object({ type: z.literal("PANEL_EXECUTOR_STATUS") }).strict(),
  z.object({ type: z.literal("PANEL_EXECUTOR_ENABLE"), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal("PANEL_EXECUTOR_START"), approved: z.literal(true) }).strict(),
  z.object({ type: z.literal("PANEL_EXECUTOR_RESUME"), runId: z.uuid() }).strict(),
  z.object({ type: z.literal("PANEL_EXECUTOR_PAUSE"), runId: z.uuid() }).strict(),
  z.object({ type: z.literal("PANEL_EXECUTOR_CANCEL"), runId: z.uuid() }).strict(),
  z.object({ type: z.literal("PANEL_EXECUTOR_VISUAL"), runId: z.uuid() }).strict(),
  z.object({ type: z.literal("PANEL_PROFILE_SETUP_SAVE"), draft: CareerSetupDraftSchema }).strict(),
  z
    .object({
      type: z.literal("PANEL_PROFILE_IMPORT_NARRATIVE"),
      text: z.string().trim().min(1).max(20_000),
      expectedProfileVersion: z.number().int().positive(),
    })
    .strict(),
  z.object({ type: z.literal("PANEL_AGENT_STATUS") }).strict(),
  z.object({ type: z.literal("PANEL_AGENT_SET_ENABLED"), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal("PANEL_AGENT_START") }).strict(),
  z.object({ type: z.literal("PANEL_AGENT_CHECKPOINT"), runId: z.uuid() }).strict(),
  z.object({ type: z.literal("PANEL_AGENT_PAUSE"), runId: z.uuid() }).strict(),
  z.object({ type: z.literal("PANEL_AGENT_CANCEL"), runId: z.uuid() }).strict(),
  z.object({ type: z.literal("PANEL_PING") }),
  z.object({ type: z.literal("PANEL_SCAN_ACTIVE_TAB") }),
  z.object({ type: z.literal("PANEL_ANALYZE_ACTIVE_TAB") }),
  z.object({ type: z.literal("PANEL_TRACKER_GET") }),
  z.object({
    type: z.literal("PANEL_TRACKER_UPDATE_STATUS"),
    applicationId: z.string().min(1),
    status: ApplicationStatusSchema,
  }),
  z.object({ type: z.literal("PANEL_TRACKER_EXPORT_CSV") }),
  z.object({ type: z.literal("PANEL_TRACKER_IMPORT_CSV"), csv: z.string().min(1).max(10_000_000) }),
  z.object({ type: z.literal("PANEL_AI_CONFIG_GET") }),
  z.object({ type: z.literal("PANEL_AI_CONFIG_SET"), config: AiSessionConfigSchema }),
  z.object({ type: z.literal("PANEL_AI_CONFIG_CLEAR") }),
  z.object({ type: z.literal("PANEL_SYNC_STATUS") }),
  z.object({ type: z.literal("PANEL_SYNC_REGISTER"), input: SyncRegistrationSchema }),
  z.object({ type: z.literal("PANEL_SYNC_LOGIN"), input: SyncLoginSchema }),
  z.object({ type: z.literal("PANEL_SYNC_RUN") }),
  z.object({ type: z.literal("PANEL_SYNC_DEVICES") }),
  z.object({ type: z.literal("PANEL_SYNC_REVOKE_DEVICE"), deviceId: z.string().min(1) }),
  z.object({ type: z.literal("PANEL_SYNC_EXPORT_BACKUP") }),
  z.object({ type: z.literal("PANEL_SYNC_LOCK") }),
  z.object({ type: z.literal("PANEL_SYNC_DISABLE") }),
  z.object({ type: z.literal("PANEL_SYNC_DELETE_ACCOUNT") }),
  z.object({ type: z.literal("PANEL_AUTO_NEXT_STATUS"), analysisId: z.string().min(1) }),
  z.object({
    type: z.literal("PANEL_AUTO_NEXT_SET_ENABLED"),
    analysisId: z.string().min(1),
    enabled: z.boolean(),
  }),
  z.object({
    type: z.literal("PANEL_AUTO_NEXT_SET_APPLICATION"),
    analysisId: z.string().min(1),
    enabled: z.boolean(),
  }),
  z.object({ type: z.literal("PANEL_AUTO_NEXT_PREPARE"), analysisId: z.string().min(1) }),
  z.object({ type: z.literal("PANEL_AUTO_NEXT_EXECUTE"), intentId: z.string().min(1) }),
  z.object({ type: z.literal("PANEL_AUTO_NEXT_ABORT"), intentId: z.string().min(1) }),
  z.object({ type: z.literal("PANEL_SUBMISSION_STATUS"), analysisId: z.string().min(1) }),
  z.object({
    type: z.literal("PANEL_SUBMISSION_SET_ENABLED"),
    analysisId: z.string().min(1),
    enabled: z.boolean(),
  }),
  z.object({
    type: z.literal("PANEL_SUBMISSION_SET_APPLICATION"),
    analysisId: z.string().min(1),
    enabled: z.boolean(),
  }),
  z.object({
    type: z.literal("PANEL_SUBMISSION_PREPARE"),
    analysisId: z.string().min(1),
    explicitConsent: z.literal(true),
  }),
  z.object({ type: z.literal("PANEL_SUBMISSION_EXECUTE"), intentId: z.string().min(1) }),
  z.object({ type: z.literal("PANEL_SUBMISSION_ABORT"), intentId: z.string().min(1) }),
  z.object({
    type: z.literal("PANEL_AI_DRAFT"),
    analysisId: z.string().min(1),
    fieldId: z.string().min(1),
    maxChars: z.number().int().min(50).max(20_000),
  }),
  z.object({
    type: z.literal("PANEL_HIGHLIGHT_ACTIVE_FIELDS"),
    analysisId: z.string().min(1),
    fieldIds: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    type: z.literal("PANEL_FILL_ACTIVE_FIELDS"),
    analysisId: z.string().min(1),
    fieldIds: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    type: z.literal("PANEL_FILL_CUSTOM_ANSWERS"),
    analysisId: z.string().min(1),
    answers: z.array(ReviewedCustomAnswerSchema).min(1),
  }),
  z.object({
    type: z.literal("PANEL_UPLOAD_APPROVED_RESUME"),
    analysisId: z.string().min(1),
    fieldId: z.string().min(1),
    file: ApprovedUploadFileSchema,
  }),
  z.object({ type: z.literal("PANEL_PROFILE_GET") }),
  z.object({ type: z.literal("PANEL_PROFILE_SAVE"), draft: ProfileDraftSchema }),
  z.object({ type: z.literal("PANEL_PROFILE_EXPORT") }),
  z.object({ type: z.literal("PANEL_PROFILE_IMPORT_JSON"), json: z.string().min(1) }),
  z.object({
    type: z.literal("PANEL_PROFILE_IMPORT_RESUME"),
    draft: ResumeDraftSchema,
    source: ProfileSourceSchema,
  }),
  z.object({ type: z.literal("PANEL_PROFILE_VERIFY_IMPORTED") }),
  z.object({
    type: z.literal("PANEL_PROFILE_RESOLVE_CONFLICT"),
    conflictId: z.string().min(1),
    resolution: z.enum(["KEEP_EXISTING", "USE_IMPORTED"]),
  }),
]);

export const ContentRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CONTENT_PING") }),
  z.object({ type: z.literal("CONTENT_SCAN_PAGE") }),
  z.object({ type: z.literal("CONTENT_INSPECT_APPLICATION") }),
  z.object({ type: z.literal("CONTENT_HIGHLIGHT_FIELDS"), fieldIds: z.array(z.string().min(1)) }),
  z.object({ type: z.literal("CONTENT_APPLY_FILL"), plan: FillPlanSchema }),
  z.object({ type: z.literal("CONTENT_UPLOAD_APPROVED_FILE"), plan: ApprovedUploadPlanSchema }),
  z.object({ type: z.literal("CONTENT_EXECUTE_CONTROLLED_NEXT"), plan: ControlledNextPlanSchema }),
  z.object({
    type: z.literal("CONTENT_EXECUTE_CONTROLLED_SUBMIT"),
    plan: ControlledSubmitPlanSchema,
  }),
]);

const RuntimeErrorSchema = z.object({
  code: z.enum([
    "BAD_MESSAGE",
    "NO_ACTIVE_TAB",
    "UNSUPPORTED_PAGE",
    "BLOCKED_BY_POLICY",
    "INJECTION_FAILED",
    "SCAN_FAILED",
    "PROFILE_STORAGE_FAILED",
    "PROFILE_INVALID",
    "STALE_ANALYSIS",
    "FILL_FAILED",
    "UPLOAD_FAILED",
    "AI_NOT_CONFIGURED",
    "AI_POLICY_BLOCKED",
    "AI_PROVIDER_FAILED",
    "AI_OUTPUT_REJECTED",
    "TRACKER_INVALID",
    "SYNC_FAILED",
    "NAVIGATION_BLOCKED",
    "NAVIGATION_FAILED",
    "SUBMISSION_BLOCKED",
    "SUBMISSION_FAILED",
    "AGENT_FAILED",
  ]),
  message: z.string(),
});

export const RuntimeResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    data: z.union([
      MemoryViewSchema,
      PreparationViewSchema,
      PreparationForgottenSchema,
      DiscoveryViewSchema,
      z
        .object({
          kind: z.literal("LOCAL_VISUAL_REVIEW"),
          image: z.string().startsWith("data:image/jpeg;base64,").max(1_400_100),
        })
        .strict(),
      AgentLabStatusSchema,
      z.object({ pong: z.literal(true) }),
      PageSnapshotSchema,
      ApplicationPageAnalysisSchema,
      FormAnalysisSchema,
      InspectedApplicationPageSchema,
      FillResultSchema,
      HighlightResultSchema,
      UploadResultSchema,
      ApplicationTrackerSchema,
      TrackerCsvExportSchema,
      TrackerCsvImportResultSchema,
      AiConfigStatusSchema,
      SyncAccountStatusSchema,
      SyncRunResultSchema,
      SyncDevicesResultSchema,
      SyncBackupResultSchema,
      SyncDeletionResultSchema,
      AutoNextPanelStateSchema,
      AutoNextActionResultSchema,
      ControlledNextClickResultSchema,
      SubmissionPanelStateSchema,
      SubmissionActionResultSchema,
      ControlledSubmitClickResultSchema,
      GroundedDraftResultSchema,
      ProfileVaultSchema,
      z.object({ backupJson: z.string() }),
    ]),
  }),
  z.object({ ok: z.literal(false), error: RuntimeErrorSchema }),
]);

export type BrowserCommand = z.infer<typeof BrowserCommandSchema>;
export type PanelRequest = z.infer<typeof PanelRequestSchema>;
export type ContentRequest = z.infer<typeof ContentRequestSchema>;
export type RuntimeResponse = z.infer<typeof RuntimeResponseSchema>;
