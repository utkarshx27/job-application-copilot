import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SanitizedFixtureSchema } from "../src/index";

describe("sanitized ATS fixture format", () => {
  it("validates the controlled generic Test ATS fixture", () => {
    const fixtureUrl = new URL(
      "../../../fixtures/ats/generic/v1/test-ats-single-page.json",
      import.meta.url,
    );
    const fixture: unknown = JSON.parse(readFileSync(fixtureUrl, "utf8"));

    expect(SanitizedFixtureSchema.safeParse(fixture).success).toBe(true);
  });
});
