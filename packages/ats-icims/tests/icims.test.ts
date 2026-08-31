// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { RawField } from "@copilot/form-schema";
import { icimsAdapter } from "../src/index";

describe("iCIMS adapter", () => {
  it("detects, extracts, maps, and confirms sanitized pages", () => {
    window.history.replaceState({}, "", "/jobs/9101/backend-engineer/job");
    document.head.innerHTML = `<meta name="copilot-ats" content="icims"><meta name="copilot-company" content="Example Labs"><script type="application/ld+json">{"@type":"JobPosting","title":"Backend Engineer","description":"Build APIs.","hiringOrganization":{"name":"Example Labs"},"jobLocation":{"address":{"addressLocality":"Remote","addressRegion":"India"}}}</script>`;
    document.body.innerHTML = `<main data-icims-job><h1>Backend Engineer</h1><section data-ats-confirmation="icims"><h2>Thank you, application received</h2><span data-confirmation-id>I-9101</span></section></main>`;
    const detection = icimsAdapter.detect(document);
    expect(detection).toMatchObject({ adapter: "ICIMS", supported: true });
    expect(icimsAdapter.extractJob(document, detection)).toMatchObject({
      ats: "ICIMS",
      title: "Backend Engineer",
      company: "Example Labs",
      externalRequisitionId: "9101",
      remotePolicy: "REMOTE",
    });
    expect(icimsAdapter.detectConfirmation(document)).toMatchObject({
      confirmed: true,
      referenceId: "I-9101",
    });
  });

  it("matches the sanitized fixture", () => {
    const fixture = JSON.parse(
      readFileSync(resolve("fixtures/ats/icims/v1/application.json"), "utf8"),
    ) as {
      snapshot: { fields: RawField[] };
      expectedCanonicalQuestions: Record<string, string | null>;
    };
    for (const field of fixture.snapshot.fields)
      expect(icimsAdapter.classifyField(field)?.canonicalQuestion ?? null, field.fieldId).toBe(
        fixture.expectedCanonicalQuestions[field.fieldId],
      );
  });
});
