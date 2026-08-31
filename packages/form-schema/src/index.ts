import { CanonicalQuestionSchema } from "@copilot/question-ontology";
import { z } from "zod";

export { CanonicalQuestionSchema } from "@copilot/question-ontology";
export type { CanonicalQuestion } from "@copilot/question-ontology";

export const FormControlKindSchema = z.enum([
  "text",
  "email",
  "tel",
  "url",
  "number",
  "date",
  "month",
  "textarea",
  "select-one",
  "select-multiple",
  "radio",
  "checkbox",
  "file",
  "other",
]);

export const RawFieldSchema = z.object({
  fieldId: z.string().min(1),
  controlKind: FormControlKindSchema,
  accessibleName: z.string(),
  labelText: z.string(),
  ariaLabel: z.string(),
  placeholder: z.string(),
  name: z.string(),
  domId: z.string(),
  required: z.boolean(),
  disabled: z.boolean(),
  readOnly: z.boolean(),
  autocomplete: z.string(),
  automationId: z.string().optional(),
  valueState: z.enum(["EMPTY", "PREFILLED", "COPILOT_FILLED", "USER_EDITED"]).optional(),
  maxLength: z.number().int().positive().max(20_000).optional(),
  groupLabel: z.string().default(""),
  optionValue: z.string().default(""),
  checked: z.boolean().default(false),
  userEdited: z.boolean().default(false),
  options: z.array(z.object({ value: z.string(), text: z.string(), disabled: z.boolean() })),
});

export const PageSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  url: z.url(),
  title: z.string(),
  capturedAt: z.iso.datetime({ offset: true }),
  fields: z.array(RawFieldSchema),
});

export const SanitizedFixtureSchema = z.object({
  fixtureVersion: z.literal(1),
  id: z.string().min(1),
  adapter: z.string().min(1),
  adapterVersion: z.string().min(1),
  capturedAt: z.iso.datetime({ offset: true }),
  source: z.object({ host: z.string().min(1), pathPattern: z.string().min(1) }),
  snapshot: PageSnapshotSchema,
  expectedCanonicalQuestions: z.record(z.string(), z.string().nullable()),
  dynamicBehavior: z.array(z.string()).default([]),
  sanitized: z.literal(true),
});

export const MappingTierSchema = z.enum(["R0", "R1", "R2", "UNMAPPED"]);

export const FillOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), value: z.string() }),
  z.object({ kind: z.literal("select"), value: z.string() }),
  z.object({ kind: z.literal("check"), checked: z.boolean() }),
]);

export const FieldMappingSchema = z.object({
  fieldId: z.string().min(1),
  canonicalQuestion: CanonicalQuestionSchema.nullable(),
  confidence: z.number().min(0).max(1),
  tier: MappingTierSchema,
  evidence: z.array(z.string()),
  operation: FillOperationSchema.optional(),
  fillable: z.boolean(),
  blockedReason: z.string().optional(),
});

export const FormAnalysisSchema = z.object({
  analysisVersion: z.literal(1),
  analysisId: z.string().min(1),
  snapshot: PageSnapshotSchema,
  mappings: z.array(FieldMappingSchema),
});

export const ReviewedFillItemSchema = z.object({
  fieldId: z.string().min(1),
  canonicalQuestion: CanonicalQuestionSchema,
  operation: FillOperationSchema,
});

export const FillPlanSchema = z.object({
  analysisId: z.string().min(1),
  items: z.array(ReviewedFillItemSchema).min(1),
});

export const FillResultSchema = z.object({
  analysisId: z.string().min(1),
  filledFieldIds: z.array(z.string().min(1)),
  skipped: z.array(z.object({ fieldId: z.string().min(1), reason: z.string() })),
});

export const HighlightResultSchema = z.object({
  highlightedFieldIds: z.array(z.string().min(1)),
});

export type RawField = z.infer<typeof RawFieldSchema>;
export type PageSnapshot = z.infer<typeof PageSnapshotSchema>;
export type SanitizedFixture = z.infer<typeof SanitizedFixtureSchema>;
export type FieldMapping = z.infer<typeof FieldMappingSchema>;
export type FormAnalysis = z.infer<typeof FormAnalysisSchema>;
export type FillOperation = z.infer<typeof FillOperationSchema>;
export type FillPlan = z.infer<typeof FillPlanSchema>;
export type FillResult = z.infer<typeof FillResultSchema>;
