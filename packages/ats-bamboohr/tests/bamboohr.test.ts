// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { RawField } from "@copilot/form-schema";
import { bambooHrAdapter } from "../src/index";

describe("BambooHR adapter", () => {
  it("detects, extracts, maps, and confirms sanitized pages", () => {
    window.history.replaceState({}, "", "/careers/9401");
    document.head.innerHTML = `<meta name="copilot-ats" content="bamboohr"><meta name="copilot-company" content="Example Labs"><script type="application/ld+json">{"@type":"JobPosting","title":"QA Engineer","description":"Test products.","hiringOrganization":{"name":"Example Labs"}}</script>`;
    document.body.innerHTML = `<main data-bamboohr-job><h1>QA Engineer</h1><section data-ats-confirmation="bamboohr"><h2>Application complete</h2><span data-confirmation-id>B-9401</span></section></main>`;
    const detection = bambooHrAdapter.detect(document);
    expect(detection).toMatchObject({ adapter: "BAMBOOHR", supported: true });
    expect(bambooHrAdapter.extractJob(document, detection)).toMatchObject({
      ats: "BAMBOOHR",
      externalRequisitionId: "9401",
    });
    expect(bambooHrAdapter.detectConfirmation(document)).toMatchObject({
      confirmed: true,
      referenceId: "B-9401",
    });
  });

  it("matches the sanitized fixture", () => {
    const fixture = JSON.parse(
      readFileSync(resolve("fixtures/ats/bamboohr/v1/application.json"), "utf8"),
    ) as {
      snapshot: { fields: RawField[] };
      expectedCanonicalQuestions: Record<string, string | null>;
    };
    for (const field of fixture.snapshot.fields)
      expect(bambooHrAdapter.classifyField(field)?.canonicalQuestion ?? null, field.fieldId).toBe(
        fixture.expectedCanonicalQuestions[field.fieldId],
      );
  });
});
