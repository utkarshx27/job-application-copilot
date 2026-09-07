import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

type ScanResponse = {
  ok: boolean;
  data?: { fields?: unknown[] };
};

async function saveFillProfile(panel: Page, includeSponsorship = false) {
  await panel.getByLabel("Full legal name").fill("Priya Sharma");
  await panel.getByLabel("Given name").fill("Priya");
  await panel.getByLabel("Family name optional").fill("Sharma");
  await panel.getByLabel("Email").fill("priya@example.test");
  await panel.getByLabel(/Phone E.164/).fill("+919876543210");
  await panel.getByLabel("Portfolio URL").fill("https://priya.example.test");
  await panel.getByLabel("LinkedIn URL").fill("https://linkedin.com/in/priya-example");
  await panel.getByRole("button", { name: "Add work experience" }).click();
  await panel.getByLabel("Employer").fill("Example Labs");
  await panel.getByLabel("Job title").fill("Software Engineer");
  await panel.getByLabel("Start date").fill("2022-01-01");
  await panel.getByLabel("I currently work here").check();
  if (includeSponsorship) {
    await panel.getByRole("button", { name: "Add work authorization" }).click();
    await panel.getByLabel("Sponsorship required now").selectOption("YES");
  }
  await panel.getByRole("button", { name: "Save and verify profile" }).click();
  await expect(panel.getByText("Profile version 2 saved locally.")).toBeVisible();
}

test("loads the MV3 worker and side panel", async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole("button", { name: "Edit full profile", exact: true }).click();

  await expect(panel.getByRole("heading", { name: "Job Application Copilot" })).toBeVisible();
  await expect(panel.getByText("Local first · User controlled")).toBeVisible();

  const response: unknown = await panel.evaluate(() =>
    chrome.runtime.sendMessage({ type: "PANEL_PING" }),
  );
  expect(response).toEqual({ ok: true, data: { pong: true } });
});

test("opts into encrypted sync, backs up ciphertext, and locks the session", async ({
  context,
  extensionId,
}, testInfo) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole("button", { name: "Edit full profile", exact: true }).click();
  await saveFillProfile(panel);
  await panel.getByRole("button", { name: "Sync", exact: true }).click();

  await expect(panel.getByRole("heading", { name: "Optional encrypted sync" })).toBeVisible();
  const email = `phase10-${Date.now()}@example.test`;
  await panel.getByLabel("Email").fill(email);
  await panel.getByLabel("Sync passphrase").fill("correct horse battery staple");
  await panel.getByLabel("Device name").fill("Phase 10 Chromium");
  await panel.getByRole("button", { name: "Enable encrypted sync" }).click();

  await expect(panel.getByRole("heading", { name: "Encrypted sync", exact: true })).toBeVisible();
  await expect(panel.getByText("Encrypted sync is enabled")).toBeVisible();
  await expect(panel.getByText("Phase 10 Chromium")).toBeVisible();
  await expect(panel.getByText("This device")).toBeVisible();

  const response: unknown = await panel.evaluate(() =>
    chrome.runtime.sendMessage({ type: "PANEL_SYNC_EXPORT_BACKUP" }),
  );
  expect(response).toMatchObject({ ok: true, data: { encrypted: true } });
  const backupJson = (response as { data: { backupJson: string } }).data.backupJson;
  expect(backupJson).toContain("AES-256-GCM");
  expect(backupJson).not.toContain("Priya Sharma");
  expect(backupJson).not.toContain("priya@example.test");

  await panel.screenshot({
    path: testInfo.outputPath("phase10-encrypted-sync.png"),
    fullPage: true,
  });
  await panel.getByRole("button", { name: "Lock sync session" }).click();
  await expect(panel.getByText("Sync is locked for this browser session.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Sign in & restore" })).toBeVisible();
});

test("scans the active Test ATS through the complete extension message path", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole("button", { name: "Edit full profile", exact: true }).click();
  await panel.getByRole("button", { name: "Observe" }).click();

  const application = await context.newPage();
  await application.goto("http://127.0.0.1:4173/");
  await expect(application.getByRole("heading", { name: "Apply for this role" })).toBeVisible();
  await application.bringToFront();

  await panel.getByRole("button", { name: "Scan and match visible form" }).click();

  await expect(panel.getByText("10", { exact: true })).toBeVisible();
  await expect(panel.getByText(/inspectable fields/)).toBeVisible();
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
  const liveFields = new Map(
    response.data?.fields?.map((field) => [
      (field as { fieldId: string }).fieldId,
      field as Record<string, unknown>,
    ]),
  );
  for (const expectedField of fixture.snapshot.fields as Array<Record<string, unknown>>) {
    expect(liveFields.get(expectedField.fieldId as string)).toMatchObject(expectedField);
  }
});

