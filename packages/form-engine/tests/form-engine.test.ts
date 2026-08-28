import { describe, expect, it } from "vitest";

import type { RawField } from "@copilot/form-schema";
import { createEmptyVault, profileToDraft, saveProfileDraft } from "@copilot/profile-core";

import { analyzeForm, classifyField, precisionForExpected } from "../src/index";

const now = "2026-08-28T08:00:00.000Z";

function field(fieldId: string, patch: Partial<RawField>): RawField {
  return {
    fieldId,
    controlKind: "text",
    accessibleName: "",
    labelText: "",
    ariaLabel: "",
    placeholder: "",
    name: "",
    domId: "",
    required: false,
    disabled: false,
    readOnly: false,
    autocomplete: "",
    groupLabel: "",
    optionValue: "",
    checked: false,
    userEdited: false,
    options: [],
    ...patch,
  };
}

function verifiedProfile() {
  const vault = createEmptyVault(now);
  const draft = profileToDraft(vault.currentProfile);
  draft.identity = { full: "Priya Sharma", given: "Priya", family: "Sharma" };
  draft.email = "priya@example.test";
  draft.phone = "+919876543210";
  draft.portfolio = "https://priya.example.test";
  draft.github = "https://github.com/priya-example";
  draft.linkedin = "https://linkedin.com/in/priya-example";
  draft.workAuthorization = [
    {
      id: "auth-us",
      countryCode: "US",
      currentlyAuthorized: "YES",
      currentSponsorshipRequired: "NO",
      futureSponsorshipRequired: "YES",
    },
  ];
  return saveProfileDraft(vault, draft, "2026-08-28T09:00:00.000Z").currentProfile;
}

describe("generic semantic form engine", () => {
  it("meets the R0/R1 precision gate on the semantic matrix", () => {
    const matrix: Array<[RawField, string]> = [
      [field("given", { autocomplete: "given-name" }), "IDENTITY.legal_name.given"],
      [field("family", { name: "last_name" }), "IDENTITY.legal_name.family"],
      [field("full", { labelText: "Legal name" }), "IDENTITY.legal_name.full"],
      [field("email", { controlKind: "email", autocomplete: "email" }), "CONTACT.email"],
      [field("phone", { controlKind: "tel", labelText: "Mobile number" }), "CONTACT.phone"],
      [field("country", { controlKind: "select-one", name: "country" }), "ADDRESS.country"],
      [field("portfolio", { name: "portfolio_url" }), "LINKS.portfolio"],
      [field("github", { ariaLabel: "GitHub profile" }), "LINKS.github"],
      [field("linkedin", { placeholder: "LinkedIn URL" }), "LINKS.linkedin"],
      [
        field("authorized", { groupLabel: "Are you legally authorized to work?" }),
        "WORK_AUTH.currently_authorized",
      ],
      [field("sponsor-now", { name: "current_sponsorship" }), "WORK_AUTH.current_sponsorship"],
      [
        field("sponsor-later", { labelText: "Will you require sponsorship in the future?" }),
        "WORK_AUTH.future_sponsorship",
      ],
      [field("visa", { domId: "visa-type" }), "WORK_AUTH.visa_type"],
      [
        field("cover", { controlKind: "textarea", labelText: "Cover letter" }),
        "APPLICATION.cover_letter",
      ],
      [
        field("consent", { controlKind: "checkbox", labelText: "I agree to the privacy terms" }),
        "CONSENT.terms",
      ],
    ];
    const mappings = matrix.map(([candidate]) => classifyField(candidate));
    const expected = Object.fromEntries(
      matrix.map(([candidate, canonical]) => [candidate.fieldId, canonical]),
    );
    const result = precisionForExpected(mappings, expected);
    expect(result).toEqual({ correct: 15, predicted: 15, precision: 1 });
    expect(result.precision).toBeGreaterThanOrEqual(0.995);
  });

  it("builds safe operations and blocks user-edited fields", () => {
    const snapshot = {
      schemaVersion: 1 as const,
      url: "https://jobs.example.test/apply",
      title: "Application",
      capturedAt: now,
      fields: [
        field("email", { controlKind: "email", autocomplete: "email", userEdited: true }),
        field("portfolio", { controlKind: "url", name: "portfolio" }),
        field("sponsor-yes", {
          controlKind: "radio",
          name: "current_sponsorship",
          optionValue: "yes",
        }),
        field("sponsor-no", {
          controlKind: "radio",
          name: "current_sponsorship",
          optionValue: "no",
        }),
      ],
    };
    const analysis = analyzeForm(snapshot, verifiedProfile(), "analysis-1");
    expect(analysis.mappings[0]?.fillable).toBe(false);
    expect(analysis.mappings[0]?.blockedReason).toContain("edited");
    expect(analysis.mappings[1]?.operation).toEqual({
      kind: "text",
      value: "https://priya.example.test",
    });
    expect(analysis.mappings[2]?.fillable).toBe(false);
    expect(analysis.mappings[3]?.operation).toEqual({ kind: "check", checked: true });
  });
});
