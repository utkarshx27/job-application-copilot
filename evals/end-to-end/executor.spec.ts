import { test, expect } from "./fixtures";
import type { AgentStore } from "@copilot/agent-core";

test("executor prepares native/custom/date/upload steps through Chrome and records one preparation", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByText("Experimental agent lab", { exact: true }).click();
  const ui = panel.getByRole("region", { name: "Local application executor" });
  await ui.getByLabel("Enable local execution").check();
  await ui.getByLabel("I approve this synthetic profile, file, and local step navigation").check();
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/agent.html");
  await page.bringToFront();
  await ui.getByRole("button", { name: "Prepare synthetic application" }).click();
  await expect(ui.getByRole("heading", { name: "Application ready for review" })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.locator("[data-agent-step=review]")).toBeVisible();
  await expect(page.locator("[data-agent-field=name]")).toHaveValue("Nora Example");
  await expect(page.locator("[data-agent-field=email]")).toHaveValue("nora@example.test");
  await expect(page.locator("[data-agent-field=location]")).toHaveValue("Bengaluru");
  await expect(page.locator("[data-agent-field=startDate]")).toHaveValue("2026-10-01");
  await expect(page.locator("[data-experience-row]")).toHaveCount(1);
  expect(
    await page
      .locator("input[type=file]")
      .evaluate(async (input: HTMLInputElement) => input.files?.[0]?.text()),
  ).toContain("Not a real candidate");
  const tracker = await panel.evaluate(
    async () =>
      (await chrome.storage.local.get("applicationTracker")).applicationTracker as {
        applications: { status: string }[];
      },
  );
  expect(tracker.applications).toHaveLength(1);
  expect(tracker.applications[0]?.status).toBe("APPLYING");
  await panel.reload();
  await panel.getByText("Experimental agent lab", { exact: true }).click();
  await expect(ui.getByRole("heading", { name: "Application ready for review" })).toBeVisible();
  expect(
    (
      await panel.evaluate(
        async () =>
          (await chrome.storage.local.get("applicationTracker")).applicationTracker as {
            applications: unknown[];
          },
      )
    ).applications,
  ).toHaveLength(1);
  expect(page.url()).toBe("http://127.0.0.1:4173/agent.html");
});

test("executor pause/takeover preserves edits and cancel prevents later mutations", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByText("Experimental agent lab", { exact: true }).click();
  const ui = panel.getByRole("region", { name: "Local application executor" });
  await ui.getByLabel("Enable local execution").check();
  await ui.getByLabel("I approve this synthetic profile, file, and local step navigation").check();
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/agent.html");
  await page.bringToFront();
  await ui.getByRole("button", { name: "Prepare synthetic application" }).click();
  await expect(ui.getByRole("button", { name: "Pause execution" })).toBeVisible();
  await ui.getByRole("button", { name: "Take over manually" }).click();
  await expect(ui.getByRole("heading", { name: "paused", exact: true })).toBeVisible();
  await page.locator("[data-agent-field=name]").fill("My reviewed change");
  await ui.getByRole("button", { name: "Resume execution" }).click();
  await expect(ui.getByRole("heading", { name: "Application ready for review" })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.locator("[data-agent-field=name]")).toHaveValue("My reviewed change");
  await ui.getByRole("button", { name: "Cancel execution" }).click();
  await expect(ui.getByRole("heading", { name: "cancelled", exact: true })).toBeVisible();
  await expect(ui.getByRole("button", { name: "Resume execution" })).toHaveCount(0);
});

test("executor rejects page-origin control and a different local route", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByText("Experimental agent lab", { exact: true }).click();
  const ui = panel.getByRole("region", { name: "Local application executor" });
  await ui.getByLabel("Enable local execution").check();
  await ui.getByLabel("I approve this synthetic profile, file, and local step navigation").check();
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/workday.html");
  await page.bringToFront();
  const worker = context.serviceWorkers()[0]!;
  const response = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab!.id! },
      func: async () => {
        const response: unknown = await chrome.runtime.sendMessage({
          type: "PANEL_EXECUTOR_START",
          approved: true,
        });
        return response;
      },
    });
    return result?.result;
  });
  expect(response).toMatchObject({ ok: false, error: { code: "BAD_MESSAGE" } });
  await ui.getByRole("button", { name: "Prepare synthetic application" }).click();
  await expect(ui.getByRole("alert")).toContainText("LOCAL_EXECUTION_PAGE_REQUIRED");
});