test("highlights, fills, reveals dynamic fields, and protects user edits", async ({
  context,
  extensionId,
}, testInfo) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole("button", { name: "Edit full profile", exact: true }).click();
  await saveFillProfile(panel, true);

  const application = await context.newPage();
  await application.goto("http://127.0.0.1:4173/");
  await application.bringToFront();
  await panel.getByRole("button", { name: "Observe" }).click();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();

  await expect(panel.getByText("6 approved for review")).toBeVisible();
  await panel.getByRole("button", { name: "Highlight selected" }).click();
  await expect(panel.getByText("Highlighted 6 reviewed fields.")).toBeVisible();
  await expect(application.getByLabel("First name")).toHaveAttribute(
    "data-job-copilot-highlight",
    "true",
  );

  await panel.getByRole("button", { name: "Fill selected fields" }).click();
  await expect(panel.getByText("Filled 6 reviewed fields.")).toBeVisible();
  await expect(application.getByLabel("First name")).toHaveValue("Priya");
  await expect(application.getByLabel("Last name")).toHaveValue("Sharma");
  await expect(application.getByLabel("Email address")).toHaveValue("priya@example.test");
  await expect(application.getByLabel("Mobile phone")).toHaveValue("+919876543210");
  await expect(application.getByLabel("Portfolio URL")).toHaveValue("https://priya.example.test");
  await expect(application.getByLabel("Yes")).toBeChecked();
  await expect(application.getByLabel("Current visa type")).toBeVisible();
  await application.screenshot({
    path: testInfo.outputPath("phase2-reviewed-fill.png"),
    fullPage: true,
  });

  await application.getByLabel("Email address").fill("user-edited@example.test");
  await application.bringToFront();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();
  await expect(panel.getByText("User edited")).toBeVisible();
  await expect(panel.getByLabel("Select Email address")).toBeDisabled();
});

test("updates real React and Vue controlled state with reviewed fills", async ({
  context,
  extensionId,
}, testInfo) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole("button", { name: "Edit full profile", exact: true }).click();
  await saveFillProfile(panel);

  const frameworks = await context.newPage();
  await frameworks.goto("http://127.0.0.1:4173/frameworks.html");
  await expect(
    frameworks.getByRole("heading", { name: "React application fixture" }),
  ).toBeVisible();
  await expect(frameworks.getByRole("heading", { name: "Vue application fixture" })).toBeVisible();
  await frameworks.bringToFront();
  await panel.getByRole("button", { name: "Observe" }).click();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();
  await expect(panel.getByText("2 approved for review")).toBeVisible();
  await panel.getByRole("button", { name: "Fill selected fields" }).click();

  await expect(frameworks.getByLabel("Email address")).toHaveValue("priya@example.test");
  await expect(frameworks.locator("#react-state")).toHaveText("React email: priya@example.test");
  await expect(frameworks.getByLabel("Mobile phone")).toHaveValue("+919876543210");
  await expect(frameworks.locator("#vue-state")).toHaveText("Vue phone: +919876543210");
  await frameworks.screenshot({
    path: testInfo.outputPath("phase2-framework-fill.png"),
    fullPage: true,
  });
});

test("detects Greenhouse, fills reviewed answers, uploads one approved résumé, and tracks confirmation", async ({
  context,
  extensionId,
}, testInfo) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole("button", { name: "Edit full profile", exact: true }).click();
  await saveFillProfile(panel);

  const application = await context.newPage();
  await application.goto("http://127.0.0.1:4173/greenhouse.html");
  await application.bringToFront();
  await panel.getByRole("button", { name: "Observe" }).click();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();

  await expect(panel.getByText("GREENHOUSE", { exact: true })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Platform Engineer" })).toBeVisible();
  await expect(panel.getByText(/ExampleCo · Bengaluru/)).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Custom question review" })).toBeVisible();

  await panel.getByRole("button", { name: "Fill selected fields" }).click();
  await expect(application.getByLabel("First name")).toHaveValue("Priya");
  await expect(application.getByLabel("Last name")).toHaveValue("Sharma");
  await expect(application.getByLabel("Email")).toHaveValue("priya@example.test");
  await expect(application.getByLabel("Phone")).toHaveValue("+919876543210");
  await expect(application.getByLabel("LinkedIn profile")).toHaveValue(
    "https://linkedin.com/in/priya-example",
  );
  await expect(application.getByLabel("Current employer")).toHaveValue("Example Labs");
  await expect(application.getByLabel("Current job title")).toHaveValue("Software Engineer");

  await panel
    .getByRole("combobox", { name: /How did you hear about us/ })
    .selectOption("career-page");
  await panel
    .getByRole("textbox", { name: /Why are you interested in ExampleCo/ })
    .fill("The reliability mission fits my verified experience.");
  await panel.getByRole("button", { name: "Fill reviewed custom answers" }).click();
  await expect(application.getByLabel("How did you hear about us?")).toHaveValue("career-page");
  await expect(application.getByLabel("Why are you interested in ExampleCo?")).toHaveValue(
    "The reliability mission fits my verified experience.",
  );

  const resumePath = fileURLToPath(
    new URL("../../fixtures/resumes/synthetic-resume.pdf", import.meta.url),
  );
  await panel.getByLabel("Choose résumé for this application").setInputFiles(resumePath);
  await expect(panel.getByText("synthetic-resume.pdf", { exact: true })).toBeVisible();
  await expect(application.locator("#gh-resume-output")).toHaveText("No résumé selected");
  await panel.getByRole("button", { name: "Upload this approved résumé" }).click();
  await expect(
    panel.getByText(/Uploaded only the approved file synthetic-resume.pdf/),
  ).toBeVisible();
  await expect(application.locator("#gh-resume-output")).toHaveText("synthetic-resume.pdf");
  await panel.screenshot({
    path: testInfo.outputPath("phase3-greenhouse-panel.png"),
    fullPage: true,
  });
  await application.screenshot({
    path: testInfo.outputPath("phase3-greenhouse-reviewed.png"),
    fullPage: true,
  });

  await application.goto("http://127.0.0.1:4173/greenhouse-confirmation.html");
  await application.bringToFront();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();
  await expect(panel.getByText(/local tracker was updated to APPLIED/)).toBeVisible();
  await expect(panel.getByText(/GH-CONF-100/)).toBeVisible();
  await panel.getByRole("button", { name: "Applications" }).click();
  await expect(
    panel.getByRole("combobox", { name: "Status for Platform Engineer at ExampleCo" }),
  ).toHaveValue("APPLIED");
  await expect(panel.getByText("Résumé: synthetic-resume.pdf")).toBeVisible();
  await panel.screenshot({
    path: testInfo.outputPath("phase3-tracker-confirmed.png"),
    fullPage: true,
  });
});

