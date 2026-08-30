// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { RawField } from "@copilot/form-schema";

import { ashbyAdapter } from "../src/index";

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

describe("Ashby adapter", () => {
  it("detects, extracts, maps, and confirms a sanitized Ashby application", () => {
    window.history.replaceState(
      {},
      "",
      "/example/26a4281b-4ab2-4829-b664-7c43d7dbd409/application",
    );
    document.head.innerHTML = `
      <meta name="copilot-ats" content="ashby">
      <meta name="copilot-company" content="Example Systems">
      <script type="application/ld+json">
        {
          "@type": "JobPosting",
          "title": "Infrastructure Engineer",
          "description": "Build resilient infrastructure.",
          "hiringOrganization": { "name": "Example Systems" },
          "jobLocation": { "address": { "addressLocality": "Remote", "addressRegion": "India" } },
          "employmentType": "FullTime"
        }
      </script>`;
    document.body.innerHTML = `
      <main data-ashby-job-posting>
        <h1>Infrastructure Engineer</h1>
        <form data-testid="application-form"></form>
        <section class="ashby-application-confirmation">
          <h2>Thank you, your application was received</h2>
          <span data-confirmation-id>ASH-CONF-300</span>
        </section>
      </main>`;

    const detection = ashbyAdapter.detect(document);
    expect(detection).toMatchObject({ adapter: "ASHBY", supported: true });
    expect(ashbyAdapter.extractJob(document, detection)).toMatchObject({
      ats: "ASHBY",
      title: "Infrastructure Engineer",
      company: "Example Systems",
      externalRequisitionId: "26a4281b-4ab2-4829-b664-7c43d7dbd409",
      remotePolicy: "REMOTE",
    });
    expect(
      ashbyAdapter.classifyField(rawField("_systemfield_name", "Name", "text"))?.canonicalQuestion,
    ).toBe("IDENTITY.legal_name.full");
    expect(
      ashbyAdapter.classifyField(rawField("_systemfield_resume", "Resume", "file"))
        ?.canonicalQuestion,
    ).toBe("APPLICATION.resume");
    expect(ashbyAdapter.detectConfirmation(document)).toMatchObject({
      confirmed: true,
      referenceId: "ASH-CONF-300",
    });
  });

  it("matches every expected field in the sanitized Phase 6 canary fixture", () => {
    const fixture = JSON.parse(
      readFileSync(resolve("fixtures/ats/ashby/v1/application.json"), "utf8"),
    ) as {
      snapshot: { fields: RawField[] };
      expectedCanonicalQuestions: Record<string, string | null>;
    };
    for (const field of fixture.snapshot.fields) {
      expect(ashbyAdapter.classifyField(field)?.canonicalQuestion ?? null, field.fieldId).toBe(
        fixture.expectedCanonicalQuestions[field.fieldId],
      );
    }
  });
});
