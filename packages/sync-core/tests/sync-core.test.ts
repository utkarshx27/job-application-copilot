import { createEmptyTracker } from "@copilot/application-state";
import { createEmptyVault, saveProfileDraft, saveCareerSetup } from "@copilot/profile-core";
import { emptyCareerPreferences } from "@copilot/candidate-schema";
import { describe, expect, it } from "vitest";

import {
  createSyncKdf,
  decryptSyncDataset,
  deriveSyncSecrets,
  encryptSyncDataset,
  mergeApplicationTrackers,
  mergeProfileVaults,
} from "../src/index";

const first = "2026-08-30T10:00:00.000Z";
const second = "2026-08-30T11:00:00.000Z";
const third = "2026-08-30T12:00:00.000Z";

describe("encrypted sync protocol", () => {
  it("preserves version 2 setup in encrypted sync and refuses a legacy overwrite", async () => {
    const original = createEmptyVault(first);
    const vault = saveCareerSetup(
      original,
      {
        expectedProfileVersion: 1,
        identity: { full: "Ada Lovelace", given: "Ada", family: "Lovelace" },
        email: "ada@example.test",
        phone: "",
        preferences: emptyCareerPreferences(),
        backgroundNotes: "Interested in Rust",
        reviewed: true,
      },
      second,
    );
    const secrets = await deriveSyncSecrets("correct horse battery staple", createSyncKdf());
    const envelope = await encryptSyncDataset(
      "PROFILE_VAULT",
      vault,
      secrets.encryptionKey,
      "device-1",
      second,
    );
    expect(await decryptSyncDataset(envelope, secrets.encryptionKey)).toEqual(vault);
    expect(mergeProfileVaults(original, vault).currentProfile.careerSetup).toEqual(
      vault.currentProfile.careerSetup,
    );
    expect(() => mergeProfileVaults({ ...original, updatedAt: third }, vault)).toThrow(
      "legacy profile cannot replace career setup",
    );
  });
  it("derives separated secrets and round-trips authenticated ciphertext", async () => {
    const kdf = createSyncKdf();
    const secrets = await deriveSyncSecrets("correct horse battery staple", kdf);
    expect(secrets.authSecret).not.toBe(secrets.encryptionKey);
    const vault = createEmptyVault(first);
    const envelope = await encryptSyncDataset(
      "PROFILE_VAULT",
      vault,
      secrets.encryptionKey,
      "device-1",
      second,
    );
    await expect(decryptSyncDataset(envelope, secrets.encryptionKey)).resolves.toEqual(vault);
    await expect(
      decryptSyncDataset(
        envelope,
        (await deriveSyncSecrets("wrong passphrase value", kdf)).encryptionKey,
      ),
    ).rejects.toThrow("could not be authenticated");
  });

  it("binds ciphertext to its declared dataset", async () => {
    const secrets = await deriveSyncSecrets("correct horse battery staple", createSyncKdf());
    const envelope = await encryptSyncDataset(
      "APPLICATION_TRACKER",
      createEmptyTracker(first),
      secrets.encryptionKey,
      "device-1",
      second,
    );
    await expect(
      decryptSyncDataset({ ...envelope, dataset: "PROFILE_VAULT" }, secrets.encryptionKey),
    ).rejects.toThrow("could not be authenticated");
  });
});

describe("conflict resolution", () => {
  it("keeps the newest profile while retaining both sources", () => {
    const local = createEmptyVault(first);
    const remote = saveProfileDraft(
      local,
      {
        identity: { full: "Ada Lovelace", given: "Ada", family: "Lovelace" },
        email: "ada@example.test",
        phone: "",
        portfolio: "",
        github: "",
        linkedin: "",
        workHistory: [],
        education: [],
        skills: [],
        workAuthorization: [],
      },
      second,
    );
    const newest = saveProfileDraft(
      remote,
      {
        identity: { full: "Ada Lovelace", given: "Ada", family: "Lovelace" },
        email: "ada.lovelace@example.test",
        phone: "",
        portfolio: "",
        github: "",
        linkedin: "",
        workHistory: [],
        education: [],
        skills: [],
        workAuthorization: [],
      },
      third,
    );
    const merged = mergeProfileVaults(local, newest);
    expect(merged).toMatchObject({ updatedAt: third, currentProfile: { profileVersion: 3 } });
    expect(merged.history.map((profile) => profile.profileVersion)).toEqual([1, 2]);
  });

  it("merges independent tracker records", () => {
    const local = createEmptyTracker(first);
    const remote = createEmptyTracker(second);
    expect(mergeApplicationTrackers(local, remote)).toEqual(remote);
  });
});
