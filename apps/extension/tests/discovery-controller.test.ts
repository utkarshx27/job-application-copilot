import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createEmptyVault } from "@copilot/profile-core";
import { getProfileVault } from "../src/profile-storage";
import { DiscoveryController } from "../src/discovery-controller";
vi.mock("../src/profile-storage", () => ({ getProfileVault: vi.fn() }));
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.mocked(getProfileVault).mockResolvedValue(createEmptyVault());
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(url.includes("/companies") ? [] : { jobs: [], hasMore: false }),
        ),
      ),
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("persists the read budget across controller restarts and counts failed requests", async () => {
  for (let i = 0; i < 25; i++) await new DiscoveryController().search("");
  const controller = new DiscoveryController();
  expect((await controller.view()).remainingReads).toBe(0);
  await expect(controller.search("")).rejects.toThrow(/budget exhausted/);
  expect(fetch).toHaveBeenCalledTimes(50);
  expect((await controller.view()).sourceStatus).toBe("BUDGET_EXHAUSTED");
});
it("counts HTTP failures, retains existing imports and never fetches their URLs", async () => {
  const controller = new DiscoveryController();
  await controller.importListing({
    title: "Engineer",
    company: "Example",
    location: "Remote",
    url: "https://example.test/job",
    description: "Synthetic listing",
  });
  expect(fetch).not.toHaveBeenCalled();
  vi.mocked(fetch).mockResolvedValueOnce(new Response("denied", { status: 429 }));
  await expect(controller.search("")).rejects.toThrow(/429/);
  const view = await controller.view();
  expect(view.remainingReads).toBe(49);
  expect(view.jobs).toHaveLength(1);
  expect(view.sourceStatus).toBe("ERROR");
});
it("cancels an in-flight request without publishing a partial catalog", async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  vi.mocked(fetch).mockImplementationOnce(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        });
        started();
      }),
  );
  const controller = new DiscoveryController();
  const search = controller.search("");
  const rejected = expect(search).rejects.toThrow(/cancelled/);
  await ready;
  await expect(controller.search("overlap")).rejects.toThrow(/already running/);
  await controller.cancel();
  await rejected;
  expect((await controller.view()).sourceStatus).toBe("CANCELLED");
  expect((await controller.view()).jobs).toHaveLength(0);
});
it("does not publish results across profile changes", async () => {
  const initial = await getProfileVault();
  vi.mocked(fetch).mockImplementationOnce(() => {
    vi.mocked(getProfileVault).mockResolvedValue(createEmptyVault());
    return Promise.resolve(new Response(JSON.stringify({ jobs: [], hasMore: false })));
  });
  const controller = new DiscoveryController();
  await expect(controller.search("")).rejects.toThrow(/Profile changed/);
  expect((await controller.view()).remainingReads).toBe(50);
  vi.mocked(getProfileVault).mockResolvedValue(initial);
  expect((await controller.view()).sourceStatus).toBe("ERROR");
});

it("does not share company ratings through ambiguous name/location delimiters", async () => {
  const controller = new DiscoveryController();
  const first = await controller.importListing({
    title: "Engineer",
    company: "A:B",
    location: "C",
    url: "https://example.test/one",
    description: "",
  });
  const id = first.jobs[0]!.job.id;
  await controller.evidence(id, {
    source: "Test",
    sourceUrl: "https://example.test/reviews",
    value: 4,
    scale: 5,
    count: 15,
    retrievedAt: "2024-01-01",
  });
  const second = await controller.importListing({
    title: "Engineer",
    company: "A",
    location: "B:C",
    url: "https://example.test/two",
    description: "",
  });
  expect(new Set(second.jobs.map((entry) => entry.job.companyKey)).size).toBe(2);
  expect(second.jobs.find((entry) => entry.job.id !== id)?.evidence.status).toBe("UNAVAILABLE");
  expect(second.jobs.find((entry) => entry.job.id === id)?.evidence.ratings[0]?.value).toBe(4);
});
