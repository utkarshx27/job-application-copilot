import { test, expect } from "./fixtures";

test("Jobs reviews approved profile answers, prepares the correct local first screen once and tracks without submitting", async ({
  context,
  extensionId,
}) => {
  const token = process.env.PORTAL_RUNNER_TOKEN;
  if (!token) throw new Error("Independent runner token unavailable");
  const reset = await fetch("http://127.0.0.1:4174/reset", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ seed: 7 }),
  });
  expect(reset.ok).toBe(true);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole("button", { name: "Edit full profile", exact: true }).click();
  await panel.getByLabel("Full legal name", { exact: true }).fill("Priya Sharma");
  await panel.getByLabel("Given name", { exact: true }).fill("Priya");
  await panel.getByLabel("Family name optional").fill("Sharma");
  await panel.getByLabel("Email", { exact: true }).fill("priya@example.test");
  await panel.getByLabel(/Phone E.164/).fill("+919876543210");
  await panel.getByRole("button", { name: "Save and verify profile" }).click();
  await panel.getByRole("button", { name: "Jobs", exact: true }).click();
  await panel.getByRole("button", { name: "Search demo jobs" }).click();
  const preparation = panel.getByRole("region", {
    name: "Preparation for local:job-7-1",
    exact: true,
  });
  await preparation.getByRole("button", { name: "Review local preparation", exact: true }).click();
  await expect(preparation.getByText("priya@example.test", { exact: true })).toBeVisible();
  const prepare = preparation.getByRole("button", {
    name: "Prepare local first screen",
    exact: true,
  });
  await expect(prepare).toBeDisabled();
  await preparation
    .getByLabel("Current city for this application", { exact: true })
    .fill("Bengaluru");
  await preparation
    .getByLabel("Work arrangement for this application", { exact: true })
    .selectOption("Remote");
  await preparation
    .getByLabel("I approve these answers for this local job and first screen only")
    .check();
  const opened = context.waitForEvent("page");
  await prepare.click();
  const application = await opened;
  await expect(preparation.getByText(/First screen prepared and checked/)).toBeVisible({
    timeout: 15000,
  });
  await expect(application).toHaveURL(/jobId=job-7-1/);
  await expect(application.getByLabel("Full name", { exact: true })).toHaveValue("Priya Sharma");
  await expect(application.getByLabel("Email", { exact: true })).toHaveValue("priya@example.test");
  await expect(application.getByLabel("Current city", { exact: true })).toHaveValue("Bengaluru");
  await expect(application.getByLabel("Work arrangement", { exact: true })).toHaveValue("Remote");
  await expect(
    application.getByRole("heading", { name: "Step 1 of 3: Contact and preferences" }),
  ).toBeVisible();
  await expect(application.getByRole("button", { name: "Submit local application" })).toHaveCount(
    0,
  );
  const pages = context.pages().length;
  await panel.reload();
  await panel.getByRole("button", { name: "Jobs", exact: true }).click();
  await preparation.getByRole("button", { name: "Review local preparation", exact: true }).click();
  await expect(preparation.getByText(/First screen prepared and checked/)).toBeVisible();
  expect(context.pages()).toHaveLength(pages);
  await panel.getByRole("button", { name: "Applications", exact: true }).click();
  await expect(panel.getByText("Frontend Engineer", { exact: true }).first()).toBeVisible();
  const tracker = await panel.evaluate(async () => {
    const response: {
      ok: boolean;
      data: { applications: { status: string }[] };
    } = await chrome.runtime.sendMessage({ type: "PANEL_TRACKER_GET" });
    return response;
  });
  expect(tracker.ok).toBe(true);
  expect(tracker.data.applications).toHaveLength(1);
  expect(tracker.data.applications[0]?.status).toBe("APPLYING");
  const ledgerResponse = await fetch("http://127.0.0.1:4174/outcomes", {
    headers: { authorization: `Bearer ${token}` },
  });
  const ledger = (await ledgerResponse.json()) as {
    outcomes: unknown[];
    sessions: { jobId: string; stage: string; attempts: number }[];
  };
  expect(ledger.outcomes).toHaveLength(0);
  expect(ledger.sessions).toHaveLength(1);
  expect(ledger.sessions[0]).toMatchObject({ jobId: "job-7-1", stage: "STARTED", attempts: 0 });
  await panel.getByRole("button", { name: "Jobs", exact: true }).click();
  await preparation.getByRole("button", { name: "Review local preparation", exact: true }).click();
  await preparation.getByRole("button", { name: "Cancel this preparation", exact: true }).click();
  await preparation.getByRole("button", { name: "Forget preparation record", exact: true }).click();
  await expect(preparation.getByRole("button", { name: "Refresh preparation status" })).toHaveCount(
    0,
  );
  await preparation.getByRole("button", { name: "Review local preparation", exact: true }).click();
  await expect(
    preparation.getByLabel("Current city for this application", { exact: true }),
  ).toHaveValue("");
  await expect(
    preparation.getByRole("button", { name: "Prepare local first screen", exact: true }),
  ).toBeDisabled();
  expect(context.pages()).toHaveLength(pages);
});

test("preparation commands reject page-origin callers", async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/portal.html?scenario=portal-01&jobId=job-7-1");
  await page.bringToFront();
  expect(extensionId).toBeTruthy();
  const worker = context.serviceWorkers()[0]!;
  const response = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab!.id! },
      func: async () => {
        const response: unknown = await chrome.runtime.sendMessage({
          type: "PANEL_PREPARATION_REVIEW",
          jobId: "local:job-7-1",
        });
        return response;
      },
    });
    return result?.result;
  });
  expect(response).toMatchObject({ ok: false, error: { code: "BAD_MESSAGE" } });
  await expect(page.locator("[data-application-id]")).toHaveCount(0);
});
