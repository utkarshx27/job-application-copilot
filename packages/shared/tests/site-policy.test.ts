import { describe, expect, it } from "vitest";

import { policyForUrl } from "../src/index";

describe("policyForUrl", () => {
  it("keeps LinkedIn manual-only", () => {
    expect(policyForUrl("https://www.linkedin.com/jobs/view/1").fillAllowed).toBe(false);
  });

  it("permits active-tab assistance on an employer page without navigation or submission", () => {
    const policy = policyForUrl("https://jobs.example.com/apply/123");
    expect(policy).toMatchObject({
      mode: "ASSIST_ONLY",
      fillAllowed: true,
      navigationAllowed: false,
      submissionAllowed: false,
    });
  });
});
