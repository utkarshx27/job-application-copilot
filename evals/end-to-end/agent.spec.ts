import { expect, test } from "./fixtures";
import type { AgentStore } from "@copilot/agent-core";

test("agent lab opt-in records local checkpoints, persists progress, and never changes inputs", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByText("Experimental agent lab", { exact: true }).click();
  const lab = panel.getByRole("region", { name: "Experimental agent lab" });
  await expect(lab.getByLabel("Enable local agent lab")).not.toBeChecked();
  await expect(lab.getByRole("button", { name: "Start local checkpoint run" })).toBeDisabled();
  await lab.getByLabel("Enable local agent lab").click();
  await expect(lab.getByLabel("Enable local agent lab")).toBeChecked();
  const application = await context.newPage();
  await application.goto("http://127.0.0.1:4173/workday.html");
  await application.bringToFront();
  const before = await application
    .locator("input")
    .evaluateAll((inputs) =>
      inputs.map((input) => (input instanceof HTMLInputElement ? input.value : "")),
    );
  await lab.getByRole("button", { name: "Start local checkpoint run" }).click();
  await expect(lab.getByRole("heading", { name: "Checkpoint recorded" })).toBeVisible();
  await expect(lab.getByText(/1 read checkpoints/)).toBeVisible();
  await panel.reload();
  await panel.getByText("Experimental agent lab", { exact: true }).click();
  await expect(lab.getByRole("heading", { name: "Checkpoint recorded" })).toBeVisible();
  await lab.getByRole("button", { name: "Pause run" }).click();
  await expect(lab.getByRole("heading", { name: "paused", exact: true })).toBeVisible();
  await lab.getByRole("button", { name: "Resume and read checkpoint" }).click();
  await expect(lab.getByText(/2 read checkpoints/)).toBeVisible();
  expect(
    await application
      .locator("input")
      .evaluateAll((inputs) =>
        inputs.map((input) => (input instanceof HTMLInputElement ? input.value : "")),
      ),
  ).toEqual(before);
  expect(application.url()).toBe("http://127.0.0.1:4173/workday.html");
  await lab.getByLabel("Enable local agent lab").click();
  await expect(lab.getByLabel("Enable local agent lab")).not.toBeChecked();
  await expect(lab.getByText("Reason: feature disabled")).toBeVisible();
  await expect(lab.getByRole("button", { name: "Resume and read checkpoint" })).toBeDisabled();
});

test("agent lab recovers a persisted in-flight intent after the actual Chrome worker stops", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByText("Experimental agent lab", { exact: true }).click();
  const lab = panel.getByRole("region", { name: "Experimental agent lab" });
  await lab.getByLabel("Enable local agent lab").click();
  await expect(lab.getByLabel("Enable local agent lab")).toBeChecked();
  const application = await context.newPage();
  await application.goto("http://127.0.0.1:4173/workday.html");
  await application.bringToFront();
  await lab.getByRole("button", { name: "Start local checkpoint run" }).click();
  await expect(lab.getByRole("heading", { name: "Checkpoint recorded" })).toBeVisible();
  // Test-runner-only fault injection: leave a claimed read in the real IDB store.
  // No runtime command exposes this capability to the page or panel UI.
  await panel.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("copilot-agent-v1", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Fault injection could not open IDB"));
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("controller", "readwrite");
      const get = tx.objectStore("controller").get("state");
      get.onsuccess = () => {
        const store = get.result as AgentStore;
        const run = store.runs[0];
        if (!run?.observation) {
          tx.abort();
          return;
        }
        const now = Date.now();
        store.fence++;
        run.lease = { owner: crypto.randomUUID(), fence: store.fence, expiresAt: now + 20_000 };
        run.state = "EXECUTING";
        run.budget.actions++;
        const intentId = crypto.randomUUID();
        run.intents.push({
          status: "CLAIMED",
          fence: store.fence,
          proposal: {
            id: intentId,
            runId: run.id,
            observationId: run.observation.id,
            kind: "READ_PAGE",
            targetRef: null,
            factRefs: [],
            expected: "CHECKPOINT_RECORDED",
            expiresAt: now + 10_000,
            costMicros: 0,
          },
        });
        run.revision++;
        run.updatedAt = now;
        run.journal.push({ sequence: run.revision, at: now, code: "CLAIMED", intentId });
        tx.objectStore("controller").put(store, "state");
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new Error("Fault injection aborted"));
      tx.onerror = () => reject(new Error("Fault injection failed"));
    });
    db.close();
  });
  const cdp = await context.newCDPSession(panel);
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  await panel.reload();
  await panel.getByText("Experimental agent lab", { exact: true }).click();
  await expect(lab.getByText("Reason: worker restart")).toBeVisible();
  await lab.getByRole("button", { name: "Resume and read checkpoint" }).click();
  await expect(lab.getByRole("heading", { name: "Checkpoint recorded" })).toBeVisible();
  await expect(lab.getByText(/3 read checkpoints/)).toBeVisible();
  await cdp.detach();
});

test("agent lab rejects a different local route and content-script requests", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByText("Experimental agent lab", { exact: true }).click();
  const lab = panel.getByRole("region", { name: "Experimental agent lab" });
  await lab.getByLabel("Enable local agent lab").click();
  await expect(lab.getByLabel("Enable local agent lab")).toBeChecked();
  const application = await context.newPage();
  await application.goto("http://127.0.0.1:4173/");
  await application.bringToFront();
  await lab.getByRole("button", { name: "Start local checkpoint run" }).click();
  await expect(lab.getByRole("alert")).toBeVisible();
  await expect(lab.getByText("No agent runs yet.")).toBeVisible();
  const worker = context.serviceWorkers()[0];
  if (!worker) throw new Error("Extension worker unavailable");
  const response: unknown = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined) throw new Error("No active fixture");
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        const response: unknown = await chrome.runtime.sendMessage({ type: "PANEL_AGENT_START" });
        return response;
      },
    });
    return result?.result;
  });
  expect(response).toMatchObject({ ok: false, error: { code: "BAD_MESSAGE" } });
});
