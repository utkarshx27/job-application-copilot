// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { RawField } from "@copilot/form-schema";
import { taleoAdapter } from "../src/index";

describe("Taleo adapter", () => {
  it("detects, extracts, maps, and confirms sanitized pages", () => {
    window.history.replaceState({}, "", "/careersection/ex/jobapply.ftl?job=9201&lang=en");
    document.head.innerHTML = `<meta name="copilot-ats" content="taleo"><meta name="copilot-company" content="Example Labs"><script type="application/ld+json">{"@type":"JobPosting","title":"Systems Engineer","description":"Build systems.","hiringOrganization":{"name":"Example Labs"}}</script>`;
    document.body.innerHTML = `<main data-taleo-job><h1>Systems Engineer</h1><section data-ats-confirmation="taleo"><h2>Application submitted</h2><span data-confirmation-id>T-9201</span></section></main>`;
    const detection = taleoAdapter.detect(document);
    expect(detection).toMatchObject({ adapter: "TALEO", supported: true });
    expect(taleoAdapter.extractJob(document, detection)).toMatchObject({
      ats: "TALEO",
      externalRequisitionId: "9201",
    });
    expect(taleoAdapter.detectConfirmation(document)).toMatchObject({
      confirmed: true,
      referenceId: "T-9201",
    });
  });

  it("matches the sanitized fixture", () => {
    const fixture = JSON.parse(
      readFileSync(resolve("fixtures/ats/taleo/v1/application.json"), "utf8"),
    ) as {
      snapshot: { fields: RawField[] };
      expectedCanonicalQuestions: Record<string, string | null>;
    };
    for (const field of fixture.snapshot.fields)
      expect(taleoAdapter.classifyField(field)?.canonicalQuestion ?? null, field.fieldId).toBe(
        fixture.expectedCanonicalQuestions[field.fieldId],
      );
  });
});