test("warns about duplicates and manages the local tracker board, table, and CSV", async ({
  context,
  extensionId,
}, testInfo) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole("button", { name: "Edit full profile", exact: true }).click();
  const application = await context.newPage();
  await application.goto("http://127.0.0.1:4173/greenhouse.html");
  await application.bringToFront();
  await panel.getByRole("button", { name: "Observe" }).click();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();
  await expect(
    panel.getByRole("heading", { name: "Possible duplicate application" }),
  ).toBeVisible();
  await expect(panel.getByText(/already tracked as applying/)).toBeVisible();

  await panel.getByRole("button", { name: "Applications" }).click();
  await expect(panel.getByRole("heading", { name: "Application tracker" })).toBeVisible();
  await expect(panel.getByText("Platform Engineer", { exact: true })).toBeVisible();
  await expect(panel.getByText("1 snapshot", { exact: false })).toBeVisible();
  await panel
    .getByRole("combobox", { name: "Status for Platform Engineer at ExampleCo" })
    .selectOption("INTERVIEW");
  await expect(panel.getByText("Application status updated locally.")).toBeVisible();

  await panel.getByRole("button", { name: "Table" }).click();
  await expect(panel.getByRole("columnheader", { name: "Job" })).toBeVisible();
  await panel.screenshot({
    path: testInfo.outputPath("phase8-tracker-table.png"),
    fullPage: true,
  });

  const downloadPromise = panel.waitForEvent("download");
  await panel.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^job-application-tracker-.*\.csv$/);

  const importCsv = [
    "application_id,canonical_job_id,company,title,location,ats,status,source_url,application_url,external_requisition_id,discovered_at,applied_at,updated_at",
    '"application:imported","job:00000000","Import Co","QA Engineer","Remote","LEVER","SAVED","http://127.0.0.1:4173/lever.html","http://127.0.0.1:4173/lever.html","IMP-1","2026-08-31T08:00:00.000Z","","2026-08-31T08:00:00.000Z"',
  ].join("\r\n");
  await panel.getByLabel("Import CSV").setInputFiles({
    name: "tracker.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(importCsv),
  });
  await expect(panel.getByText(/Imported 1, updated 0, skipped 0/)).toBeVisible();
  await expect(panel.getByText("QA Engineer", { exact: true })).toBeVisible();
});

test("teaches a company-scoped custom answer once and suggests it for review", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole("button", { name: "Edit full profile", exact: true }).click();
  const application = await context.newPage();
  await application.goto("http://127.0.0.1:4173/greenhouse.html");
  await application.bringToFront();
  await panel.getByRole("button", { name: "Observe" }).click();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();

  const question = panel.locator(".custom-question").filter({
    hasText: "Why are you interested in ExampleCo?",
  });
  const answer = "The reliability mission matches my verified experience.";
  await question.getByRole("textbox", { name: /Why are you interested/ }).fill(answer);
  await question.getByLabel("Save this answer for future applications?").selectOption("COMPANY");
  await panel.getByRole("button", { name: "Fill reviewed custom answers" }).click();
  await expect(application.getByLabel("Why are you interested in ExampleCo?")).toHaveValue(answer);

  await application.reload();
  await application.bringToFront();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();
  const rescanned = panel.locator(".custom-question").filter({
    hasText: "Why are you interested in ExampleCo?",
  });
  await expect(rescanned.getByText("Saved response suggested")).toBeVisible();
  await expect(rescanned.getByRole("textbox", { name: /Why are you interested/ })).toHaveValue(
    answer,
  );
  await expect(application.getByLabel("Why are you interested in ExampleCo?")).toHaveValue("");
});

test("keeps a grounded AI draft off the page until both review actions", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto("chrome-extension://" + extensionId + "/sidepanel.html");
  await panel.getByRole("button", { name: "Edit full profile", exact: true }).click();
  await saveFillProfile(panel);
  const configured: unknown = await panel.evaluate(() =>
    chrome.runtime.sendMessage({
      type: "PANEL_AI_CONFIG_SET",
      config: { provider: "FIXTURE", model: "deterministic-fixture-v1" },
    }),
  );
  expect(configured).toMatchObject({
    ok: true,
    data: { configured: true, provider: "FIXTURE" },
  });

  const application = await context.newPage();
  await application.goto("http://127.0.0.1:4173/greenhouse.html");
  await application.bringToFront();
  await panel.getByRole("button", { name: "Observe" }).click();
  await expect(panel.getByText("Test provider")).toBeVisible();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();

  const question = panel.locator(".custom-question").filter({
    hasText: "Why are you interested in ExampleCo?",
  });
  const applicationAnswer = application.getByLabel("Why are you interested in ExampleCo?");
  await expect(applicationAnswer).toHaveValue("");
  await question.getByRole("button", { name: "Draft with grounded AI" }).click();
  await expect(question.getByText("Grounded AI draft — review required")).toBeVisible();
  await expect(question.getByText(/Evidence: candidate:/)).toBeVisible();
  await expect(applicationAnswer).toHaveValue("");

  await question.getByRole("button", { name: "Use this draft in review" }).click();
  const reviewedAnswer = await question
    .getByRole("textbox", { name: /Why are you interested/ })
    .inputValue();
  expect(reviewedAnswer).toContain("My experience includes");
  await expect(applicationAnswer).toHaveValue("");

  await panel.getByRole("button", { name: "Fill reviewed custom answers" }).click();
  await expect(applicationAnswer).toHaveValue(reviewedAnswer);
});

