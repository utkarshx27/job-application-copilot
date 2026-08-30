import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SanitizedFixtureSchema } from "../src/index";

describe("sanitized ATS fixture format", () => {
  it("validates all controlled ATS fixtures", () => {
    for (const path of [
      "../../../fixtures/ats/generic/v1/test-ats-single-page.json",
      "../../../fixtures/ats/greenhouse/v1/application.json",
      "../../../fixtures/ats/lever/v1/application.json",
      "../../../fixtures/ats/ashby/v1/application.json",
      "../../../fixtures/ats/smartrecruiters/v1/application.json",
    ]) {
      const fixture: unknown = JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
      expect(SanitizedFixtureSchema.safeParse(fixture), path).toMatchObject({ success: true });
    }
  });
});
