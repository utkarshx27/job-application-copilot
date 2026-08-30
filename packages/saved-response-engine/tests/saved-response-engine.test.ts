import { describe, expect, it } from "vitest";

import { createSavedResponse, matchSavedResponse } from "../src/index";

const now = "2026-08-30T10:00:00.000Z";
const context = {
  applicationId: "application:example-1",
  company: "ExampleCo",
  countryCode: "US",
  role: "Platform Engineer",
  ats: "GREENHOUSE",
};

describe("saved response engine", () => {
  it("matches a fresh company-scoped answer after company substitution and word-order changes", () => {
    const response = createSavedResponse({
      id: "response-1",
      question: "Why are you interested in ExampleCo?",
      answer: "Its reliability mission matches my verified experience.",
      reuseScope: "COMPANY",
      context,
      now,
    });
    const matched = matchSavedResponse(
      "What interests you about this company?",
      [response],
      context,
      "2026-09-01T10:00:00.000Z",
    );
    expect(matched.status).toBe("MATCH");
    expect(matched.answer).toContain("reliability mission");
  });

  it("does not cross company or country scope", () => {
    const company = createSavedResponse({
      id: "company-response",
      question: "Why are you interested in ExampleCo?",
      answer: "Company-specific answer",
      reuseScope: "COMPANY",
      context,
      now,
    });
    expect(
      matchSavedResponse("Why are you interested in OtherCo?", [company], {
        ...context,
        company: "OtherCo",
      }).status,
    ).toBe("NONE");

    const country = createSavedResponse({
      id: "country-response",
      question: "Will you require sponsorship in the future?",
      answer: "No",
      reuseScope: "COUNTRY",
      context,
      now,
    });
    expect(
      matchSavedResponse("Will you need sponsorship in the future?", [country], {
        ...context,
        countryCode: "CA",
      }).status,
    ).toBe("NONE");
  });

  it("marks expired answers stale instead of returning their value", () => {
    const response = createSavedResponse({
      id: "stale-response",
      question: "What is your notice period?",
      answer: "30 days",
      reuseScope: "COMPANY",
      context,
      now,
    });
    const matched = matchSavedResponse(
      "Current notice period?",
      [response],
      context,
      "2027-01-01T00:00:00.000Z",
    );
    expect(matched.status).toBe("STALE");
    expect(matched.answer).toBeUndefined();
  });

  it("never suggests or saves highly sensitive answers", () => {
    expect(matchSavedResponse("What is your gender identity?", [], context, now)).toMatchObject({
      status: "REVIEW",
      risk: "R4",
      allowedScopes: [],
    });
    expect(() =>
      createSavedResponse({
        question: "What is your gender identity?",
        answer: "Prefer not to say",
        reuseScope: "APPLICATION",
        context,
        now,
      }),
    ).toThrow("Highly sensitive");
  });

  it("refuses broad or ambiguous work-authorization reuse", () => {
    expect(() =>
      createSavedResponse({
        question: "Will you require sponsorship in the future?",
        answer: "No",
        reuseScope: "GLOBAL",
        context,
        now,
      }),
    ).toThrow("risk policy");
    expect(() =>
      createSavedResponse({
        question: "Will you require sponsorship?",
        answer: "No",
        reuseScope: "APPLICATION",
        context,
        now,
      }),
    ).toThrow("Ambiguous consequential");
  });
});
