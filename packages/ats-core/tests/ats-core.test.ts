// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { inspectWithAdapters, jsonLdJob } from "../src/index";

describe("ATS core", () => {
  it("ignores malformed page JSON-LD and degrades to the generic adapter", () => {
    document.head.innerHTML = `<script type="application/ld+json">not valid json</script>`;
    document.body.innerHTML = `<form><input name="email"></form>`;
    expect(jsonLdJob(document)).toBeNull();
    expect(inspectWithAdapters(document, [])).toMatchObject({
      detection: { adapter: "GENERIC", supported: true },
      job: null,
      confirmation: { confirmed: false },
    });
  });
});
