import { test, expect } from "./fixtures";

test("guided study IDs and confirmed local budget reset preserve shortlisted jobs", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole("button", { name: "Jobs", exact: true }).click();
  const jobs = panel.getByRole("region", { name: "Jobs research" });
  await jobs.getByRole("button", { name: "Search demo jobs", exact: true }).click();
  await expect(jobs.locator("article")).toHaveCount(13);
  await jobs.getByLabel("Show only guided study jobs (8, 9 and 13)").check();
  await expect(jobs.locator("article")).toHaveCount(3);
  for (const id of [8, 9, 13])
    await expect(jobs.getByText(`Demo ID: job-7-${id}`, { exact: true })).toBeVisible();
  await jobs.getByText("Local demo help and read limit", { exact: true }).click();
  const reset = jobs.getByRole("button", { name: "Reset demo read budget", exact: true });
  await expect(reset).toBeDisabled();
  await jobs.getByLabel("I want to reset only the local demo read budget").check();
  await reset.click();
  await expect(jobs.getByText(/50 local catalog reads remaining today/)).toBeVisible();
  await expect(reset).toBeDisabled();
  await jobs.getByLabel("Show only guided study jobs (8, 9 and 13)").uncheck();
  await expect(jobs.locator("article")).toHaveCount(13);
  await panel.reload();
  await panel.getByRole("button", { name: "Jobs", exact: true }).click();
  await expect(jobs.getByText(/50 local catalog reads remaining today/)).toBeVisible();
  await expect(jobs.locator("article")).toHaveCount(13);
});
