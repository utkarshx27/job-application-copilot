import { test, expect } from "./fixtures";

test("Jobs catalog deduplicates demos, shows source evidence and persists imported shortlist decisions", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole("button", { name: "Jobs", exact: true }).click();
  const jobs = panel.getByRole("region", { name: "Jobs research" });
  await jobs.getByRole("button", { name: "Search demo jobs" }).click();
  await expect(jobs.getByText("44 local catalog reads remaining today · READY")).toBeVisible();
  await expect(jobs.locator("article")).toHaveCount(13);
  await expect(jobs.getByText(/Small sample/).first()).toBeVisible();
  await expect(jobs.getByText(/Stale source/).first()).toBeVisible();
  const selected = jobs
    .getByRole("article", { name: "Frontend Engineer at Example Labs in London" })
    .first();
  const opened = context.waitForEvent("page");
  await selected.getByRole("link", { name: "Open application demo", exact: true }).click();
  const application = await opened;
  await expect(application).toHaveURL(/jobId=job-7-1/);
  await expect(
    application.getByRole("heading", { name: "Frontend Engineer at Example Labs", exact: true }),
  ).toBeVisible();
  await application.getByRole("button", { name: "Apply locally", exact: true }).click();
  await expect(application.locator('[data-job-id="job-7-1"]')).toBeVisible();
  await application.close();
  await jobs.getByText("Paste a job listing", { exact: true }).click();
  await jobs.getByLabel("Job title", { exact: true }).fill("Imported QA engineer");
  await jobs.getByLabel("Company", { exact: true }).fill("Example Test");
  await jobs.getByLabel("Job location", { exact: true }).fill("Remote");
  await jobs.getByLabel("Listing URL", { exact: true }).fill("https://example.test/jobs/qa");
  await jobs.getByRole("button", { name: "Import listing", exact: true }).click();
  await expect(jobs.locator("article")).toHaveCount(14);
  await jobs
    .getByLabel("Listing URL", { exact: true })
    .fill("https://example.test/jobs/qa?utm_source=duplicate");
  await jobs.getByRole("button", { name: "Import listing", exact: true }).click();
  await expect(jobs.getByRole("button", { name: "Import listing", exact: true })).toBeEnabled();
  await expect(jobs.locator("article")).toHaveCount(14);
  const imported = jobs.getByRole("article", {
    name: "Imported QA engineer at Example Test in Remote",
  });
  await expect(imported.getByText(/Company evidence unavailable/)).toBeVisible();
  await expect(imported.getByText(/UNKNOWN/)).toBeVisible();
  await imported.getByText("Add or remove company evidence", { exact: true }).click();
  await imported.getByLabel("Rating source name").fill("Public test source");
  await imported.getByLabel("Rating source URL").fill("https://example.test/company/reviews");
  await imported.getByLabel("Rating value").fill("4.2");
  await imported.getByLabel("Review count").fill("3");
  await imported.getByLabel("Source retrieval date").fill("2024-01-01");
  await imported.getByLabel("I checked this source refers to this employer and location").check();
  await imported.getByRole("button", { name: "Save sourced rating" }).click();
  await expect(imported.getByText(/4.2\/5 · 3 reviews · 2024-01-01/)).toBeVisible();
  await imported.getByRole("button", { name: "Dismiss job", exact: true }).click();
  await expect(imported).toHaveCount(0);
  await panel.reload();
  await panel.getByRole("button", { name: "Jobs", exact: true }).click();
  await expect(jobs.locator("article")).toHaveCount(13);
  await jobs.getByLabel("Show dismissed and excluded jobs").check();
  await expect(imported).toBeVisible();
  await expect(imported.getByText(/4.2\/5 · 3 reviews · 2024-01-01/)).toBeVisible();
  await imported.getByRole("button", { name: "Restore job", exact: true }).click();
  await expect(imported.getByRole("button", { name: "Dismiss job", exact: true })).toBeVisible();
  await imported.getByText("Add or remove company evidence", { exact: true }).click();
  await imported.getByRole("button", { name: "Forget company evidence" }).click();
  await expect(imported.getByText(/Company evidence unavailable/)).toBeVisible();
  await imported.getByRole("button", { name: "Forget listing" }).click();
  await expect(imported).toHaveCount(0);
});
