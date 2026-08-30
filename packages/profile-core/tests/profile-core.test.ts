import { describe, expect, it } from "vitest";

import {
  createEmptyVault,
  exportProfileBackup,
  importProfileBackup,
  importResumeDraft,
  migrateStoredProfile,
  profileToDraft,
  resolveProfileConflict,
  saveProfileDraft,
  saveProfileResponses,
  verifyImportedFacts,
} from "../src/index";
import { createSavedResponse } from "@copilot/saved-response-engine";

const firstTime = "2026-08-27T10:00:00.000Z";
const secondTime = "2026-08-27T11:00:00.000Z";

describe("profile vault", () => {
  it("versions verified Unicode profiles without inventing a surname", () => {
    const vault = createEmptyVault(firstTime);
    const draft = profileToDraft(vault.currentProfile);
    draft.identity = { full: "Arun Kumar", given: "Arun", family: "Kumar" };
    draft.email = "arun@example.com";
    draft.skills = ["TypeScript", "React"];
    draft.workHistory = [
      {
        id: "work-1",
        employer: "Example Labs",
        title: "Engineer",
        location: "Bengaluru",
        start: "2022-01-01",
        end: "",
        current: true,
        description: "Built accessible local-first software.",
      },
      {
        id: "work-2",
        employer: "Earlier Co",
        title: "Developer",
        location: "Pune",
        start: "2020-01-01",
        end: "2021-12-31",
        current: false,
        description: "Delivered web applications.",
      },
    ];

    const saved = saveProfileDraft(vault, draft, secondTime);
    expect(saved.currentProfile.profileVersion).toBe(2);
    expect(saved.history).toHaveLength(1);
    expect(saved.currentProfile.workHistory).toHaveLength(2);
    expect(saved.currentProfile.skills[0]?.sensitivity).toBe("PROFESSIONAL");
    expect(saved.currentProfile.identity.legalName.status).toBe("VERIFIED_USER");

    const UnicodeDraft = profileToDraft(saved.currentProfile);
    UnicodeDraft.identity = { full: "à®…à®°à¯à®£à¯", given: "à®…à®°à¯à®£à¯", family: "" };
    const UnicodeSaved = saveProfileDraft(saved, UnicodeDraft, "2026-08-27T12:00:00.000Z");
    expect(UnicodeSaved.currentProfile.identity.legalName.value?.family).toBeNull();
  });

  it("round-trips a current backup and rejects malformed imports", () => {
    const vault = createEmptyVault(firstTime);
    expect(importProfileBackup(exportProfileBackup(vault, secondTime))).toEqual(vault);
    expect(() => importProfileBackup("not-json")).toThrow("not valid JSON");
    expect(() => importProfileBackup('{"backupVersion":999}')).toThrow("unsupported version");
  });

  it("migrates a directly stored candidate profile into the versioned vault", () => {
    const vault = createEmptyVault(firstTime);
    const migrated = migrateStoredProfile(vault.currentProfile, secondTime);
    expect(migrated.vaultSchemaVersion).toBe(1);
    expect(migrated.currentProfile).toEqual(vault.currentProfile);
    expect(migrated.sources[0]?.displayName).toBe("Migrated local profile");
  });

  it("versions and replaces a saved response in the same scoped question slot", () => {
    const vault = createEmptyVault(firstTime);
    const context = { applicationId: "application:1", company: "ExampleCo" };
    const first = createSavedResponse({
      id: "response-1",
      question: "Why are you interested in ExampleCo?",
      answer: "First answer",
      reuseScope: "COMPANY",
      context,
      now: firstTime,
    });
    const saved = saveProfileResponses(vault, [first], secondTime);
    expect(saved.currentProfile.profileVersion).toBe(2);
    expect(saved.currentProfile.answerLibrary).toHaveLength(1);

    const replacement = createSavedResponse({
      id: "response-2",
      question: "Why are you interested in ExampleCo?",
      answer: "Updated answer",
      reuseScope: "COMPANY",
      context,
      now: secondTime,
    });
    const updated = saveProfileResponses(saved, [replacement], "2026-08-27T12:00:00.000Z");
    expect(updated.currentProfile.answerLibrary).toHaveLength(1);
    expect(updated.currentProfile.answerLibrary[0]?.answer).toBe("Updated answer");
    expect(updated.history).toHaveLength(2);
  });

  it("keeps conflicting résumé facts pending and verifies accepted document facts", () => {
    const empty = createEmptyVault(firstTime);
    const manualDraft = profileToDraft(empty.currentProfile);
    manualDraft.identity = { full: "Priya Sharma", given: "Priya", family: "Sharma" };
    manualDraft.email = "current@example.test";
    const manual = saveProfileDraft(empty, manualDraft, secondTime);
    const imported = importResumeDraft(
      manual,
      {
        identity: { full: "Priya Sharma", given: "Priya", family: "Sharma" },
        email: "resume@example.test",
        skills: ["TypeScript"],
        workHistory: [],
        education: [],
        warnings: [],
      },
      {
        id: "resume-source",
        kind: "RESUME_DOCX",
        displayName: "synthetic-resume.docx",
        sha256: "a".repeat(64),
        importedAt: "2026-08-27T12:00:00.000Z",
      },
      "2026-08-27T12:00:00.000Z",
    );

    expect(imported.currentProfile.contact.emails[0]?.value?.address).toBe("current@example.test");
    expect(imported.conflicts).toHaveLength(1);
    expect(imported.currentProfile.skills[0]?.status).toBe("VERIFIED_DOCUMENT");

    const resolved = resolveProfileConflict(
      imported,
      imported.conflicts[0]?.id ?? "missing",
      "USE_IMPORTED",
      "2026-08-27T13:00:00.000Z",
    );
    expect(resolved.currentProfile.contact.emails[0]?.value?.address).toBe("resume@example.test");
    expect(resolved.currentProfile.contact.emails[0]?.status).toBe("VERIFIED_DOCUMENT");
    expect(resolved.currentProfile.skills[0]?.status).toBe("VERIFIED_DOCUMENT");
    const verified = verifyImportedFacts(resolved, "2026-08-27T14:00:00.000Z");
    expect(verified.conflicts).toHaveLength(0);
    expect(verified.currentProfile.skills[0]?.status).toBe("VERIFIED_USER");
    expect(verified.currentProfile.skills[0]?.verifiedAt).toBe("2026-08-27T14:00:00.000Z");
  });
});
