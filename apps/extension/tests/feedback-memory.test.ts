import { it, expect } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createEmptyVault } from "@copilot/profile-core";
import { emptyMemory, saveCorrection, type MemoryCorrection } from "@copilot/agent-core";
import { RawFieldSchema, type FieldMapping } from "@copilot/form-schema";
import { MemoryRepository, correctedMapping, memoryOwner } from "../src/feedback-memory";

it("serializes concurrent edits and persists deletion across repository instances", async () => {
  const factory = new IDBFactory();
  const first = new MemoryRepository(factory);
  const second = new MemoryRepository(factory);
  const record: MemoryCorrection = {
    id: crypto.randomUUID(),
    revision: 1,
    kind: "FIELD_MEANING",
    owner: { ownerId: "owner", profileId: "profile", profileRevision: 1 },
    scope: {
      origin: "https://example.test",
      adapter: "GENERIC",
      adapterVersion: "1",
      locale: "und",
      question: "Inbox",
      group: "",
      control: "text",
    },
    accepted: "CONTACT.email",
    rejected: null,
    confirmed: true,
    observationHash: "a".repeat(64),
    createdAt: 1000,
    updatedAt: 1000,
    expiresAt: 2000,
  };
  await first.save(record, 0);
  const results = await Promise.allSettled([first.save(record, 1), second.save(record, 1)]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect((await second.view(record.owner)).corrections[0]?.revision).toBe(2);
  await second.forget(record.owner, record.id, 2);
  expect((await first.view(record.owner)).corrections).toEqual([]);
});
it("will not turn an unverified profile fact or a consent label into an autofill mapping", () => {
  const vault = createEmptyVault();
  const owner = memoryOwner(vault);
  const field = RawFieldSchema.parse({
    fieldId: "inbox",
    controlKind: "text",
    accessibleName: "Inbox",
    labelText: "Inbox",
    ariaLabel: "",
    placeholder: "",
    name: "inbox",
    domId: "inbox",
    required: false,
    disabled: false,
    readOnly: false,
    autocomplete: "",
    options: [],
  });
  const scope = {
    origin: "https://example.test",
    adapter: "GENERIC",
    adapterVersion: "1",
    locale: "und",
    question: "Inbox",
    group: "",
    control: "text",
  };
  const record: MemoryCorrection = {
    id: crypto.randomUUID(),
    revision: 1,
    kind: "FIELD_MEANING",
    owner,
    scope,
    accepted: "CONTACT.email",
    rejected: null,
    confirmed: true,
    observationHash: "a".repeat(64),
    createdAt: 1000,
    updatedAt: 1000,
    expiresAt: 2000,
  };
  const store = saveCorrection(emptyMemory(), record, 0);
  const base: FieldMapping = {
    fieldId: "inbox",
    canonicalQuestion: null,
    confidence: 0,
    tier: "UNMAPPED",
    evidence: [],
    fillable: false,
  };
  const result = correctedMapping(base, field, store, owner, scope, vault.currentProfile, 1001);
  expect(result.canonicalQuestion).toBeNull();
  expect(result.blockedReason).toMatch(/Verify/);
  expect(
    correctedMapping(
      base,
      field,
      store,
      owner,
      { ...scope, question: "Consent to marketing" },
      vault.currentProfile,
      1001,
    ),
  ).toEqual(base);
});
