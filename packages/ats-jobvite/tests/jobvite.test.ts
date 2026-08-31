// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { RawField } from "@copilot/form-schema";
import { jobviteAdapter } from "../src/index";

describe("Jobvite adapter", () => {
  it("detects, extracts, maps, and confirms sanitized pages", () => {
    window.history.replaceState({}, "", "/example/job/J9501");
    document.head.innerHTML = `<meta name="copilot-ats" content="jobvite"><meta name="copilot-company" content="Example Labs"><script type="application/ld+json">{"@type":"JobPosting","title":"Frontend Engineer","description":"Build interfaces.","hiringOrganization":{"name":"Example Labs"}}</script>`;
    document.body.innerHTML = `<main data-jobvite-job><h1>Frontend Engineer</h1><section data-ats-confirmation="jobvite"><h2>Application submitted</h2><span data-confirmation-id>J-9501</span></section></main>`;
    const detection = jobviteAdapter.detect(document);
    expect(detection).toMatchObject({ adapter: "JOBVITE", supported: true });
    expect(jobviteAdapter.extractJob(document, detection)).toMatchObject({
      ats: "JOBVITE",
      externalRequisitionId: "J9501",
    });
    expect(jobviteAdapter.detectConfirmation(document)).toMatchObject({
      confirmed: true,
      referenceId: "J-9501",
    });
  });

  it("matches the sanitized fixture", () => {
    const fixture = JSON.parse(
      readFileSync(resolve("fixtures/ats/jobvite/v1/application.json"), "utf8"),
    ) as {
      snapshot: { fields: RawField[] };
      expectedCanonicalQuestions: Record<string, string | null>;
    };
    for (const field of fixture.snapshot.fields)
      expect(jobviteAdapter.classifyField(field)?.canonicalQuestion ?? null, field.fieldId).toBe(
        fixture.expectedCanonicalQuestions[field.fieldId],
      );
  });
});
