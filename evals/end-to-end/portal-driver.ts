import type { Frame, Locator, Page } from "@playwright/test";
import type { PortalField } from "@copilot/test-ats";

export type PortalStrategy = "NATIVE" | "LABEL" | "SHADOW" | "FRAME" | "COMBOBOX" | "REOBSERVE";
export type PortalRun = {
  state:
    | "PAGE_CONFIRMATION"
    | "OUTCOME_UNKNOWN"
    | "IDENTITY_MISMATCH"
    | "NEEDS_ANSWER"
    | "NEEDS_MANUAL"
    | "PAUSED_ACCESS"
    | "PAUSED_CLOSED_TAB";
  strategies: PortalStrategy[];
  applicationId?: string;
  jobId?: string;
};
const local = (url: string) => {
  const parsed = new URL(url);
  return (
    parsed.origin === "http://127.0.0.1:4173" &&
    ["/portal.html", "/portal-frame.html"].includes(parsed.pathname)
  );
};

// Test driver for original local fixtures. It never has access to runner tokens,
// expected outcomes, fixture faults, server state, or remote browser sessions.
export async function runPortalFixture(
  page: Page,
  fields: PortalField[],
  candidate: Record<string, string>,
  resume: string,
): Promise<PortalRun> {
  try {
    return await runOpenPortalFixture(page, fields, candidate, resume);
  } catch (error) {
    if (page.isClosed()) return { state: "PAUSED_CLOSED_TAB", strategies: [] };
    throw error;
  }
}

async function runOpenPortalFixture(
  page: Page,
  fields: PortalField[],
  candidate: Record<string, string>,
  resume: string,
): Promise<PortalRun> {
  const strategies: PortalStrategy[] = [];
  const result = (
    state: PortalRun["state"],
    applicationId?: string,
    jobId?: string,
  ): PortalRun => ({
    state,
    strategies,
    ...(applicationId ? { applicationId } : {}),
    ...(jobId ? { jobId } : {}),
  });
  if (page.isClosed()) return result("PAUSED_CLOSED_TAB");
  if (!local(page.url()))
    throw new Error("The portal test driver requires an exact local fixture route");
  if (await page.getByRole("alert").count()) return result("PAUSED_ACCESS");
  const apply = page.getByRole("button", { name: "Apply locally", exact: true });
  if (!(await apply.count())) return result("NEEDS_MANUAL");
  await apply.click();
  // Bounded rendering wait. Frames and DOM are resolved again on each attempt.
  let scope: Frame | undefined;
  for (let attempt = 0; attempt < 12; attempt++) {
    if (page.isClosed()) return result("PAUSED_CLOSED_TAB");
    for (const frame of page.frames()) {
      if (!local(frame.url())) continue;
      if (await frame.getByLabel("Full name", { exact: true }).count()) {
        scope = frame;
        break;
      }
    }
    if (scope) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!scope) return result("NEEDS_MANUAL");
  if (scope !== page.mainFrame()) strategies.push("FRAME");
  const app = scope.locator("[data-application-id]").first();
  const applicationId = (await app.getAttribute("data-application-id")) ?? undefined;
  const jobId = (await app.getAttribute("data-job-id")) ?? undefined;
  async function resolve(field: PortalField): Promise<Locator | null> {
    if (!scope) return null;
    // Known native name, then accessible label. Playwright locators also enter open
    // shadow roots; record that distinct route instead of claiming native success.
    let control = scope.locator(`input[name="${field.key}"],select[name="${field.key}"]`).first();
    if ((await control.count()) && (await control.isVisible())) {
      const shadow = await control.evaluate(
        (element) => element.getRootNode() instanceof ShadowRoot,
      );
      strategies.push(shadow ? "SHADOW" : "NATIVE");
      return control;
    }
    control = scope.getByLabel(field.label, { exact: true }).first();
    if ((await control.count()) && (await control.isVisible())) {
      strategies.push(
        (await control.evaluate((element) => element.getRootNode() instanceof ShadowRoot))
          ? "SHADOW"
          : "LABEL",
      );
      return control;
    }
    return null;
  }
  async function fillVisible(): Promise<boolean> {
    for (const field of fields) {
      let control = await resolve(field);
      if (!control) continue;
      const value = candidate[field.key];
      if (field.kind !== "file" && value === undefined && field.required) return false;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (field.kind === "file")
            await control.setInputFiles({
              name: "synthetic-resume.txt",
              mimeType: "text/plain",
              buffer: Buffer.from(resume),
            });
          else if ((await control.getAttribute("role")) === "combobox") {
            strategies.push("COMBOBOX");
            await control.click();
            await scope?.getByRole("option", { name: value ?? "", exact: true }).click();
            if ((await control.textContent()) !== value)
              throw new Error("Selection was not retained");
          } else if (field.kind === "select") {
            await control.selectOption({ label: value ?? "" });
            if ((await control.inputValue({ timeout: 1000 })) !== value)
              throw new Error("Select was not retained");
          } else {
            await control.fill(value ?? "", { timeout: 1000 });
            if ((await control.inputValue({ timeout: 1000 })) !== value)
              throw new Error("Value was not retained");
          }
          break;
        } catch (error) {
          if (attempt === 1) throw error;
          strategies.push("REOBSERVE");
          control = await resolve(field);
          if (!control) return false;
        }
      }
    }
    return true;
  }
  if (!(await fillVisible())) return result("NEEDS_ANSWER", applicationId, jobId);
  const history = scope.getByRole("button", { name: "Add work history", exact: true });
  if (await history.count()) {
    await history.click();
    await scope.getByLabel("Employer 1", { exact: true }).fill(candidate.employer ?? "");
    await history.click();
    await scope.getByLabel("Employer 2", { exact: true }).fill(candidate.previousEmployer ?? "");
    await scope.getByRole("button", { name: "Remove history row", exact: true }).first().click();
    await history.click();
    await scope.getByLabel("Employer 1", { exact: true }).fill(candidate.employer ?? "");
  }
  await scope.getByRole("button", { name: "Next step", exact: true }).click();
  if (!(await fillVisible())) return result("NEEDS_ANSWER", applicationId, jobId);
  await scope.getByRole("button", { name: "Review application", exact: true }).click();
  const approve = scope.getByLabel("I approve this synthetic application");
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await approve.count()) || (await scope.getByRole("alert").count())) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (await scope.getByRole("alert").count())
    return result(
      /session expired|access check/i.test(await scope.getByRole("alert").innerText())
        ? "PAUSED_ACCESS"
        : "NEEDS_MANUAL",
      applicationId,
      jobId,
    );
  await approve.check();
  await scope.getByRole("button", { name: "Submit local application", exact: true }).click();
  for (let attempt = 0; attempt < 20; attempt++) {
    if (
      (await scope.locator("[data-receipt-id]").count()) ||
      (await scope.getByRole("alert").count())
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const receipt = scope.locator("[data-receipt-id]");
  if (!(await receipt.count())) return result("OUTCOME_UNKNOWN", applicationId, jobId);
  if (
    (await receipt.getAttribute("data-receipt-id")) !== applicationId ||
    (await receipt.getAttribute("data-receipt-job")) !== jobId
  )
    return result("IDENTITY_MISMATCH", applicationId, jobId);
  return result("PAGE_CONFIRMATION", applicationId, jobId);
}
