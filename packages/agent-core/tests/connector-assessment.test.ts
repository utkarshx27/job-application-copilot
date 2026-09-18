import { describe, expect, it } from "vitest";
import {
  assessmentTargetInScope,
  ConnectorAssessmentSchema,
  connectorAssessmentReport,
  emptyConnectorAssessment,
} from "../src/connector-assessment";

function scoped() {
  const record = emptyConnectorAssessment("NAUKRI");
  record.scope = {
    reference: "private-permission",
    reviewerReference: "reviewer-01",
    accountContextReference: "account-01",
    startsAt: 100,
    expiresAt: 1000,
    origins: ["https://jobs.example.test"],
    paths: ["/job/123"],
    capabilities: ["READ_JOB"],
    methods: ["PUBLIC_HTTP"],
    maxPages: 3,
    minIntervalMs: 10000,
    maxConcurrent: 1,
    retentionDays: 0,
  };
  return record;
}
describe("offline AG-10 assessment", () => {
  it("rejects wildcards, unknown capabilities and limits above project ceilings", () => {
    const record = scoped();
    for (const change of [
      { origins: ["https://*.example.test"] },
      { capabilities: ["BYPASS"] },
      { maxPages: 21 },
      { minIntervalMs: 4999 },
      { maxConcurrent: 2 },
      { retentionDays: 31 },
    ]) {
      expect(
        ConnectorAssessmentSchema.safeParse({ ...record, scope: { ...record.scope, ...change } })
          .success,
      ).toBe(false);
    }
  });
  it("defaults to blocked and never grants live authority even with asserted reviews", () => {
    const record = scoped();
    expect(connectorAssessmentReport(record, 200).readiness).toBe("BLOCKED");
    record.gates = {
      ag09HeldOutReview: "claimed",
      fiveUserStudyReview: "claimed",
      threatReview: "claimed",
      compatibilityReview: "claimed",
      rollbackReview: "claimed",
      policyReview: "claimed",
    };
    expect(connectorAssessmentReport(record, 200)).toMatchObject({
      readiness: "REQUIRES_INDEPENDENT_REVIEW",
      liveEnabled: false,
      releaseAccepted: false,
      authorizationIndependentlyVerified: false,
    });
  });
  it("binds exact origins and paths, rejecting redirects, lookalikes and credentials", () => {
    const record = scoped();
    expect(assessmentTargetInScope(record, "https://jobs.example.test/job/123", 200)).toBe(true);
    for (const target of [
      "https://jobs.example.test.evil.test/job/123",
      "https://evil.test/job/123",
      "https://jobs.example.test/job/123/extra",
      "http://jobs.example.test/job/123",
      "https://user@jobs.example.test/job/123",
      "https://jobs.example.test/job/123?session=secret",
      "https://jobs.example.test/job/123#permit",
      "https://jobs.example.test/job/../job/123",
    ]) {
      expect(assessmentTargetInScope(record, target, 200)).toBe(false);
    }
  });
  it("rejects expired, future, absent and page-supplied extra authority", () => {
    const record = scoped();
    for (const now of [99, 1000, NaN])
      expect(assessmentTargetInScope(record, "https://jobs.example.test/job/123", now)).toBe(false);
    expect(
      assessmentTargetInScope(
        emptyConnectorAssessment("LINKEDIN"),
        "https://jobs.example.test/job/123",
        200,
      ),
    ).toBe(false);
    expect(
      assessmentTargetInScope(
        { ...record, liveEnabled: true },
        "https://jobs.example.test/job/123",
        200,
      ),
    ).toBe(false);
    expect(connectorAssessmentReport(record, 1000).blockers).toContain("INACTIVE_SCOPE");
  });
  it("keeps capabilities separate and reports exact access failures without private identifiers", () => {
    const record = scoped();
    record.observations = [
      {
        capability: "READ_JOB",
        method: "PUBLIC_HTTP",
        at: 150,
        outcome: "RATE_LIMITED",
        sampleSize: 1,
        httpStatus: 429,
        retryAfterSeconds: 60,
        origin: "https://jobs.example.test",
        evidenceReference: "private-trace",
      },
    ];
    const report = connectorAssessmentReport(record, 200);
    expect(report.capabilities.find((c) => c.capability === "READ_JOB")).toMatchObject({
      status: "BLOCKED_OR_UNVERIFIED",
      outcomes: [{ outcome: "RATE_LIMITED", count: 1 }],
    });
    expect(report.capabilities.find((c) => c.capability === "SUBMIT")?.status).toBe("UNASSESSED");
    for (const secret of ["private-permission", "account-01", "private-trace", "jobs.example.test"])
      expect(JSON.stringify(report)).not.toContain(secret);
  });
  it("does not certify successful, future or out-of-scope observations", () => {
    const record = scoped();
    record.observations = [
      {
        capability: "READ_JOB",
        method: "PUBLIC_HTTP",
        at: 150,
        outcome: "OBSERVED",
        sampleSize: 1,
        httpStatus: 200,
        retryAfterSeconds: null,
        origin: "https://jobs.example.test",
        evidenceReference: "trace-01",
      },
    ];
    expect(connectorAssessmentReport(record, 200).capabilities[1]?.status).toBe(
      "OBSERVATIONS_REQUIRE_REVIEW",
    );
    record.observations[0]!.at = 250;
    expect(connectorAssessmentReport(record, 200).blockers).toContain("FUTURE_OBSERVATION");
    record.observations[0]!.origin = "https://other.example.test";
    expect(connectorAssessmentReport(record, 300).capabilities[1]?.status).toBe(
      "BLOCKED_OR_UNVERIFIED",
    );
  });
});
