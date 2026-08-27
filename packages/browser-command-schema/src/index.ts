import { PageSnapshotSchema } from "@copilot/form-schema";
import {
  ProfileDraftSchema,
  ProfileSourceSchema,
  ProfileVaultSchema,
  ResumeDraftSchema,
} from "@copilot/profile-core";
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
  z.object({ type: z.literal("CLICK_NEXT"), applicationId: z.string().min(1) }),
  z.object({ type: z.literal("READ_VALIDATION"), applicationId: z.string().min(1) }),
  z.object({ type: z.literal("READ_CONFIRMATION"), applicationId: z.string().min(1) }),
]);

export const PanelRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PANEL_PING") }),
  z.object({ type: z.literal("PANEL_SCAN_ACTIVE_TAB") }),
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
  ]),
  message: z.string(),
});

export const RuntimeResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    data: z.union([
      z.object({ pong: z.literal(true) }),
      PageSnapshotSchema,
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
