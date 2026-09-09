import { expect, it } from "vitest";
import {
  claimPreparation,
  preparationUrl,
  PreparationRecordSchema,
  type PreparationAnswers,
} from "../src/job-preparation";
const now = 1000;
const owner = { ownerId: "vault", profileId: "person", profileRevision: 1 };
const job = {
  id: "local:job-7-1",
  source: "LOCAL_TEST_ATS" as const,
  sourceJobId: "job-7-1",
  sourceUrl: "http://127.0.0.1:4173/api/portal/jobs",
  title: "Engineer",
  description: "",
  companyKey: "local:company-b",
  company: "Example",
  location: "London",
  applicationUrl: "http://127.0.0.1:4173/portal.html?scenario=portal-01&jobId=job-7-1",
  availability: "AVAILABLE" as const,
  observedAt: now,
  salary: null,
  provenance: [],
};
const record = PreparationRecordSchema.parse({
  id: crypto.randomUUID(),
  revision: 1,
  owner,
  job,
  profileDigest: "a".repeat(64),
  state: "REVIEW_REQUIRED",
  answers: null,
  submissionApproved: false,
  createdAt: now,
  expiresAt: now + 600000,
  tabId: null,
  documentId: null,
  actions: [],
  reason: "Review",
  trackerRecorded: false,
});
const store = { version: 1 as const, records: [record] };
const answers: PreparationAnswers = {
  name: "Priya Sharma",
  email: "priya@example.test",
  phone: "+919876543210",
  currentLocation: "Bengaluru",
  workArrangement: "Remote",
};
it("claims one exact job/profile approval and never grants submission", () => {
  const claimed = claimPreparation(
    store,
    record.id,
    1,
    owner,
    record.profileDigest,
    job,
    answers,
    now + 1,
  );
  expect(claimed.records[0]).toMatchObject({
    state: "PREPARING",
    revision: 2,
    submissionApproved: false,
  });
  expect(() =>
    claimPreparation(claimed, record.id, 1, owner, record.profileDigest, job, answers, now + 2),
  ).toThrow(/already approved/);
  expect(PreparationRecordSchema.safeParse({ ...record, submissionApproved: true }).success).toBe(
    false,
  );
});
it("rejects stale profile content, account changes, job changes and expired approval", () => {
  for (const input of [
    { owner: { ...owner, profileRevision: 2 }, digest: record.profileDigest, job, at: now },
    { owner: { ...owner, profileId: "another" }, digest: record.profileDigest, job, at: now },
    { owner, digest: "b".repeat(64), job, at: now },
    { owner, digest: record.profileDigest, job: { ...job, title: "Different role" }, at: now },
    { owner, digest: record.profileDigest, job, at: record.expiresAt },
  ])
    expect(() =>
      claimPreparation(
        store,
        record.id,
        1,
        input.owner,
        input.digest,
        input.job,
        answers,
        input.at,
      ),
    ).toThrow();
});
it("does not grant local preparation to imports, lookalikes or arbitrary local routes", () => {
  for (const candidate of [
    { ...job, source: "IMPORT" as const },
    { ...job, applicationUrl: job.applicationUrl + "&extra=1" },
    { ...job, applicationUrl: job.applicationUrl.replace("127.0.0.1", "localhost") },
    { ...job, availability: "EXPIRED" as const },
    { ...job, applicationUrl: job.applicationUrl.replace("portal-01", "portal-02") },
  ])
    expect(() => preparationUrl(candidate)).toThrow();
});
