import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createEmptyVault, profileToDraft, saveProfileDraft } from "@copilot/profile-core";
import { JobPreparationController } from "../src/job-preparation-controller";
import { getProfileVault } from "../src/profile-storage";
import { PreparationStoreSchema, emptyPreparations, type DiscoveryJob } from "@copilot/agent-core";
import { PrivateRepository } from "../src/private-repository";
vi.mock("../src/profile-storage", () => ({ getProfileVault: vi.fn() }));
const job: DiscoveryJob = {
  id: "local:job-7-1",
  source: "LOCAL_TEST_ATS",
  sourceJobId: "job-7-1",
  sourceUrl: "http://127.0.0.1:4173/api/portal/jobs",
  title: "Engineer",
  description: "",
  companyKey: "local:company-b",
  company: "Example",
  location: "London",
  applicationUrl: "http://127.0.0.1:4173/portal.html?scenario=portal-01&jobId=job-7-1",
  availability: "AVAILABLE",
  observedAt: Date.now(),
  salary: null,
  provenance: [],
};
const source = { localForPreparation: vi.fn(() => Promise.resolve(job)) };
const prepared = vi.fn(() => Promise.resolve());
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const vault = createEmptyVault();
  const draft = profileToDraft(vault.currentProfile);
  draft.identity = { full: "Priya Sharma", given: "Priya", family: "Sharma" };
  draft.email = "priya@example.test";
  draft.phone = "+919876543210";
  vi.mocked(getProfileVault).mockResolvedValue(saveProfileDraft(vault, draft));
  vi.stubGlobal("chrome", {
    tabs: {
      create: vi.fn(() => Promise.resolve({ id: 7 })),
      get: vi.fn(() =>
        Promise.resolve({ id: 7, active: true, status: "complete", url: job.applicationUrl }),
      ),
    },
    scripting: {
      executeScript: vi.fn(() =>
        Promise.resolve([{ frameId: 0, documentId: "document-1", result: { prepared: true } }]),
      ),
    },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("uses one timestamp for the ten-minute review window", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now++);
  const controller = new JobPreparationController(source, prepared);
  const view = await controller.review(job.id);
  expect(view.record.expiresAt - view.record.createdAt).toBe(600000);
});
it("competing approvals create only one tab and reconcile tracking once", async () => {
  const controller = new JobPreparationController(source, prepared);
  const view = await controller.review(job.id);
  const approvals = await Promise.allSettled([
    controller.approve(view.record.id, view.record.revision, {
      currentLocation: "Bengaluru",
      workArrangement: "Remote",
    }),
    controller.approve(view.record.id, view.record.revision, {
      currentLocation: "Bengaluru",
      workArrangement: "Remote",
    }),
  ]);
  expect(approvals.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
  expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(2);
  expect((await controller.view(view.record.id)).record.state).toBe("PREPARED");
  await controller.view(view.record.id);
  expect(prepared).toHaveBeenCalledTimes(1);
  const restarted = new JobPreparationController(source, prepared);
  expect((await restarted.review(job.id)).record.id).toBe(view.record.id);
  expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
});
it("rejects a changed profile before opening a tab", async () => {
  const controller = new JobPreparationController(source, prepared);
  const view = await controller.review(job.id);
  const vault = await getProfileVault();
  const draft = profileToDraft(vault.currentProfile);
  draft.email = "changed@example.test";
  vi.mocked(getProfileVault).mockResolvedValue(saveProfileDraft(vault, draft));
  await expect(
    controller.approve(view.record.id, view.record.revision, {
      currentLocation: "Bengaluru",
      workArrangement: "Remote",
    }),
  ).rejects.toThrow(/changed/);
  expect(chrome.tabs.create).not.toHaveBeenCalled();
});
it("recovers a persisted dispatch as manual review and never replays it", async () => {
  const controller = new JobPreparationController(source, prepared);
  const view = await controller.review(job.id);
  const repo = new PrivateRepository(
    "copilot-job-preparation-v1",
    PreparationStoreSchema,
    emptyPreparations,
  );
  await repo.transact((store) => ({
    ...store,
    records: store.records.map((entry) => ({
      ...entry,
      state: "PREPARING",
      actions: ["OPEN_FORM"],
      answers: { ...view.contact, currentLocation: "Bengaluru", workArrangement: "Remote" },
    })),
  }));
  const restarted = new JobPreparationController(source, prepared);
  expect((await restarted.view(view.record.id)).record.state).toBe("NEEDS_REVIEW");
  expect(chrome.tabs.create).not.toHaveBeenCalled();
  expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
});
it("stops after an uncertain browser action and preserves cancellation", async () => {
  const controller = new JobPreparationController(source, prepared);
  const view = await controller.review(job.id);
  vi.mocked(chrome.scripting.executeScript).mockRejectedValueOnce(new Error("Document changed"));
  expect(
    (
      await controller.approve(view.record.id, view.record.revision, {
        currentLocation: "Bengaluru",
        workArrangement: "Remote",
      })
    ).record.state,
  ).toBe("NEEDS_REVIEW");
  expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
  expect(prepared).not.toHaveBeenCalled();
  const cancelled = await controller.cancel(view.record.id, view.record.revision);
  expect(cancelled.record.state).toBe("CANCELLED");
  await controller.forget(view.record.id, cancelled.record.revision);
  await expect(controller.view(view.record.id)).rejects.toThrow(/unavailable/);
});
