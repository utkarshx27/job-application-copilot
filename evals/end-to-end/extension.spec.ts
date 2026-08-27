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
  await expect(panel.getByText("Local only · User controlled")).toBeVisible();

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
  await panel.getByRole("button", { name: "Observe" }).click();

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

test("saves and reloads a versioned profile through chrome.storage.local", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByLabel("Full legal name").fill("Arun");
  await panel.getByLabel("Given name").fill("Arun");
  await panel.getByLabel("Email").fill("arun@example.test");
  await panel.getByLabel(/Skills one per line/).fill("TypeScript\nAccessibility");
  await panel.getByRole("button", { name: "Add work experience" }).click();
  await panel.getByLabel("Employer").fill("Example Labs");
  await panel.getByLabel("Job title").fill("Engineer");
  await panel.getByLabel("Start date").fill("2022-01-01");
  await panel.getByLabel("I currently work here").check();
  await panel.getByRole("button", { name: "Save and verify profile" }).click();

  await expect(panel.getByText("Profile version 2 saved locally.")).toBeVisible();
  await panel.reload();
  await expect(panel.getByLabel("Full legal name")).toHaveValue("Arun");
  await expect(panel.getByLabel("Family name optional")).toHaveValue("");
  await expect(panel.getByLabel("Employer")).toHaveValue("Example Labs");
  await expect(panel.getByText("Profile version 2")).toBeVisible();
});

for (const fileName of ["synthetic-resume.docx", "synthetic-resume.pdf"]) {
  test(`imports and verifies a sanitized ${fileName.split(".").pop()?.toUpperCase()} résumé locally`, async ({
    context,
    extensionId,
  }) => {
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const resumePath = new URL(`../../fixtures/resumes/${fileName}`, import.meta.url);

    await panel.getByLabel("Choose PDF or DOCX").setInputFiles(resumePath.pathname.slice(1));

    await expect(panel.getByText(new RegExp(`Imported ${fileName}`))).toBeVisible({
      timeout: 15_000,
    });
    await expect(panel.getByLabel("Full legal name")).toHaveValue("Priya Sharma");
    await expect(panel.getByLabel("Employer").first()).toHaveValue("Example Labs");
    await expect(panel.getByText(/facts awaiting your verification/)).toBeVisible();
    await panel.getByRole("button", { name: "Verify imported facts" }).click();
    await expect(
      panel.getByText("Résumé facts verified by you and saved as a new profile version."),
    ).toBeVisible();
    await expect(panel.getByText("Profile version 3")).toBeVisible();
  });
}

test("rejects malformed JSON without replacing the local profile", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByLabel("Import JSON").setInputFiles({
    name: "malformed.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"backupVersion":999}'),
  });

  await expect(panel.getByRole("alert")).toContainText("malformed or uses an unsupported version");
  await expect(panel.getByText("Profile version 1")).toBeVisible();
});
