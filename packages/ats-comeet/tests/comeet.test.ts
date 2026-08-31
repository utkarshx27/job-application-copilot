// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { RawField } from "@copilot/form-schema";
import { comeetAdapter } from "../src/index";

describe("Comeet adapter", () => {
  it("detects, extracts, maps, and confirms sanitized pages", () => {
    window.history.replaceState({}, "", "/jobs/example/E5.007/backend-engineer/C9601");
    document.head.innerHTML = `<meta name="copilot-ats" content="comeet"><meta name="copilot-company" content="Example Labs"><script type="application/ld+json">{"@type":"JobPosting","title":"Backend Engineer","description":"Build services.","hiringOrganization":{"name":"Example Labs"},"jobLocation":{"address":{"addressLocality":"Remote","addressRegion":"India"}}}</script>`;
    document.body.innerHTML = `<main data-comeet-job><h1>Backend Engineer</h1><section data-ats-confirmation="comeet"><h2>Thank you, application received</h2><span data-confirmation-id>C-9601</span></section></main>`;
    const detection = comeetAdapter.detect(document);
    expect(detection).toMatchObject({ adapter: "COMEET", supported: true });
    expect(comeetAdapter.extractJob(document, detection)).toMatchObject({
      ats: "COMEET",
      externalRequisitionId: "C9601",
      remotePolicy: "REMOTE",
    });
    expect(comeetAdapter.detectConfirmation(document)).toMatchObject({
      confirmed: true,
      referenceId: "C-9601",
    });
  });

  it("matches the sanitized fixture", () => {
    const fixture = JSON.parse(
      readFileSync(resolve("fixtures/ats/comeet/v1/application.json"), "utf8"),
    ) as {
      snapshot: { fields: RawField[] };
      expectedCanonicalQuestions: Record<string, string | null>;
    };
    for (const field of fixture.snapshot.fields)
      expect(comeetAdapter.classifyField(field)?.canonicalQuestion ?? null, field.fieldId).toBe(
        fixture.expectedCanonicalQuestions[field.fieldId],
      );
  });
});
