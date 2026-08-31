// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { RawField } from "@copilot/form-schema";
import { workableAdapter } from "../src/index";

describe("Workable adapter", () => {
  it("detects, extracts, maps, and confirms sanitized pages", () => {
    window.history.replaceState({}, "", "/example/j/W9301");
    document.head.innerHTML = `<meta name="copilot-ats" content="workable"><meta name="copilot-company" content="Example Labs"><script type="application/ld+json">{"@type":"JobPosting","title":"Product Engineer","description":"Build products.","hiringOrganization":{"name":"Example Labs"}}</script>`;
    document.body.innerHTML = `<main data-workable-job><h1>Product Engineer</h1><section data-ats-confirmation="workable"><h2>Thank you, application received</h2><span data-confirmation-id>W-9301</span></section></main>`;
    const detection = workableAdapter.detect(document);
    expect(detection).toMatchObject({ adapter: "WORKABLE", supported: true });
    expect(workableAdapter.extractJob(document, detection)).toMatchObject({
      ats: "WORKABLE",
      externalRequisitionId: "W9301",
    });
    expect(workableAdapter.detectConfirmation(document)).toMatchObject({
      confirmed: true,
      referenceId: "W-9301",
    });
  });

  it("matches the sanitized fixture", () => {
    const fixture = JSON.parse(
      readFileSync(resolve("fixtures/ats/workable/v1/application.json"), "utf8"),
    ) as {
      snapshot: { fields: RawField[] };
      expectedCanonicalQuestions: Record<string, string | null>;
    };
    for (const field of fixture.snapshot.fields)
      expect(workableAdapter.classifyField(field)?.canonicalQuestion ?? null, field.fieldId).toBe(
        fixture.expectedCanonicalQuestions[field.fieldId],
      );
  });
});
