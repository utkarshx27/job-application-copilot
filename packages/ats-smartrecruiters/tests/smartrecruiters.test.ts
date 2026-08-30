// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { RawField } from "@copilot/form-schema";

import { smartRecruitersAdapter } from "../src/index";

function rawField(
  name: string,
  accessibleName: string,
  controlKind: RawField["controlKind"],
): RawField {
  return {
    fieldId: name,
    controlKind,
    accessibleName,
    labelText: accessibleName,
    ariaLabel: "",
    placeholder: "",
    name,
    domId: name,
    required: true,
    disabled: false,
    readOnly: false,
    autocomplete: "",
    groupLabel: "",
    optionValue: "",
    checked: false,
    userEdited: false,
    options: [],
  };
}

describe("SmartRecruiters adapter", () => {
  it("detects, extracts, maps, and confirms a sanitized SmartRecruiters application", () => {
    window.history.replaceState({}, "", "/oneclick-ui/company/example/job/714887450");
    document.head.innerHTML = `
      <meta name="copilot-ats" content="smartrecruiters">
      <meta name="copilot-company" content="Example Robotics">
      <meta name="description" content="Build accessible robotics software.">`;
    document.body.innerHTML = `
      <main data-smartrecruiters-job>
        <h1 data-testid="job-title">Frontend Engineer</h1>
        <p data-testid="job-location">Hybrid · Bengaluru</p>
        <div data-testid="job-description">Build accessible robotics software.</div>
        <section class="smartrecruiters-application-confirmation">
          <h2>Application submitted — thank you</h2>
          <span data-confirmation-id>SR-CONF-400</span>
        </section>
      </main>`;

    const detection = smartRecruitersAdapter.detect(document);
    expect(detection).toMatchObject({ adapter: "SMARTRECRUITERS", supported: true });
    expect(smartRecruitersAdapter.extractJob(document, detection)).toMatchObject({
      ats: "SMARTRECRUITERS",
      title: "Frontend Engineer",
      company: "Example Robotics",
      externalRequisitionId: "714887450",
      remotePolicy: "HYBRID",
    });
    expect(
      smartRecruitersAdapter.classifyField(rawField("firstName", "First name", "text"))
        ?.canonicalQuestion,
    ).toBe("IDENTITY.legal_name.given");
    expect(
      smartRecruitersAdapter.classifyField(rawField("resumeFile", "Resume", "file"))
        ?.canonicalQuestion,
    ).toBe("APPLICATION.resume");
    expect(smartRecruitersAdapter.detectConfirmation(document)).toMatchObject({
      confirmed: true,
      referenceId: "SR-CONF-400",
    });
  });

  it("matches every expected field in the sanitized Phase 6 canary fixture", () => {
    const fixture = JSON.parse(
      readFileSync(resolve("fixtures/ats/smartrecruiters/v1/application.json"), "utf8"),
    ) as {
      snapshot: { fields: RawField[] };
      expectedCanonicalQuestions: Record<string, string | null>;
    };
    for (const field of fixture.snapshot.fields) {
      expect(
        smartRecruitersAdapter.classifyField(field)?.canonicalQuestion ?? null,
        field.fieldId,
      ).toBe(fixture.expectedCanonicalQuestions[field.fieldId]);
    }
  });
});