test("executor resumes after actual worker loss with no duplicate experience row", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByText("Experimental agent lab", { exact: true }).click();
  const ui = panel.getByRole("region", { name: "Local application executor" });
  await ui.getByLabel("Enable local execution").check();
  await ui.getByLabel("I approve this synthetic profile, file, and local step navigation").check();
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/agent.html");
  await page.bringToFront();
  await ui.getByRole("button", { name: "Prepare synthetic application" }).click();
  await expect(page.locator("[data-experience-row]")).toHaveCount(1, { timeout: 20000 });
  const cdp = await context.newCDPSession(panel);
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  await panel.reload();
  await panel.getByText("Experimental agent lab", { exact: true }).click();
  await expect(ui.getByRole("heading", { name: "paused", exact: true })).toBeVisible({
    timeout: 10000,
  });
  await page.bringToFront();
  await ui.getByRole("button", { name: "Resume execution" }).click();
  await expect(ui.getByRole("heading", { name: "Application ready for review" })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.locator("[data-experience-row]")).toHaveCount(1);
  const store = await panel.evaluate(
    async () =>
      new Promise<AgentStore>((resolve) => {
        const request = indexedDB.open("copilot-executor-v1");
        request.onsuccess = () => {
          const get = request.result
            .transaction("controller")
            .objectStore("controller")
            .get("state");
          get.onsuccess = () => {
            resolve(get.result as AgentStore);
            request.result.close();
          };
        };
      }),
  );
  expect(store.runs[0]?.intents.filter((x) => x.proposal.kind === "ADD_ROW")).toHaveLength(1);
  await cdp.detach();
});

test("executor reconciles full-document step transitions without clicking Next twice", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByText("Experimental agent lab", { exact: true }).click();
  const ui = panel.getByRole("region", { name: "Local application executor" });
  await ui.getByLabel("Enable local execution").check();
  await ui.getByLabel("I approve this synthetic profile, file, and local step navigation").check();
  const page = await context.newPage();
  await page.addInitScript(() => {
    if (location.hostname === "127.0.0.1") sessionStorage.setItem("agent-multipage", "true");
  });
  await page.goto("http://127.0.0.1:4173/agent.html");
  await page.bringToFront();
  await ui.getByRole("button", { name: "Prepare synthetic application" }).click();
  await expect(ui.getByRole("heading", { name: "Application ready for review" })).toBeVisible({
    timeout: 25000,
  });
  await expect(page.locator("[data-agent-step=review]")).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("agent-demo-step"))).toBe("review");
  await expect(page.locator("[data-experience-row]")).toHaveCount(1);
});

