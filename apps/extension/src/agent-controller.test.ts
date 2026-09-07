import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { AGENT_FIXTURE_URL, type AgentObservation } from "@copilot/agent-core";
import { AgentRepository } from "./agent-storage";
import { AgentLabController, type AgentBrowser } from "./agent-controller";

function setup() {
  const factory = new IDBFactory();
  const repository = new AgentRepository(factory);
  const browser: AgentBrowser = {
    activeTab: vi.fn(() => Promise.resolve({ id: 1, url: AGENT_FIXTURE_URL })),
    profileRevision: vi.fn(() => Promise.resolve(1)),
    observe: vi.fn((tabId: number, profileRevision: number): Promise<AgentObservation> =>
      Promise.resolve({
        id: crypto.randomUUID(),
        binding: { tabId, profileRevision, documentId: "doc-1", url: AGENT_FIXTURE_URL },
        capturedAt: 1_000,
        fingerprint: "a".repeat(64),
        fieldCount: 4,
        targetRefs: [],
      }),
    ),
  };
  return {
    factory,
    repository,
    browser,
    controller: new AgentLabController(repository, browser, true, () => 1_000),
  };
}
describe("agent lab and durable IndexedDB", () => {
  it("cannot activate in a production build or touch the page while disabled", async () => {
    const f = setup();
    const production = new AgentLabController(f.repository, f.browser, false);
    expect(await production.status()).toMatchObject({ available: false, enabled: false });
    await expect(production.setEnabled(true)).rejects.toThrow("research build required");
    await expect(f.controller.start()).rejects.toThrow("feature disabled");
    expect(f.browser.observe).not.toHaveBeenCalled();
  });
  it("completes a read-only checkpoint and restores it after reopening storage", async () => {
    const f = setup();
    await f.controller.setEnabled(true);
    const status = await f.controller.start();
    expect(status.runs[0]).toMatchObject({ state: "READY_FOR_REVIEW", fieldCount: 4, actions: 1 });
    const saved = await f.repository.read();
    expect(saved.runs[0]?.consent.capabilities).toEqual(["READ_PAGE"]);
    expect(saved.outbox).toEqual([]);
    await f.repository.close();
    const restored = new AgentRepository(f.factory);
    expect(await restored.read()).toEqual(saved);
    const restarted = new AgentLabController(restored, f.browser, true, () => 1_000);
    expect(await restarted.status()).toEqual(status);
    const runId = status.runs[0]?.id;
    if (!runId) throw new Error("No run");
    await restarted.pause(runId);
    expect((await restarted.checkpoint(runId)).runs[0]).toMatchObject({
      state: "READY_FOR_REVIEW",
      actions: 2,
    });
    expect((await restarted.cancel(runId)).runs[0]?.state).toBe("CANCELLED");
    await restored.close();
  });
  it("rejects non-fixture pages before observing", async () => {
    const f = setup();
    vi.mocked(f.browser.activeTab).mockResolvedValue({
      id: 1,
      url: "https://www.linkedin.com/jobs",
    });
    await f.controller.setEnabled(true);
    await expect(f.controller.start()).rejects.toThrow("local fixture required");
    expect(f.browser.observe).not.toHaveBeenCalled();
  });
  it("pauses on profile changes instead of silently using new facts", async () => {
    const f = setup();
    await f.controller.setEnabled(true);
    const status = await f.controller.start();
    const runId = status.runs[0]?.id;
    if (!runId) throw new Error("No run");
    vi.mocked(f.browser.profileRevision).mockResolvedValue(2);
    await expect(f.controller.checkpoint(runId)).rejects.toThrow("profile changed");
    expect((await f.controller.status()).runs[0]).toMatchObject({
      state: "PAUSED",
      pauseReason: "PROFILE_CHANGED",
      actions: 1,
    });
  });
  it("serializes competing instances, rolls back rejected writes, and recovers leases", async () => {
    const f = setup();
    await f.controller.setEnabled(true);
    const status = await f.controller.start();
    const runId = status.runs[0]?.id;
    if (!runId) throw new Error("No run");
    const other = new AgentRepository(f.factory);
    const results = await Promise.allSettled([
      f.repository.dispatch({ type: "ACQUIRE", runId, owner: crypto.randomUUID() }, 1_001),
      other.dispatch({ type: "ACQUIRE", runId, owner: crypto.randomUUID() }, 1_001),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const before = await other.read();
    await expect(
      other.dispatch({ type: "ACQUIRE", runId, owner: crypto.randomUUID() }, 1_002),
    ).rejects.toThrow("lease busy");
    expect(await other.read()).toEqual(before);
    await f.repository.close();
    const restarted = new AgentLabController(other, f.browser, true, () => 1_003);
    expect((await restarted.status()).runs[0]).toMatchObject({
      state: "PAUSED",
      pauseReason: "WORKER_RESTART",
    });
    expect((await restarted.checkpoint(runId)).runs[0]?.state).toBe("READY_FOR_REVIEW");
    await other.close();
  });
  it("disabling invalidates active progress and prevents new checkpoints", async () => {
    const f = setup();
    await f.controller.setEnabled(true);
    const status = await f.controller.start();
    const runId = status.runs[0]?.id;
    if (!runId) throw new Error("No run");
    expect((await f.controller.setEnabled(false)).runs[0]).toMatchObject({
      state: "PAUSED",
      pauseReason: "FEATURE_DISABLED",
    });
    await expect(f.controller.checkpoint(runId)).rejects.toThrow("run not resumable");
  });
  it("surfaces corrupt data without replacing it with an empty store", async () => {
    const f = setup();
    await f.repository.dispatch({ type: "SET_ENABLED", enabled: true }, 1_000);
    await f.repository.close();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = f.factory.open("copilot-agent-v1", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Fixture database failed"));
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("controller", "readwrite");
      tx.objectStore("controller").put({ corrupt: true }, "state");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error("Fixture corruption failed"));
    });
    db.close();
    await expect(f.repository.read()).rejects.toThrow();
    await expect(
      f.repository.dispatch({ type: "SET_ENABLED", enabled: true }, 1_001),
    ).rejects.toThrow();
    await expect(f.repository.read()).rejects.toThrow();
  });
});
