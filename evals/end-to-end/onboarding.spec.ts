import { test, expect } from "./fixtures";

test("simple setup preserves notes and distinct preferences across reload and full editor", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 360, height: 760 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByRole("heading", { name: "Set up your job search" })).toBeVisible();
  await panel
    .getByLabel("Background notes")
    .fill("Name: Priya Sharma\nEmail: priya@example.test\nI want to work with Rust");
  await panel.getByRole("button", { name: "Suggest contact details from notes" }).click();
  await expect(panel.getByLabel("Full legal name")).toHaveValue("Priya Sharma");
  await panel.getByRole("button", { name: "I reviewed these extracted details" }).click();
  await expect(
    panel.getByRole("button", { name: "I reviewed these extracted details" }),
  ).toHaveCount(0);
  await panel
    .getByLabel("Target roles", { exact: true })
    .fill("Software Engineer, Platform Engineer");
  await panel.getByLabel("Preferred locations", { exact: true }).fill("Bengaluru, Pune");
  await panel.getByLabel("Remote", { exact: true }).check();
  await panel.getByLabel("Total experience (months, optional)").fill("36");
  await panel.getByLabel("Notice period (days, optional)").fill("30");
  await panel.getByText("Compensation and exclusions (optional)", { exact: true }).click();
  await panel.getByLabel("Current compensation amount").fill("900000");
  await panel.getByLabel("Expected compensation amount").fill("150000");
  await panel.getByLabel("Expected compensation period").selectOption("MONTH");
  await panel.getByLabel("I reviewed my contact details and job preferences").check();
  await panel.getByRole("button", { name: "Save my setup" }).focus();
  await panel.keyboard.press("Enter");
  await expect(panel.getByRole("heading", { name: "Your setup is ready" })).toBeVisible();
  await panel.reload();
  await expect(panel.getByLabel("Target roles", { exact: true })).toHaveValue(
    "Software Engineer, Platform Engineer",
  );
  await expect(panel.getByLabel("Background notes")).toHaveValue(
    "Name: Priya Sharma\nEmail: priya@example.test\nI want to work with Rust",
  );
  const size = await panel.evaluate(() => ({
    viewport: innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(size.content).toBeLessThanOrEqual(size.viewport);
  await panel.getByRole("button", { name: "Edit full profile" }).click();
  await expect(panel.getByLabel(/Skills one per line/)).toHaveValue("");
  await panel.getByRole("button", { name: "Save and verify profile" }).click();
  await expect(panel.getByText(/saved locally\./)).toBeVisible();
  await panel.getByRole("button", { name: "Back to simple setup" }).click();
  await panel.getByText("Compensation and exclusions (optional)", { exact: true }).click();
  await expect(panel.getByLabel("Current compensation amount")).toHaveValue("900000");
  await expect(panel.getByLabel("Expected compensation period")).toHaveValue("MONTH");
});