test("executor pauses for challenge handoff and rechecks before resuming", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByText("Experimental agent lab", { exact: true }).click();
  const ui = panel.getByRole("region", { name: "Local application executor" });
  await ui.getByLabel("Enable local execution").check();
  await ui.getByLabel("I approve this synthetic profile, file, and local step navigation").check();
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/agent.html");
  await page.locator("[data-agent-challenge]").evaluate((element: HTMLElement) => {
    element.hidden = false;
  });
  await page.bringToFront();
  await ui.getByRole("button", { name: "Prepare synthetic application" }).click();
  await expect(ui.getByRole("heading", { name: "paused", exact: true })).toBeVisible();
  await expect(ui.getByText(/access challenge/)).toBeVisible();
  await expect(page.locator("[data-agent-field=name]")).toHaveValue("");
  await expect(ui.getByRole("status")).toContainText("Complete the verification");
  await expect(ui.locator("li").filter({ hasText: /^PAUSED$/ })).toHaveCount(1);
  await ui.getByRole("button", { name: "Resume execution", exact: true }).click();
  await expect(ui.locator("li").filter({ hasText: /^PAUSED$/ })).toHaveCount(2);
  await expect(ui.getByRole("heading", { name: "paused", exact: true })).toBeVisible();
  await expect(ui.getByText(/0 execution actions/)).toBeVisible();
  await expect(page.locator("[data-agent-field=name]")).toHaveValue("");
  // Simulate the user completing this synthetic challenge; no challenge solver.
  await page.locator("[data-agent-challenge]").evaluate((element: HTMLElement) => {
    element.hidden = true;
  });
  await ui.getByRole("button", { name: "Resume execution", exact: true }).click();
  await expect(ui.getByRole("heading", { name: "Application ready for review" })).toBeVisible({
    timeout: 25000,
  });
  await expect(page.locator("[data-agent-field=name]")).toHaveValue("Nora Example");
});

test("executor rejects a retained but invalid field instead of counting it as success", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByText("Experimental agent lab", { exact: true }).click();
  const ui = panel.getByRole("region", { name: "Local application executor" });
  await ui.getByLabel("Enable local execution").check();
  await ui.getByLabel("I approve this synthetic profile, file, and local step navigation").check();
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/agent.html");
  await page.locator("[data-agent-field=name]").evaluate((element: HTMLInputElement) => {
    element.pattern = "OnlyThisValue";
  });
  await page.bringToFront();
  await ui.getByRole("button", { name: "Prepare synthetic application" }).click();
  await expect(ui.getByRole("heading", { name: "paused", exact: true })).toBeVisible();
  await expect(ui.getByText(/1 execution actions/)).toBeVisible();
  await expect(page.locator("[data-agent-field=email]")).toHaveValue("");
});

test("executor removes only an extra empty experience row after takeover", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByText("Experimental agent lab", { exact: true }).click();
  const ui = panel.getByRole("region", { name: "Local application executor" });
  await ui.getByLabel("Enable local execution").check();
  await ui.getByLabel("I approve this synthetic profile, file, and local step navigation").check();
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/agent.html");
  await page.bringToFront();
  await ui.getByRole("button", { name: "Prepare synthetic application" }).click();
  await expect(page.locator("[data-agent-step=experience]")).toBeVisible();
  await ui.getByRole("button", { name: "Pause execution" }).click();
  await expect(ui.getByRole("heading", { name: "paused", exact: true })).toBeVisible();
  if ((await page.locator("[data-experience-row]").count()) === 0)
    await page.getByRole("button", { name: "Add experience", exact: true }).click();
  await page.getByRole("button", { name: "Add experience", exact: true }).click();
  await expect(page.locator("[data-experience-row]")).toHaveCount(2);
  await ui.getByRole("button", { name: "Resume execution" }).click();
  await expect(ui.getByRole("heading", { name: "Application ready for review" })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.locator("[data-experience-row]")).toHaveCount(1);
  await expect(page.locator("[data-agent-field=employer]")).toHaveValue("Synthetic Labs");
});

test("executor competing starts share one durable application lease", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByText("Experimental agent lab", { exact: true }).click();
  const ui = panel.getByRole("region", { name: "Local application executor" });
  await ui.getByLabel("Enable local execution").check();
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/agent.html");
  await page.bringToFront();
  const responses = await panel.evaluate(async () => {
    const results: unknown[] = await Promise.all([
      chrome.runtime.sendMessage({ type: "PANEL_EXECUTOR_START", approved: true }),
      chrome.runtime.sendMessage({ type: "PANEL_EXECUTOR_START", approved: true }),
    ]);
    return results;
  });
  expect(responses.filter((response) => (response as { ok: boolean }).ok)).toHaveLength(1);
  await expect(ui.getByRole("heading", { name: "Application ready for review" })).toBeVisible({
    timeout: 20000,
  });
  await expect(ui.locator("article")).toHaveCount(1);
});
