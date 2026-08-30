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
  await expect(panel.getByText("APPLIED", { exact: true })).toBeVisible();
  await expect(panel.getByText("Résumé: synthetic-resume.pdf")).toBeVisible();
  await panel.screenshot({
    path: testInfo.outputPath("phase3-tracker-confirmed.png"),
    fullPage: true,
  });
});

test("teaches a company-scoped custom answer once and suggests it for review", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
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
  await panel.getByLabel("Import JSON").setInputFiles({
    name: "malformed.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"backupVersion":999}'),
  });

  await expect(panel.getByRole("alert")).toContainText("malformed or uses an unsupported version");
  await expect(panel.getByText("Profile version 1")).toBeVisible();
});
