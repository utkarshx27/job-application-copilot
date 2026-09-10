import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  PreparationRecordSchema,
  retrieveCorrection,
  emptyMemory,
  saveCorrection,
} from "@copilot/agent-core";
import {
  PortalPreparationExecutor,
  validatePreparationFile,
  portalQuestionScope,
} from "../src/portal-preparation-executor";
const owner = { ownerId: "vault", profileId: "candidate", profileRevision: 1 };
beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());
it("rejects changed and oversized resume bytes before browser access", async () => {
  const bytes = new TextEncoder().encode("Synthetic only");
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const file = { name: "resume.txt", base64: btoa("Synthetic only"), sha256 };
  expect(await validatePreparationFile(file)).toEqual(file);
  await expect(validatePreparationFile({ ...file, base64: btoa("Changed") })).rejects.toThrow();
  await expect(validatePreparationFile({ ...file, name: "../resume.txt" })).rejects.toThrow();
  await expect(
    validatePreparationFile({ ...file, base64: btoa("x".repeat(500001)) }),
  ).rejects.toThrow();
});
it("keeps corrected current compensation separate from expected compensation, other users and revisions", () => {
  const field = {
    key: "renamed-current",
    label: "Annual earnings",
    kind: "number" as const,
    options: [],
    value: "",
    required: true,
  };
  const store = saveCorrection(
    emptyMemory(),
    {
      id: crypto.randomUUID(),
      revision: 1,
      kind: "FIELD_MEANING",
      owner,
      scope: portalQuestionScope(field),
      rejected: null,
      accepted: "COMP.current_compensation",
      observationHash: "a".repeat(64),
      confirmed: true,
      createdAt: 1,
      updatedAt: 1,
      expiresAt: 100000,
    },
    0,
  );
  expect(
    retrieveCorrection(store, owner, portalQuestionScope({ ...field, key: "another-name" }), 2)
      .status,
  ).toBe("MATCH");
  expect(
    retrieveCorrection(
      store,
      owner,
      portalQuestionScope({ ...field, label: "Expected annual earnings" }),
      2,
    ).status,
  ).toBe("NONE");
  expect(
    retrieveCorrection(store, { ...owner, profileRevision: 2 }, portalQuestionScope(field), 2)
      .status,
  ).toBe("NONE");
  expect(
    retrieveCorrection(store, { ...owner, profileId: "other" }, portalQuestionScope(field), 2)
      .status,
  ).toBe("NONE");
  expect(retrieveCorrection(store, owner, portalQuestionScope(field), 100001).status).toBe("NONE");
});
it("rejects a swapped final summary or missing retained file", () => {
  const record = PreparationRecordSchema.parse({
    id: crypto.randomUUID(),
    revision: 1,
    owner,
    job: {
      id: "local:job-7-8",
      source: "LOCAL_TEST_ATS",
      sourceJobId: "job-7-8",
      sourceUrl: "http://127.0.0.1:4173/api/portal/jobs",
      title: "Engineer",
      company: "Example",
      companyKey: "local:company-a",
      location: "Bengaluru",
      description: "",
      applicationUrl: "http://127.0.0.1:4173/portal.html?scenario=portal-30&jobId=job-7-8",
      availability: "AVAILABLE",
      observedAt: 1,
      salary: null,
      provenance: [],
    },
    profileDigest: "a".repeat(64),
    state: "READY_TO_SUBMIT",
    answers: null,
    submissionApproved: false,
    createdAt: 1,
    expiresAt: 100000,
    tabId: 1,
    documentId: "doc",
    actions: [],
    reason: "Review",
    trackerRecorded: false,
    reviewedQuestions: [
      {
        key: "currentSalary",
        label: "Current compensation",
        value: "900000",
        meaning: "currentSalary",
      },
      {
        key: "expectedSalary",
        label: "Expected compensation",
        value: "1500000",
        meaning: "expectedSalary",
      },
      { key: "resume", label: "Resume document", value: "a".repeat(64), meaning: "resume" },
    ],
  });
  const executor = new PortalPreparationExecutor(
    () => Promise.resolve(record),
    async () => {},
    async () => {},
  );
  record.file = { name: "resume.txt", base64: "YQ==", sha256: "a".repeat(64) };
  const snapshot = {
    applicationId: null,
    step: "review" as const,
    fields: [],
    review: [
      ["Current compensation", "900000"],
      ["Expected compensation", "1500000"],
    ] as [string, string][],
    uploadRetained: true,
    uploadSha256: "a".repeat(64),
    hash: "a".repeat(64),
  };
  expect(() => executor.checkReview(record, snapshot)).not.toThrow();
  expect(() => executor.checkReview(record, { ...snapshot, uploadRetained: false })).toThrow();
  expect(() =>
    executor.checkReview(record, {
      ...snapshot,
      review: [
        ["Current compensation", "1500000"],
        ["Expected compensation", "900000"],
      ],
    }),
  ).toThrow();
});