test("detects and fills a sanitized Lever application", async ({
  context,
  extensionId,
}, testInfo) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole("button", { name: "Edit full profile", exact: true }).click();
  await saveFillProfile(panel);

  const application = await context.newPage();
  await application.goto("http://127.0.0.1:4173/lever.html");
  await application.bringToFront();
  await panel.getByRole("button", { name: "Observe" }).click();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();

  await expect(panel.getByText("LEVER", { exact: true })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Frontend Engineer" })).toBeVisible();
  await panel.getByRole("button", { name: "Fill selected fields" }).click();
  await expect(application.getByLabel("Full name")).toHaveValue("Priya Sharma");
  await expect(application.getByLabel("Email")).toHaveValue("priya@example.test");
  await expect(application.getByLabel("Phone")).toHaveValue("+919876543210");
  await expect(application.getByLabel("LinkedIn URL")).toHaveValue(
    "https://linkedin.com/in/priya-example",
  );
  await expect(application.getByLabel("Current company")).toHaveValue("Example Labs");

  await panel
    .getByRole("textbox", { name: /What interests you about this role/ })
    .fill("The accessibility focus matches my goals.");
  await panel.getByRole("button", { name: "Fill reviewed custom answers" }).click();
  await expect(application.getByLabel("What interests you about this role?")).toHaveValue(
    "The accessibility focus matches my goals.",
  );
  const resumePath = fileURLToPath(
    new URL("../../fixtures/resumes/synthetic-resume.docx", import.meta.url),
  );
  await panel.getByLabel("Choose résumé for this application").setInputFiles(resumePath);
  await expect(application.locator("#lever-resume-output")).toHaveText("No résumé selected");
  await panel.getByRole("button", { name: "Upload this approved résumé" }).click();
  await expect(application.locator("#lever-resume-output")).toHaveText("synthetic-resume.docx");
  await panel.screenshot({
    path: testInfo.outputPath("phase3-lever-panel.png"),
    fullPage: true,
  });
  await application.screenshot({
    path: testInfo.outputPath("phase3-lever-reviewed.png"),
    fullPage: true,
  });
});

