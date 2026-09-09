import { describe, expect, it } from "vitest";
import {
  companyEvidenceFor,
  CompanyRecordSchema,
  DiscoveryJobSchema,
  discoveryOwner,
  emptyDiscovery,
  mergeDiscoveredJobs,
  putDiscoveryOwner,
  rankDiscoveredJob,
} from "../src/discovery";

const now = Date.parse("2026-09-09T00:00:00Z");
const job = DiscoveryJobSchema.parse({
  id: "one",
  source: "IMPORT",
  sourceUrl: "https://example.test/job/1",
  sourceJobId: "one",
  title: "Platform Engineer",
  companyKey: "example:bengaluru",
  company: "Example",
  location: "Bengaluru",
  applicationUrl: "https://example.test/job/1",
  availability: "UNKNOWN",
  observedAt: now,
  salary: null,
  provenance: [],
});
const preferences = {
  targetRoles: ["Platform Engineer"],
  targetLocations: ["Bengaluru"],
  excludedCompanies: [],
  excludedKeywords: [],
  expectedCompensation: { amount: 100000, currency: "INR", period: "MONTH" },
};
describe("job discovery", () => {
  it("deduplicates tracking links without merging different jobs on a shared local destination", () => {
    const duplicate = {
      ...job,
      id: "two",
      applicationUrl: job.applicationUrl + "?utm_source=test",
      sourceUrl: "https://example.test/source",
    };
    const merged = mergeDiscoveredJobs([job], [duplicate]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("one");
    expect(merged[0]?.provenance).toContain(duplicate.sourceUrl);
    expect(
      mergeDiscoveredJobs(
        [],
        [
          { ...job, source: "LOCAL_TEST_ATS" },
          { ...job, source: "LOCAL_TEST_ATS", id: "two", sourceJobId: "two" },
        ],
      ),
    ).toHaveLength(2);
    expect(mergeDiscoveredJobs([job], [{ ...job, id: "two", companyKey: "another" }])).toHaveLength(
      2,
    );
  });
  it("explains deterministic scores, hard exclusions and noncomparable salary", () => {
    expect(rankDiscoveredJob(job, preferences, now).score).toBe(90);
    expect(
      rankDiscoveredJob(job, { ...preferences, excludedCompanies: ["EXAMPLE"] }, now).excluded,
    ).toBe(true);
    expect(
      rankDiscoveredJob(job, { ...preferences, excludedKeywords: ["engineer"] }, now).excluded,
    ).toBe(true);
    const annual = {
      ...job,
      salary: { amount: 1200000, currency: "INR", period: "YEAR" as const },
    };
    expect(rankDiscoveredJob(annual, preferences, now).score).toBe(90);
    expect(
      rankDiscoveredJob(
        { ...annual, salary: { ...annual.salary, period: "MONTH" } },
        preferences,
        now,
      ).score,
    ).toBe(100);
    expect(rankDiscoveredJob(job, preferences, now + 2 * 86400000).stale).toBe(true);
  });
  it("keeps employer identities separate and reports missing, stale and small-sample ratings", () => {
    const company = CompanyRecordSchema.parse({
      key: job.companyKey,
      name: job.company,
      location: job.location,
      sourceUrl: job.sourceUrl,
      observedAt: now,
      ratings: [
        {
          source: "User supplied",
          value: 4,
          scale: 5,
          count: 3,
          retrievedAt: "2024-01-01",
          sourceUrl: job.sourceUrl,
        },
      ],
    });
    expect(companyEvidenceFor(job, [company], now).ratings[0]).toMatchObject({
      stale: true,
      smallSample: true,
    });
    expect(companyEvidenceFor(job, [{ ...company, location: "London" }], now).status).toBe(
      "UNAVAILABLE",
    );
    expect(companyEvidenceFor(job, [company, company], now).status).toBe("UNAVAILABLE");
    expect(
      CompanyRecordSchema.safeParse({ ...company, ratings: [{ ...company.ratings[0], value: 6 }] })
        .success,
    ).toBe(false);
    expect(
      companyEvidenceFor(
        job,
        [{ ...company, ratings: [{ ...company.ratings[0]!, value: null }] }],
        now,
      ).ratings[0]?.value,
    ).toBeNull();
  });
  it("isolates owners and resets only the next day's read budget", () => {
    const owner = { ownerId: "vault-a", profileId: "profile-a", profileRevision: 1 };
    const entry = { ...discoveryOwner(emptyDiscovery(), owner, now), jobs: [job], reads: 50 };
    // Use different vault/profile identities, not only profile version numbers.
    const validOwner = {
      ...owner,
      ownerId: "00000000-0000-4000-8000-000000000001",
      profileId: "00000000-0000-4000-8000-000000000002",
    };
    const store = putDiscoveryOwner(emptyDiscovery(), { ...entry, owner: validOwner });
    expect(discoveryOwner(store, validOwner, now).reads).toBe(50);
    expect(discoveryOwner(store, validOwner, now + 86400000).reads).toBe(0);
    expect(
      discoveryOwner(
        store,
        { ...validOwner, profileId: "00000000-0000-4000-8000-000000000003" },
        now,
      ).jobs,
    ).toHaveLength(0);
  });
});
