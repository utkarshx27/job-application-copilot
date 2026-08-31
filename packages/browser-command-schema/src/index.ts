import { AiConfigStatusSchema, AiSessionConfigSchema } from "@copilot/ai-gateway";
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
  ProfileSourceSchema,
  ProfileVaultSchema,
  ResumeDraftSchema,
} from "@copilot/profile-core";
import { GroundedDraftResultSchema } from "@copilot/grounded-generation";
import { z } from "zod";

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
]);

export const PanelRequestSchema = z.discriminatedUnion("type", [
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
  ]),
  message: z.string(),
});

export const RuntimeResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    data: z.union([
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
