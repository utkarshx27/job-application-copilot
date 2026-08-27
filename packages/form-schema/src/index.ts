import { z } from "zod";

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

export type RawField = z.infer<typeof RawFieldSchema>;
export type PageSnapshot = z.infer<typeof PageSnapshotSchema>;
export type SanitizedFixture = z.infer<typeof SanitizedFixtureSchema>;
