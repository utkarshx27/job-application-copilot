import { readFileSync } from "node:fs";

import { expect, test } from "./fixtures";

type ScanResponse = {
  ok: boolean;
  data?: { fields?: unknown[] };
};

test("loads the MV3 worker and side panel", async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await expect(panel.getByRole("heading", { name: "Job Application Copilot" })).toBeVisible();
  await expect(panel.getByText("Local Only · Observe Mode")).toBeVisible();

  const response: unknown = await panel.evaluate(() =>
    chrome.runtime.sendMessage({ type: "PANEL_PING" }),
  );
  expect(response).toEqual({ ok: true, data: { pong: true } });
});

test("scans the active Test ATS through the complete extension message path", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const application = await context.newPage();
  await application.goto("http://127.0.0.1:4173/");
  await expect(application.getByRole("heading", { name: "Apply for this role" })).toBeVisible();
  await application.bringToFront();

  await panel.getByRole("button", { name: "Scan visible form" }).click();

  await expect(panel.getByText("7")).toBeVisible();
  await expect(panel.getByText("inspectable fields found")).toBeVisible();
  await expect(panel.getByText("First name", { exact: true })).toBeVisible();
  await expect(panel.getByText("Email address", { exact: true })).toBeVisible();
  await expect(panel.getByText("Portfolio URL", { exact: true })).toBeVisible();
  await expect(panel.getByText("ATS account password", { exact: true })).toHaveCount(0);

  await application.bringToFront();
  const response = await panel.evaluate<ScanResponse>(() =>
    chrome.runtime.sendMessage({ type: "PANEL_SCAN_ACTIVE_TAB" }),
  );
  const fixtureUrl = new URL(
    "../../fixtures/ats/generic/v1/test-ats-single-page.json",
    import.meta.url,
  );
  const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as {
    snapshot: { fields: unknown[] };
  };

  expect(response.ok).toBe(true);
  expect(response.data?.fields).toEqual(fixture.snapshot.fields);
});