test("detects Ashby, keeps custom components manual, rescans dynamics, and tracks confirmation", async ({
  context,
  extensionId,
}, testInfo) => {
  const panel = await context.newPage();
  await panel.goto("chrome-extension://" + extensionId + "/sidepanel.html");
  await panel.getByRole("button", { name: "Edit full profile", exact: true }).click();
  await saveFillProfile(panel);

  const application = await context.newPage();
  await application.goto("http://127.0.0.1:4173/ashby.html");
  await application.bringToFront();
  await panel.getByRole("button", { name: "Observe" }).click();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();

  await expect(panel.getByText("ASHBY", { exact: true })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Infrastructure Engineer" })).toBeVisible();
  const officeReview = panel.locator(".custom-question").filter({ hasText: "Preferred office" });
  await expect(officeReview.getByText(/requires manual completion/)).toBeVisible();
  await expect(officeReview.getByText(/Complete this control manually/)).toBeVisible();

  await panel.getByRole("button", { name: "Fill selected fields" }).click();
  await expect(application.getByLabel("Full name")).toHaveValue("Priya Sharma");
  await expect(application.getByLabel("Email")).toHaveValue("priya@example.test");
  await expect(application.getByLabel("Phone")).toHaveValue("+919876543210");
  await expect(application.getByLabel("LinkedIn URL")).toHaveValue(
    "https://linkedin.com/in/priya-example",
  );
  await expect(application.getByLabel("Current company")).toHaveValue("Example Labs");
  await expect(application.getByLabel("Current job title")).toHaveValue("Software Engineer");
  await expect(application.locator("#ashby-office")).toHaveValue("");

  const beforeDynamicCount = await panel.locator(".mapping-fields > li").count();
  await application.getByLabel("Preferred workplace type").selectOption("remote");
  await expect(application.getByLabel("Why is this arrangement important to you?")).toBeVisible();
  await application.bringToFront();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();
  await expect(
    panel.getByRole("textbox", { name: /Why is this arrangement important/ }),
  ).toBeVisible();
  expect(await panel.locator(".mapping-fields > li").count()).toBeGreaterThan(beforeDynamicCount);

  const answer = "Remote work supports focused collaboration across distributed teams.";
  await panel.getByRole("textbox", { name: /Why is this arrangement important/ }).fill(answer);
  await panel.getByRole("button", { name: "Fill reviewed custom answers" }).click();
  await expect(application.getByLabel("Why is this arrangement important to you?")).toHaveValue(
    answer,
  );

  const resumePath = fileURLToPath(
    new URL("../../fixtures/resumes/synthetic-resume.pdf", import.meta.url),
  );
  await panel.getByLabel("Choose résumé for this application").setInputFiles(resumePath);
  await panel.getByRole("button", { name: "Upload this approved résumé" }).click();
  await expect(application.locator("#ashby-resume-output")).toHaveText("synthetic-resume.pdf");

  await application.screenshot({
    path: testInfo.outputPath("phase6-ashby-reviewed.png"),
    fullPage: true,
  });
  await application.goto("http://127.0.0.1:4173/ashby-confirmation.html");
  await application.bringToFront();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();
  await expect(panel.getByText(/local tracker was updated to APPLIED/)).toBeVisible();
  await expect(panel.getByText(/ASH-CONF-300/)).toBeVisible();
});

test("detects SmartRecruiters, fills safe fields, rescans screening dynamics, and uploads", async ({
  context,
  extensionId,
}, testInfo) => {
  const panel = await context.newPage();
  await panel.goto("chrome-extension://" + extensionId + "/sidepanel.html");
  await panel.getByRole("button", { name: "Edit full profile", exact: true }).click();
  await saveFillProfile(panel);

  const application = await context.newPage();
  await application.goto("http://127.0.0.1:4173/smartrecruiters.html");
  await application.bringToFront();
  await panel.getByRole("button", { name: "Observe" }).click();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();

  await expect(panel.getByText("SMARTRECRUITERS", { exact: true })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Frontend Engineer" })).toBeVisible();
  const communityReview = panel
    .locator(".custom-question")
    .filter({ hasText: "Join the talent community" });
  await expect(communityReview.getByText(/requires manual completion/)).toBeVisible();

  await panel.getByRole("button", { name: "Fill selected fields" }).click();
  await expect(application.getByLabel("First name")).toHaveValue("Priya");
  await expect(application.getByLabel("Last name")).toHaveValue("Sharma");
  await expect(application.getByLabel("Email")).toHaveValue("priya@example.test");
  await expect(application.getByLabel("Phone")).toHaveValue("+919876543210");
  await expect(application.getByLabel("Current company")).toHaveValue("Example Labs");
  await expect(application.getByLabel("Current job title")).toHaveValue("Software Engineer");

  const beforeDynamicCount = await panel.locator(".mapping-fields > li").count();
  await application.getByLabel("Do you have professional frontend experience?").selectOption("yes");
  await expect(application.getByLabel("Summarize the relevant experience")).toBeVisible();
  await application.bringToFront();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();
  await expect(
    panel.getByRole("textbox", { name: "Summarize the relevant experience" }),
  ).toBeVisible();
  expect(await panel.locator(".mapping-fields > li").count()).toBeGreaterThan(beforeDynamicCount);
  const summary = "Built accessible interfaces for local-first applications.";
  await panel.getByRole("textbox", { name: "Summarize the relevant experience" }).fill(summary);
  await panel.getByRole("button", { name: "Fill reviewed custom answers" }).click();
  await expect(application.getByLabel("Summarize the relevant experience")).toHaveValue(summary);

  const resumePath = fileURLToPath(
    new URL("../../fixtures/resumes/synthetic-resume.docx", import.meta.url),
  );
  await panel.getByLabel("Choose résumé for this application").setInputFiles(resumePath);
  await panel.getByRole("button", { name: "Upload this approved résumé" }).click();
  await expect(application.locator("#sr-resume-output")).toHaveText("synthetic-resume.docx");
  await application.screenshot({
    path: testInfo.outputPath("phase6-smartrecruiters-reviewed.png"),
    fullPage: true,
  });

  await application.goto("http://127.0.0.1:4173/smartrecruiters-confirmation.html");
  await application.bringToFront();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();
  await expect(panel.getByText(/local tracker was updated to APPLIED/)).toBeVisible();
  await expect(panel.getByText(/SR-CONF-400/)).toBeVisible();
});

for (const fixture of [
  { slug: "icims", adapter: "ICIMS", title: "Backend Engineer" },
  { slug: "taleo", adapter: "TALEO", title: "Systems Engineer" },
  { slug: "workable", adapter: "WORKABLE", title: "Product Engineer" },
  { slug: "bamboohr", adapter: "BAMBOOHR", title: "QA Engineer" },
  { slug: "jobvite", adapter: "JOBVITE", title: "Frontend Engineer" },
  { slug: "comeet", adapter: "COMEET", title: "Platform Engineer" },
]) {
  test(`detects and safely fills the controlled ${fixture.adapter} application`, async ({
    context,
    extensionId,
  }, testInfo) => {
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.getByRole("button", { name: "Edit full profile", exact: true }).click();
    await saveFillProfile(panel);
    const application = await context.newPage();
    await application.goto(`http://127.0.0.1:4173/${fixture.slug}.html`);
    await application.bringToFront();
    await panel.getByRole("button", { name: "Observe" }).click();
    await panel.getByRole("button", { name: "Scan and match visible form" }).click();

    await expect(panel.getByText(fixture.adapter, { exact: true })).toBeVisible();
    await expect(panel.getByRole("heading", { name: fixture.title })).toBeVisible();
    const customWidget = panel.locator(".custom-question").filter({ hasText: "Preferred team" });
    await expect(customWidget.getByText(/requires manual completion/)).toBeVisible();
    await panel.getByRole("button", { name: "Fill selected fields" }).click();
    await expect(application.getByLabel("First name")).toHaveValue("Priya");
    await expect(application.getByLabel("Last name")).toHaveValue("Sharma");
    await expect(application.getByLabel("Email")).toHaveValue("priya@example.test");
    await expect(application.getByLabel("Phone")).toHaveValue("+919876543210");
    await expect(application.getByLabel("LinkedIn URL")).toHaveValue(
      "https://linkedin.com/in/priya-example",
    );
    await expect(application.getByLabel("Preferred team")).toHaveValue("");

    const resumePath = fileURLToPath(
      new URL("../../fixtures/resumes/synthetic-resume.pdf", import.meta.url),
    );
    await panel.getByLabel("Choose résumé for this application").setInputFiles(resumePath);
    await panel.getByRole("button", { name: "Upload this approved résumé" }).click();
    await expect(application.locator(`#${fixture.slug}-resume-output`)).toHaveText(
      "synthetic-resume.pdf",
    );
    await panel.screenshot({
      path: testInfo.outputPath(`phase9-${fixture.slug}-panel.png`),
      fullPage: true,
    });
  });
}

test("models Workday steps, protects parsed values, and keeps real navigation user-controlled", async ({
  context,
  extensionId,
}, testInfo) => {
  const panel = await context.newPage();
  await panel.goto("chrome-extension://" + extensionId + "/sidepanel.html");
  await panel.getByRole("button", { name: "Edit full profile", exact: true }).click();
  await saveFillProfile(panel);

  const application = await context.newPage();
  await application.goto("http://127.0.0.1:4173/workday.html");
  await application.bringToFront();
  await panel.getByRole("button", { name: "Observe" }).click();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();

  await expect(panel.getByText("WORKDAY", { exact: true })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Workday application progress" })).toBeVisible();
  await expect(panel.getByText("MY INFORMATION", { exact: true })).toBeVisible();
  await expect(panel.getByText(/Step 1 of 4/)).toBeVisible();
  await expect(panel.getByText(/off by default.*never clicks Submit/)).toBeVisible();
  await expect(panel.getByText(/Next available/)).toBeVisible();
  await expect(panel.getByLabel("Select Email Address")).toBeDisabled();
  await expect(panel.getByText("Pre-filled · review manually", { exact: true })).toBeVisible();

  await panel.getByRole("button", { name: "Fill selected fields" }).click();
  await expect(application.getByLabel("First Name")).toHaveValue("Priya");
  await expect(application.getByLabel("Last Name")).toHaveValue("Sharma");
  await expect(application.getByLabel("Phone Number")).toHaveValue("+919876543210");
  await expect(application.getByLabel("Email Address")).toHaveValue("parsed@example.test");
  await expect(application.getByRole("heading", { name: "My Information" })).toBeVisible();

  const resumePath = fileURLToPath(
    new URL("../../fixtures/resumes/synthetic-resume.pdf", import.meta.url),
  );
  await panel.getByLabel("Choose résumé for this application").setInputFiles(resumePath);
  await panel.getByRole("button", { name: "Upload this approved résumé" }).click();
  await expect(application.locator("#wd-resume-output")).toHaveText("synthetic-resume.pdf");

  await application.getByRole("button", { name: "Next" }).click();
  await expect(application.getByRole("heading", { name: "My Experience" })).toBeVisible();
  await application.bringToFront();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();
  await expect(panel.getByText("MY EXPERIENCE", { exact: true })).toBeVisible();
  await expect(panel.getByText(/Step 2 of 4/)).toBeVisible();
  await expect(panel.getByText("Progress recovered from local storage")).toBeVisible();
  await expect(panel.getByText("Review résumé-parsed values")).toBeVisible();
  await expect(panel.getByLabel("Select Company")).toBeDisabled();

  await panel.getByRole("button", { name: "Fill selected fields" }).click();
  await expect(application.getByLabel("Company")).toHaveValue("Parsed Resume Company");
  await expect(application.getByLabel("Job Title")).toHaveValue("Software Engineer");
  const skillsReview = panel
    .locator(".custom-question")
    .filter({ has: panel.getByText("Skills", { exact: true }) });
  await expect(skillsReview.getByText(/requires manual completion/)).toBeVisible();

  await application.reload();
  await expect(application.getByRole("heading", { name: "My Experience" })).toBeVisible();
  await application.bringToFront();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();
  await expect(panel.getByText("Progress recovered from local storage")).toBeVisible();
  await expect(panel.getByText(/across 3 scans/)).toBeVisible();
  await application.getByLabel("Job Title").fill("Software Engineer");

  await application.getByRole("button", { name: "Next" }).click();
  await expect(application.getByRole("heading", { name: "Application Questions" })).toBeVisible();
  await application.getByLabel("Have you supported production systems?").selectOption("yes");
  await expect(application.getByLabel("Describe a relevant project")).toBeVisible();
  await application.bringToFront();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();
  const answer = "Built resilient systems for distributed engineering teams.";
  await application.getByLabel("Describe a relevant project").fill(answer);
  await expect(application.getByLabel("Describe a relevant project")).toHaveValue(answer);

  await application.getByRole("button", { name: "Next" }).click();
  await application.bringToFront();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();
  await expect(panel.getByText("REVIEW", { exact: true })).toBeVisible();
  await expect(panel.getByText(/Submit available/)).toBeVisible();
  await expect(
    panel.getByRole("heading", { name: "Controlled Test ATS submission" }),
  ).toBeVisible();

  await application.goto("http://127.0.0.1:4173/workday-auth.html");
  await application.bringToFront();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();
  await expect(panel.getByText("AUTH", { exact: true })).toBeVisible();
  await expect(panel.getByText("Manual authentication boundary")).toBeVisible();
  await expect(
    panel.getByText(/Complete the Workday account or authentication step manually/),
  ).toBeVisible();
  await expect(panel.getByText("Password", { exact: true })).toHaveCount(0);

  await application.goto("http://127.0.0.1:4173/workday-confirmation.html");
  await application.bringToFront();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();
  await expect(panel.getByText(/local tracker was updated to APPLIED/)).toBeVisible();
  await expect(panel.getByText(/WD-CONF-700/)).toBeVisible();
  await panel.screenshot({
    path: testInfo.outputPath("phase7-workday-progress.png"),
    fullPage: true,
  });
});

test("runs one cancelable controlled Next and never retries the same intent", async ({
  context,
  extensionId,
}, testInfo) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole("button", { name: "Edit full profile", exact: true }).click();
  await saveFillProfile(panel);

  const application = await context.newPage();
  await application.goto("http://127.0.0.1:4173/workday.html");
  await application.bringToFront();
  await panel.getByRole("button", { name: "Observe" }).click();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();

  await expect(panel.getByRole("heading", { name: "Experimental controlled Next" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Prepare controlled Next" })).toBeDisabled();
  await panel.getByRole("button", { name: "Fill selected fields" }).click();
  await application.bringToFront();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();

  await panel.getByLabel("Enable experimental auto-next globally").check();
  await panel.getByLabel("Enable for this application").check();
  await expect(panel.getByText("Ready", { exact: true })).toBeVisible();

  await panel.getByRole("button", { name: "Prepare controlled Next" }).click();
  await expect(panel.getByText(/Next in 3 seconds/)).toBeVisible();
  await panel.getByRole("button", { name: "Cancel controlled Next" }).click();
  await expect(panel.getByText("Controlled Next was canceled before click.")).toBeVisible();
  await expect(application.getByRole("heading", { name: "My Information" })).toBeVisible();
  await expect
    .poll(() =>
      application.evaluate(() =>
        Number(document.documentElement.getAttribute("data-controlled-next-click-count")),
      ),
    )
    .toBe(0);

  await panel.getByRole("button", { name: "Prepare controlled Next" }).click();
  await application.getByLabel("Last Name").fill("Sharma edited");
  await expect(panel.getByText(/page changed after navigation approval/i)).toBeVisible({
    timeout: 7_000,
  });
  await expect
    .poll(() =>
      application.evaluate(() =>
        Number(document.documentElement.getAttribute("data-controlled-next-click-count")),
      ),
    )
    .toBe(0);
  await application.bringToFront();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();

  await panel.getByRole("button", { name: "Prepare controlled Next" }).click();
  await expect(application.getByRole("heading", { name: "My Experience" })).toBeVisible({
    timeout: 7_000,
  });
  await expect(panel.getByText(/new Workday step was verified/)).toBeVisible();
  await expect
    .poll(() =>
      application.evaluate(() =>
        Number(document.documentElement.getAttribute("data-controlled-next-click-count")),
      ),
    )
    .toBe(1);

  const replayResponse = await panel.evaluate<unknown>(async () => {
    const stored: unknown = await chrome.storage.local.get("controlledAutoNext");
    const intents = (stored as { controlledAutoNext: { intents: Array<{ id: string }> } })
      .controlledAutoNext.intents;
    const latest = intents[intents.length - 1];
    if (!latest) throw new Error("Expected a persisted navigation intent.");
    const response: unknown = await chrome.runtime.sendMessage({
      type: "PANEL_AUTO_NEXT_EXECUTE",
      intentId: latest.id,
    });
    return response;
  });
  expect(replayResponse).toMatchObject({ ok: false, error: { code: "NAVIGATION_FAILED" } });
  await expect
    .poll(() =>
      application.evaluate(() =>
        Number(document.documentElement.getAttribute("data-controlled-next-click-count")),
      ),
    )
    .toBe(1);

  await panel.screenshot({
    path: testInfo.outputPath("phase11-controlled-next.png"),
    fullPage: true,
  });
});

test("requires final consent, submits the Test ATS once, and verifies confirmation", async ({
  context,
  extensionId,
}, testInfo) => {
  testInfo.setTimeout(45_000);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole("button", { name: "Edit full profile", exact: true }).click();
  await saveFillProfile(panel);

  const application = await context.newPage();
  await application.goto("http://127.0.0.1:4173/workday.html");
  await application.bringToFront();
  await panel.getByRole("button", { name: "Observe" }).click();

  await panel.getByRole("button", { name: "Scan and match visible form" }).click();
  await panel.getByRole("button", { name: "Fill selected fields" }).click();
  await application.getByRole("button", { name: "Next" }).click();

  await application.bringToFront();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();
  await panel.getByRole("button", { name: "Fill selected fields" }).click();
  await application.getByRole("button", { name: "Next" }).click();

  await expect(application.getByRole("heading", { name: "Application Questions" })).toBeVisible();
  await application.getByLabel("Have you supported production systems?").selectOption("yes");
  await application.getByLabel("Describe a relevant project").fill("Built resilient systems.");
  await application.bringToFront();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();
  await application.getByRole("button", { name: "Next" }).click();

  await expect(application.getByRole("heading", { name: "Review", exact: true })).toBeVisible();
  await application.bringToFront();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();
  await expect(
    panel.getByRole("heading", { name: "Controlled Test ATS submission" }),
  ).toBeVisible();
  await expect(panel.getByText("Workflow: 4/4 steps observed")).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Prepare one Test ATS submission" }),
  ).toBeDisabled();

  await panel.getByLabel("Enable controlled Test ATS submission globally").check();
  await panel.getByLabel("Enable submission for this application").check();
  await application
    .getByLabel("I reviewed the application and confirm the Test ATS information is accurate")
    .check();
  await application.bringToFront();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();
  await expect(panel.getByText("Ready", { exact: true })).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Prepare one Test ATS submission" }),
  ).toBeDisabled();

  await panel
    .getByLabel(
      "I reviewed the final summary and authorize exactly one submission to the local Test ATS.",
    )
    .check();
  await panel.getByRole("button", { name: "Prepare one Test ATS submission" }).click();
  await expect(panel.getByText(/Test submission in 5 seconds/)).toBeVisible();
  await panel.getByRole("button", { name: "Cancel Test ATS submission" }).click();
  await expect(panel.getByText("Test ATS submission was canceled before dispatch.")).toBeVisible();
  await expect
    .poll(() =>
      application.evaluate(() =>
        Number(document.documentElement.getAttribute("data-controlled-submit-click-count")),
      ),
    )
    .toBe(0);

  await panel.getByRole("button", { name: "Prepare one Test ATS submission" }).click();
  await application
    .getByLabel("I reviewed the application and confirm the Test ATS information is accurate")
    .uncheck();
  await expect(panel.getByText(/review page changed after final submission approval/i)).toBeVisible(
    { timeout: 9_000 },
  );
  await expect
    .poll(() =>
      application.evaluate(() =>
        Number(document.documentElement.getAttribute("data-controlled-submit-click-count")),
      ),
    )
    .toBe(0);
  const staleIntents = await panel.evaluate<unknown>(async () => {
    const stored: unknown = await chrome.storage.local.get("controlledSubmission");
    return (stored as { controlledSubmission: { intents: Array<unknown> } }).controlledSubmission
      .intents;
  });
  expect(staleIntents).toMatchObject([
    { state: "ABORTED" },
    { state: "FAILED", failureCode: "VALIDATION_ERROR" },
  ]);
  expect(staleIntents).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ submitDispatchedAt: expect.any(String) })]),
  );
  await application
    .getByLabel("I reviewed the application and confirm the Test ATS information is accurate")
    .check();
  await application.bringToFront();
  await panel.getByRole("button", { name: "Scan and match visible form" }).click();
  await panel
    .getByLabel(
      "I reviewed the final summary and authorize exactly one submission to the local Test ATS.",
    )
    .check();

  await panel.getByRole("button", { name: "Prepare one Test ATS submission" }).click();
  await expect(
    application.getByRole("heading", { name: "Thank you, your application was submitted" }),
  ).toBeVisible({ timeout: 9_000 });
  await expect(panel.getByText(/local tracker was updated to APPLIED/)).toBeVisible({
    timeout: 9_000,
  });
  await expect(panel.getByText(/WD-CONF-700/)).toBeVisible();
  await expect
    .poll(() =>
      application.evaluate(() =>
        Number(document.documentElement.getAttribute("data-controlled-submit-click-count")),
      ),
    )
    .toBe(1);

  const replayResponse = await panel.evaluate<unknown>(async () => {
    const stored: unknown = await chrome.storage.local.get("controlledSubmission");
    const intents = (stored as { controlledSubmission: { intents: Array<{ id: string }> } })
      .controlledSubmission.intents;
    const latest = intents[intents.length - 1];
    if (!latest) throw new Error("Expected a persisted submission intent.");
    const response: unknown = await chrome.runtime.sendMessage({
      type: "PANEL_SUBMISSION_EXECUTE",
      intentId: latest.id,
    });
    return response;
  });
  expect(replayResponse).toMatchObject({ ok: false, error: { code: "SUBMISSION_FAILED" } });
  await expect
    .poll(() =>
      application.evaluate(() =>
        Number(document.documentElement.getAttribute("data-controlled-submit-click-count")),
      ),
    )
    .toBe(1);

  await panel.screenshot({
    path: testInfo.outputPath("phase12-confirmed-submission.png"),
    fullPage: true,
  });
});

test("saves and reloads a versioned profile through chrome.storage.local", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole("button", { name: "Edit full profile", exact: true }).click();

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
  await panel.getByRole("button", { name: "Edit full profile", exact: true }).click();
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
    await panel.getByRole("button", { name: "Edit full profile", exact: true }).click();
    const resumePath = fileURLToPath(
      new URL(`../../fixtures/resumes/${fileName}`, import.meta.url),
    );

    await panel.getByLabel("Choose PDF or DOCX").setInputFiles(resumePath);

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
  await panel.getByRole("button", { name: "Edit full profile", exact: true }).click();
  await panel.getByLabel("Import JSON").setInputFiles({
    name: "malformed.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"backupVersion":999}'),
  });

  await expect(panel.getByRole("alert")).toContainText("malformed or uses an unsupported version");
  await expect(panel.getByText("Profile version 1")).toBeVisible();
});
