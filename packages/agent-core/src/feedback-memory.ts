import { z } from "zod";

// References only. Sensitive facts/consents and free-text answers stay in the
// existing private profile/answer workflow and cannot be invented by memory.
export const MemoryMeaningSchema = z.enum([
  "MANUAL",
  "IDENTITY.legal_name.full",
  "IDENTITY.legal_name.given",
  "IDENTITY.legal_name.family",
  "CONTACT.email",
  "CONTACT.phone",
  "PHONE_DIAL_CODE",
  "ADDRESS.country",
  "ADDRESS.city",
  "LINKS.linkedin",
  "LINKS.portfolio",
  "LINKS.github",
  "COMP.current_compensation",
  "COMP.desired_base",
  "AVAIL.notice_period",
]);
export const MemoryOwnerSchema = z
  .object({
    ownerId: z.string().min(1),
    profileId: z.string().min(1),
    profileRevision: z.number().int().positive(),
  })
  .strict();
export const MemoryScopeSchema = z
  .object({
    origin: z.url().refine((value) => {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) && url.origin === value;
    }),
    adapter: z.string().min(1).max(100),
    adapterVersion: z.string().min(1).max(100),
    locale: z.string().min(1).max(30),
    control: z.string().min(1).max(40),
    question: z.string().min(1).max(500),
    group: z.string().max(500),
  })
  .strict();
export const MemoryCorrectionSchema = z
  .object({
    id: z.string().uuid(),
    revision: z.number().int().positive(),
    kind: z.literal("FIELD_MEANING"),
    owner: MemoryOwnerSchema,
    scope: MemoryScopeSchema,
    rejected: z.string().max(150).nullable(),
    accepted: MemoryMeaningSchema,
    observationHash: z.string().regex(/^[a-f0-9]{64}$/),
    confirmed: z.literal(true),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .strict();
export const WorkflowStepSchema = z
  .object({
    kind: z.enum([
      "FILL_TEXT",
      "SELECT_OPTION",
      "OPEN_CONTROL",
      "ADD_ROW",
      "REMOVE_ROW",
      "UPLOAD_FILE",
      "NEXT",
    ]),
    parameter: z.enum([
      "name",
      "email",
      "country",
      "location",
      "locationQuery",
      "startDate",
      "employer",
      "resume",
      "control",
    ]),
  })
  .strict();
export const WorkflowMemorySchema = z
  .object({
    id: z.string().uuid(),
    revision: z.number().int().positive(),
    owner: MemoryOwnerSchema,
    state: z.enum(["CANDIDATE", "OFFLINE_VALIDATED", "ACTIVE", "RETIRED", "REJECTED"]),
    url: z.literal("http://127.0.0.1:4173/agent.html"),
    steps: z.array(WorkflowStepSchema).min(1).max(30),
    evidenceRunIds: z.array(z.string().uuid()).min(1).max(2),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .strict();
export type WorkflowMemory = z.infer<typeof WorkflowMemorySchema>;
export const MemoryStoreSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    corrections: z.array(MemoryCorrectionSchema).max(500),
    workflows: z.array(WorkflowMemorySchema).max(100).default([]),
  })
  .strict();
export const MemoryViewSchema = z
  .object({
    kind: z.literal("MEMORY_VIEW"),
    owner: MemoryOwnerSchema,
    revision: z.number().int().nonnegative(),
    corrections: z.array(MemoryCorrectionSchema),
    workflows: z.array(WorkflowMemorySchema).default([]),
  })
  .strict();
export type MemoryOwner = z.infer<typeof MemoryOwnerSchema>;
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;
export type MemoryStore = z.infer<typeof MemoryStoreSchema>;
export type MemoryCorrection = z.infer<typeof MemoryCorrectionSchema>;
export const emptyMemory = (): MemoryStore => ({
  version: 1,
  revision: 0,
  corrections: [],
  workflows: [],
});
export function normalizeMemoryText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\*/g, "").replace(/\s+/g, " ").trim();
}
export function canonicalMemoryScope(input: MemoryScope): MemoryScope {
  const scope = MemoryScopeSchema.parse(input);
  return {
    ...scope,
    question: normalizeMemoryText(scope.question),
    group: normalizeMemoryText(scope.group),
  };
}
export function sameMemoryOwner(a: MemoryOwner, b: MemoryOwner) {
  return a.ownerId === b.ownerId && a.profileId === b.profileId;
}
export function memoryOwnerKey(owner: MemoryOwner) {
  return JSON.stringify([owner.ownerId, owner.profileId]);
}
function scopeKey(scope: MemoryScope) {
  const s = canonicalMemoryScope(scope);
  return JSON.stringify([
    s.origin,
    s.adapter,
    s.adapterVersion,
    s.locale,
    s.control,
    s.question,
    s.group,
  ]);
}
export function retrieveCorrection(
  store: MemoryStore,
  owner: MemoryOwner,
  scope: MemoryScope,
  now: number,
) {
  const matches = store.corrections.filter(
    (entry) =>
      sameMemoryOwner(entry.owner, owner) &&
      entry.owner.profileRevision === owner.profileRevision &&
      entry.expiresAt > now &&
      entry.updatedAt <= now &&
      scopeKey(entry.scope) === scopeKey(scope),
  );
  if (!matches.length) return { status: "NONE" as const, records: [] };
  if (new Set(matches.map((entry) => entry.accepted)).size > 1)
    return { status: "CONFLICT" as const, records: matches.slice(0, 3) };
  return {
    status: "MATCH" as const,
    records: matches.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3),
  };
}
export function saveCorrection(
  storeInput: MemoryStore,
  recordInput: MemoryCorrection,
  expectedRevision: number,
) {
  const store = MemoryStoreSchema.parse(storeInput);
  const record = MemoryCorrectionSchema.parse(recordInput);
  const previous = store.corrections.find((entry) => entry.id === record.id);
  if ((previous?.revision ?? 0) !== expectedRevision)
    throw new Error("This correction changed. Refresh before editing.");
  if (
    previous &&
    (!sameMemoryOwner(previous.owner, record.owner) ||
      scopeKey(previous.scope) !== scopeKey(record.scope))
  )
    throw new Error("Correction ownership and scope cannot change.");
  if (
    record.expiresAt <= record.updatedAt ||
    record.expiresAt - record.updatedAt > 90 * 86400_000 ||
    record.createdAt > record.updatedAt
  )
    throw new Error("Correction expiry must be within 90 days.");
  if (
    previous &&
    (previous.createdAt !== record.createdAt || record.updatedAt < previous.updatedAt)
  )
    throw new Error("Correction history cannot move backwards.");
  return MemoryStoreSchema.parse({
    ...store,
    revision: store.revision + 1,
    corrections: [
      ...store.corrections.filter((entry) => entry.id !== record.id),
      { ...record, scope: canonicalMemoryScope(record.scope), revision: expectedRevision + 1 },
    ],
  });
}
export function forgetCorrection(
  store: MemoryStore,
  owner: MemoryOwner,
  id: string,
  expectedRevision: number,
) {
  const record = store.corrections.find(
    (entry) => entry.id === id && sameMemoryOwner(entry.owner, owner),
  );
  if (!record || record.revision !== expectedRevision)
    throw new Error("Correction changed or unavailable.");
  // No vector index or derived answer cache exists; removing the row removes all retrieval data.
  return MemoryStoreSchema.parse({
    ...store,
    revision: store.revision + 1,
    corrections: store.corrections.filter((entry) => entry !== record),
  });
}
