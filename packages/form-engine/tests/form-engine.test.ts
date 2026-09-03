import { describe, expect, it } from "vitest";

import type { CanonicalQuestion, RawField } from "@copilot/form-schema";
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
  draft.workHistory = [
    {
      id: "work-1",
      employer: "Example Labs",
      title: "Software Engineer",
      location: "Bengaluru",
      start: "2022-01-01",
      end: "",
      current: true,
      description: "Built accessible products.",
    },
  ];
  draft.education = [
    {
      id: "education-1",
      institution: "Example University",
      degree: "B.Tech",
      fieldOfStudy: "Computer Science",
      start: "2018-08-01",
      end: "2022-05-01",
      current: false,
    },
  ];
  draft.skills = ["TypeScript", "Accessibility"];
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
      [field("city", { autocomplete: "address-level2" }), "ADDRESS.city"],
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
        field("interest", {
          controlKind: "textarea",
          labelText: "Let the company know about your interest working there",
        }),
        "ESSAY.why_company",
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
    expect(result).toEqual({ correct: 17, predicted: 17, precision: 1 });
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

  it("requires manual reconciliation for prefilled application values", () => {
    const analysis = analyzeForm(
      {
        schemaVersion: 1,
        url: "https://example.wd5.myworkdayjobs.com/apply",
        title: "Application",
        capturedAt: now,
        fields: [
          field("company", {
            labelText: "Current employer",
            valueState: "PREFILLED",
          }),
        ],
      },
      verifiedProfile(),
      "analysis-prefilled",
    );
    expect(analysis.mappings[0]).toMatchObject({
      canonicalQuestion: "WORK_HISTORY.0.employer",
      fillable: false,
    });
    expect(analysis.mappings[0]?.blockedReason).toContain("résumé-parsed");
  });

  it("does not let broad words override work authorization or essay meaning", () => {
    const cases: Array<[RawField, CanonicalQuestion | null]> = [
      [
        field("auth", {
          groupLabel: "Are you legally authorized to work in the country for which you applied?",
        }),
        "WORK_AUTH.currently_authorized",
      ],
      [
        field("graduation", {
          labelText: "Please include your intended graduation year for the degree",
        }),
        "EDUCATION.0.end_date",
      ],
      [field("preferred", { labelText: "Preferred First Name" }), null],
      [
        field("essay", {
          controlKind: "textarea",
          labelText: "Tell us one thing that's not on your resume that you're proud of.",
        }),
        null,
      ],
      [
        field("skill-essay", {
          controlKind: "textarea",
          labelText:
            "What's a skill or body of knowledge you have that has nothing to do with your resume? (150 words max)",
        }),
        null,
      ],
      [
        field("share", {
          controlKind: "radio",
          groupLabel: "Please share my resume and contact information with external partners.",
        }),
        null,
      ],
      [field("high-school", { labelText: "High School Name" }), null],
      [field("password", { labelText: "Portfolio + Password" }), null],
      [
        field("additional", {
          controlKind: "textarea",
          labelText: "Additional information",
          placeholder: "Add a cover letter or anything else you want to share.",
        }),
        null,
      ],
      [
        field("ai-consent", {
          controlKind: "radio",
          name: "consent[marketing]",
          groupLabel: "I consent to AI notetakers during interviews.",
        }),
        null,
      ],
    ];

    expect(cases.map(([candidate]) => classifyField(candidate).canonicalQuestion)).toEqual(
      cases.map(([, expected]) => expected),
    );
  });

  it("maps precise work-authorization timing and routes unsafe variants to review", () => {
    const cases: Array<[string, CanonicalQuestion | null]> = [
      ["Are you legally authorized to work?", "WORK_AUTH.currently_authorized"],
      ["Will you require sponsorship now?", "WORK_AUTH.current_sponsorship"],
      ["Will you require sponsorship in the future?", "WORK_AUTH.future_sponsorship"],
      ["Will you require sponsorship?", null],
      ["Will you require sponsorship now or in the future?", null],
      ["Do you not require sponsorship now?", null],
      ["Will you never need sponsorship later?", null],
      ["Are you not unauthorized to work?", null],
      ["Can you work without sponsorship?", null],
    ];
    for (const [index, [labelText, canonical]] of cases.entries()) {
      const mapping = classifyField(field(`auth-${index}`, { labelText }));
      expect(mapping.canonicalQuestion, labelText).toBe(canonical);
    }
  });

  it("selects date components for month, year, and combined graduation controls", () => {
    const fields = [
      field("graduation-month", {
        controlKind: "select-one",
        labelText: "Graduation month",
        options: [{ value: "May", text: "May", disabled: false }],
      }),
      field("graduation-year", {
        controlKind: "select-one",
        labelText: "Graduation year",
        options: [{ value: "2022", text: "2022", disabled: false }],
      }),
      field("graduation", {
        controlKind: "select-one",
        labelText: "When is your graduation?",
        options: [{ value: "May 2022", text: "May 2022", disabled: false }],
      }),
    ];
    const analysis = analyzeForm(
      {
        schemaVersion: 1,
        url: "https://jobs.example.test/apply",
        title: "Application",
        capturedAt: now,
        fields,
      },
      verifiedProfile(),
    );
    expect(analysis.mappings.map((mapping) => mapping.operation)).toEqual([
      { kind: "select", value: "May" },
      { kind: "select", value: "2022" },
      { kind: "select", value: "May 2022" },
    ]);
  });

  it("maps verified work, education, and skill facts without inventing values", () => {
    const fields = [
      field("employer", { labelText: "Current employer" }),
      field("title", { labelText: "Current job title" }),
      field("school", { labelText: "University" }),
      field("degree", { labelText: "Degree" }),
      field("skills", { controlKind: "textarea", labelText: "Skills" }),
      field("resume", { controlKind: "file", labelText: "Résumé" }),
    ];
    const analysis = analyzeForm(
      {
        schemaVersion: 1,
        url: "https://boards.greenhouse.io/example/jobs/100",
        title: "Application",
        capturedAt: now,
        fields,
      },
      verifiedProfile(),
      "analysis-profile",
    );
    expect(analysis.mappings.map((mapping) => mapping.operation)).toEqual([
      { kind: "text", value: "Example Labs" },
      { kind: "text", value: "Software Engineer" },
      { kind: "text", value: "Example University" },
      { kind: "text", value: "B.Tech" },
      { kind: "text", value: "TypeScript, Accessibility" },
      undefined,
    ]);
    expect(analysis.mappings[5]).toMatchObject({
      canonicalQuestion: "APPLICATION.resume",
      fillable: false,
      blockedReason: "No verified profile value is available.",
    });
  });
});
