import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@copilot/form-schema";

import {
  aggregateQaResults,
  createReviewTemplate,
  createSanitizedQaFixture,
  evaluateQaFixture,
  pathPattern,
  qaFixtureIdForUrl,
  qaReportMarkdown,
  sanitizeMachineMetadata,
  sanitizeMetadata,
  validatePublicCaptureUrl,
} from "../src/index";

const snapshot: PageSnapshot = {
  schemaVersion: 1,
  url: "https://boards.greenhouse.io/example/jobs/123456?token=secret#apply",
  title: "Engineer at Example",
  capturedAt: "2026-08-29T08:00:00.000Z",
  fields: [
    {
      fieldId: "first_name",
      controlKind: "text",
      accessibleName: "First name applicant@example.com",
      labelText: "First name",
      ariaLabel: "",
      placeholder: "",
      name: "job_application[first_name]",
      domId: "first_name",
      required: true,
      disabled: false,
      readOnly: false,
      autocomplete: "given-name",
      groupLabel: "",
      optionValue: "",
      checked: true,
      userEdited: true,
      options: [],
    },
    {
      fieldId: "custom_question",
      controlKind: "textarea",
      accessibleName: "Why this role?",
      labelText: "Why this role?",
      ariaLabel: "",
      placeholder: "",
      name: "job_application[custom]",
      domId: "custom_question",
      required: true,
      disabled: false,
      readOnly: false,
      autocomplete: "",
      groupLabel: "",
      optionValue: "",
      checked: false,
      userEdited: false,
      options: [],
    },
  ],
};

describe("ATS QA sanitization", () => {
  it("redacts metadata and removes URL identity and field state", () => {
    const fixture = createSanitizedQaFixture(snapshot, "GREENHOUSE", "1");
    expect(fixture.snapshot.url).toBe("https://job-boards.greenhouse.io/example/jobs/:id");
    expect(fixture.source.pathPattern).toBe("/example/jobs/:id");
    expect(fixture.snapshot.title).toBe("Greenhouse application fixture");
    expect(fixture.snapshot.fields[0]?.accessibleName).toContain("[redacted-email]");
    expect(fixture.snapshot.fields[0]?.checked).toBe(false);
    expect(fixture.snapshot.fields[0]?.userEdited).toBe(false);
    expect(JSON.stringify(fixture)).not.toContain("token=secret");

    const sameJobWithTracking = createSanitizedQaFixture(
      { ...snapshot, url: "https://boards.greenhouse.io/example/jobs/123456?utm_source=test" },
      "GREENHOUSE",
      "1",
    );
    expect(sameJobWithTracking.id).toBe(fixture.id);
    expect(
      qaFixtureIdForUrl(
        "https://boards.greenhouse.io/example/jobs/123456?utm_source=test",
        "GREENHOUSE",
      ),
    ).toBe(fixture.id);
    const distinctQueryJob = createSanitizedQaFixture(
      { ...snapshot, url: "https://boards.greenhouse.io/example/jobs?gh_jid=999999" },
      "GREENHOUSE",
      "1",
    );
    expect(distinctQueryJob.id).not.toBe(fixture.id);
  });

  it("rejects non-public and credential-bearing targets", () => {
    expect(() => validatePublicCaptureUrl("http://jobs.example.com/apply")).toThrow("HTTPS");
    expect(() => validatePublicCaptureUrl("https://127.0.0.1/apply")).toThrow("local networks");
    expect(() => validatePublicCaptureUrl("https://user:pass@jobs.example.com/apply")).toThrow(
      "credentials",
    );
    expect(pathPattern("/jobs/abc/123456")).toBe("/jobs/abc/:id");
    expect(sanitizeMetadata("cards[73796cde-fc84-4c16-8685-c85155f3503d][field0]")).toBe(
      "cards[73796cde-fc84-4c16-8685-c85155f3503d][field0]",
    );
    expect(sanitizeMetadata("cards[73796cde-fc01-4c16-8685-c85155f3503d][field0]")).toBe(
      "cards[73796cde-fc01-4c16-8685-c85155f3503d][field0]",
    );
    expect(sanitizeMetadata("Call +1 202-555-0117")).toBe("Call [redacted-phone]");
    expect(sanitizeMachineMetadata("question_1234567890")).toBe("question_1234567890");
  });
});

describe("ATS QA replay and review", () => {
  it("keeps generated predictions separate from human ground truth", () => {
    const fixture = createSanitizedQaFixture(snapshot, "GREENHOUSE", "1");
    const template = createReviewTemplate(fixture);
    const pending = evaluateQaFixture(fixture, template);
    expect(pending.reviewQueue.map((item) => item.priority)).toEqual(["P0", "P0"]);
    expect(pending.mappingAccuracy).toBeNull();
    expect(template.fields[0]?.reviewContext?.capturedLabel).toBe("First name [redacted-email]");

    const reviewed = {
      ...template,
      status: "REVIEWED" as const,
      reviewer: "qa-reviewer",
      reviewedAt: "2026-08-29T09:00:00.000Z",
      pageChecks: {
        correctAts: "PASS" as const,
        allVisibleFieldsCaptured: "PASS" as const,
        containsNoPersonalData: "PASS" as const,
        noFormInteractionOccurred: "PASS" as const,
      },
      fields: [
        {
          fieldId: "first_name",
          decision: "MAPPED" as const,
          expectedCanonicalQuestion: "IDENTITY.legal_name.given" as const,
          severityIfWrong: "SEVERE" as const,
        },
        {
          fieldId: "custom_question",
          decision: "UNMAPPED" as const,
          severityIfWrong: "NORMAL" as const,
        },
      ],
    };
    const result = evaluateQaFixture(fixture, reviewed);
    expect(result).toMatchObject({
      fullyReviewed: true,
      mappingAccuracy: 1,
      supportedFieldFillSuccess: 1,
      severeWrongFieldIncidents: 0,
    });
    expect(result.reviewQueue).toHaveLength(0);
  });

  it("reports sample, success, severe-incident, and review gates independently", () => {
    const fixture = createSanitizedQaFixture(snapshot, "GREENHOUSE", "1");
    const report = aggregateQaResults([evaluateQaFixture(fixture)], "2026-08-29T10:00:00.000Z");
    expect(report.gate).toMatchObject({
      greenhouseSample: false,
      leverSample: false,
      allFormsReviewed: false,
      fillSuccess: false,
      noSevereWrongFieldIncidents: true,
      passed: false,
    });
    expect(report.manualReviewBatches).toHaveLength(2);
    expect(report.totals.pendingManualBatches).toBe(2);
    expect(qaReportMarkdown(report)).toContain("Manual review queue");
    expect(qaReportMarkdown(report)).toContain("Unique manual field checks");
    expect(() => aggregateQaResults([report.fixtures[0]!, report.fixtures[0]!])).toThrow(
      "duplicate fixture IDs",
    );
  });
});
