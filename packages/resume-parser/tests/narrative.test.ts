import { expect, it } from "vitest";
import { parseNarrativeIntake } from "../src/index";
import { createEmptyVault, importResumeDraft } from "@copilot/profile-core";

it("treats aspirations and free history as context and imports only labelled contact suggestions", () => {
  const draft = parseNarrativeIntake(
    "Name: Priya Sharma\nEmail: priya@example.test\nI want to work with Rust\nI expect INR 150000 per month\nSkills: I want to learn Go",
  );
  expect(draft.skills).toEqual([]);
  expect(draft.workHistory).toEqual([]);
  const vault = importResumeDraft(createEmptyVault(), draft, {
    id: "notes-1",
    kind: "NARRATIVE",
    displayName: "Background notes",
    importedAt: new Date().toISOString(),
  });
  expect(vault.vaultSchemaVersion).toBe(2);
  expect(vault.currentProfile.identity.legalName.status).toBe("VERIFIED_DOCUMENT");
  expect(vault.currentProfile.identity.legalName.sourceIds).toEqual(["notes-1"]);
  expect(vault.currentProfile.compensationPreferences).toEqual([]);
});
it("rejects ambiguous repeated labelled details", () => {
  expect(() =>
    parseNarrativeIntake("Email: first@example.test\nEmail: second@example.test"),
  ).toThrow("only one email");
  expect(parseNarrativeIntake("I want to work with Rust").identity).toBeUndefined();
});
