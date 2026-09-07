import { describe, expect, it } from "vitest";
import { emptyCareerPreferences } from "@copilot/candidate-schema";
import {
  createEmptyVault,
  saveCareerSetup,
  exportProfileBackup,
  importProfileBackup,
  migrateStoredProfile,
  careerReadiness,
  importResumeDraft,
  type CareerSetupDraft,
} from "../src/index";

const draft = (version = 1): CareerSetupDraft => ({
  expectedProfileVersion: version,
  identity: { full: "Priya Sharma", given: "Priya", family: "Sharma" },
  email: "priya@example.test",
  phone: "+919876543210",
  preferences: {
    ...emptyCareerPreferences(),
    targetRoles: ["Engineer"],
    workArrangements: ["REMOTE"],
    totalExperienceMonths: 36,
    noticePeriodDays: 30,
    currentCompensation: { amount: 900000, currency: "INR", period: "YEAR" },
    expectedCompensation: { amount: 150000, currency: "INR", period: "MONTH" },
  },
  backgroundNotes: "I want to work with Rust",
  reviewed: true,
});
describe("career setup and compatibility", () => {
  it("migrates on save, preserves the original and round-trips preferences with separate pay units", () => {
    const before = createEmptyVault();
    const snapshot = structuredClone(before);
    const saved = saveCareerSetup(before, draft());
    expect(before).toEqual(snapshot);
    expect(saved.vaultSchemaVersion).toBe(2);
    expect(saved.currentProfile.schemaVersion).toBe(2);
    expect(saved.history[0]).toEqual(before.currentProfile);
    expect(saved.currentProfile.careerSetup?.preferences).toMatchObject({
      totalExperienceMonths: 36,
      noticePeriodDays: 30,
      currentCompensation: { amount: 900000, period: "YEAR" },
      expectedCompensation: { amount: 150000, period: "MONTH" },
    });
    expect(importProfileBackup(exportProfileBackup(saved))).toEqual(saved);
    expect(migrateStoredProfile(before)).toEqual(before);
    expect(careerReadiness(saved)).toEqual({ ready: true, missing: [] });
    expect(saved.currentProfile.skills).toEqual([]);
    expect(saved.currentProfile.workAuthorization).toEqual([]);
  });
  it("rejects stale edits, unsupported versions, invalid values and conflicts without changing the vault", () => {
    const vault = saveCareerSetup(createEmptyVault(), draft());
    const snapshot = structuredClone(vault);
    expect(() => saveCareerSetup(vault, draft())).toThrow("changed in another view");
    expect(() =>
      saveCareerSetup(
        {
          ...vault,
          conflicts: [
            {
              id: "conflict-1",
              path: "contact.emails.0",
              existingValue: "old@example.test",
              importedValue: "new@example.test",
              sourceId: "doc-1",
              createdAt: vault.updatedAt,
            },
          ],
        },
        draft(2),
      ),
    ).toThrow("Resolve your import conflicts");
    expect(() =>
      saveCareerSetup(vault, {
        ...draft(2),
        preferences: { ...draft().preferences, noticePeriodDays: -1 },
      }),
    ).toThrow();
    expect(() =>
      importProfileBackup(
        exportProfileBackup(vault).replace('"backupVersion": 2', '"backupVersion": 99'),
      ),
    ).toThrow("unsupported");
    expect(() =>
      importProfileBackup(
        exportProfileBackup(vault).replace('"backupVersion": 2', '"backupVersion": 1'),
      ),
    ).toThrow("unsupported");
    expect(vault).toEqual(snapshot);
  });
  it("keeps imported work and skills unverified when saving only compact contact/preferences", () => {
    const imported = importResumeDraft(
      createEmptyVault(),
      { skills: ["TypeScript"], workHistory: [], education: [], warnings: [] },
      {
        id: "doc-1",
        kind: "RESUME_PDF",
        displayName: "Synthetic resume",
        importedAt: new Date().toISOString(),
      },
    );
    const saved = saveCareerSetup(imported, draft(imported.currentProfile.profileVersion));
    expect(saved.currentProfile.skills[0]?.status).toBe("VERIFIED_DOCUMENT");
    expect(saved.currentProfile.skills[0]?.sourceIds).toEqual(["doc-1"]);
    expect(careerReadiness(saved).missing).toContain("Review imported facts");
  });
});
