import { describe, it, expect } from "vitest";
import {
  emptyMemory,
  saveCorrection,
  retrieveCorrection,
  forgetCorrection,
  type MemoryCorrection,
} from "../src/feedback-memory";
const record = (changes: Partial<MemoryCorrection> = {}): MemoryCorrection => ({
  id: crypto.randomUUID(),
  revision: 1,
  kind: "FIELD_MEANING",
  owner: { ownerId: "owner", profileId: "profile", profileRevision: 1 },
  scope: {
    origin: "https://example.test",
    adapter: "GENERIC",
    adapterVersion: "1",
    locale: "en",
    control: "text",
    question: "Country code *",
    group: "Phone",
  },
  accepted: "PHONE_DIAL_CODE",
  rejected: "ADDRESS.country",
  confirmed: true,
  observationHash: "a".repeat(64),
  createdAt: 1000,
  updatedAt: 1000,
  expiresAt: 2000,
  ...changes,
});
describe("reviewed correction memory", () => {
  it("retrieves normalized equivalents without transferring to different meanings", () => {
    const entry = record();
    const store = saveCorrection(emptyMemory(), entry, 0);
    expect(
      retrieveCorrection(store, entry.owner, { ...entry.scope, question: " COUNTRY   CODE " }, 1001)
        .status,
    ).toBe("MATCH");
    for (const scope of [
      { ...entry.scope, group: "Residence" },
      { ...entry.scope, question: "Country" },
      { ...entry.scope, adapterVersion: "2" },
      { ...entry.scope, origin: "https://other.test" },
      { ...entry.scope, control: "select-one" },
      { ...entry.scope, locale: "hi" },
    ])
      expect(retrieveCorrection(store, entry.owner, scope, 1001).status).toBe("NONE");
  });
  it("keeps current and expected compensation separate", () => {
    const entry = record({
      scope: { ...record().scope, question: "Expected annual compensation", group: "Salary" },
      accepted: "COMP.desired_base",
    });
    const store = saveCorrection(emptyMemory(), entry, 0);
    for (const question of [
      "Current annual compensation",
      "Expected monthly compensation",
      "Expected hourly compensation",
    ])
      expect(
        retrieveCorrection(store, entry.owner, { ...entry.scope, question }, 1001).status,
      ).toBe("NONE");
  });
  it("enforces ownership, profile revision, clock and expiry", () => {
    const entry = record();
    const store = saveCorrection(emptyMemory(), entry, 0);
    for (const owner of [
      { ...entry.owner, ownerId: "other" },
      { ...entry.owner, profileId: "other" },
      { ...entry.owner, profileRevision: 2 },
    ])
      expect(retrieveCorrection(store, owner, entry.scope, 1001).status).toBe("NONE");
    for (const now of [999, 2000, 2001])
      expect(retrieveCorrection(store, entry.owner, entry.scope, now).status).toBe("NONE");
  });
  it("surfaces conflicts, edits with optimistic revision checks, and forgets all retrieval data", () => {
    const first = record();
    const second = record({ accepted: "ADDRESS.country" });
    let store = saveCorrection(saveCorrection(emptyMemory(), first, 0), second, 0);
    expect(retrieveCorrection(store, first.owner, first.scope, 1001).status).toBe("CONFLICT");
    expect(() => saveCorrection(store, first, 0)).toThrow(/changed/);
    store = saveCorrection(store, { ...first, accepted: "ADDRESS.country", updatedAt: 1001 }, 1);
    expect(retrieveCorrection(store, first.owner, first.scope, 1001).status).toBe("MATCH");
    expect(() =>
      forgetCorrection(store, { ...first.owner, ownerId: "other" }, first.id, 2),
    ).toThrow();
    store = forgetCorrection(
      forgetCorrection(store, first.owner, first.id, 2),
      first.owner,
      second.id,
      1,
    );
    expect(store.corrections).toEqual([]);
    expect(retrieveCorrection(store, first.owner, first.scope, 1001).status).toBe("NONE");
  });
  it("bounds retrieval and rejects arbitrary executable or personal answer payloads", () => {
    const first = record();
    let store = emptyMemory();
    for (let index = 0; index < 4; index++) store = saveCorrection(store, record(), 0);
    expect(retrieveCorrection(store, first.owner, first.scope, 1001).records).toHaveLength(3);
    expect(() =>
      saveCorrection(store, { ...first, answer: "private answer" } as MemoryCorrection, 0),
    ).toThrow();
    expect(() =>
      saveCorrection(
        store,
        { ...first, accepted: "eval(pageScript)" } as unknown as MemoryCorrection,
        0,
      ),
    ).toThrow();
  });
});
