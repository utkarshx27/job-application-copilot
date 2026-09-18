import { expect } from "./fixtures";
import type { Page, BrowserContext } from "@playwright/test";

export const resume = "Synthetic resume: Priya Sharma; Example Labs; 36 months of experience.";
type Ledger = {
  outcomes: {
    jobId: string;
    correct: boolean;
    acceptedCount: number;
    duplicateAttempts: number;
    uploadRetained: boolean;
  }[];
  sessions: { attempts: number }[];
};
export async function runner(path: string, input?: unknown) {
  const response = await fetch(`http://127.0.0.1:4174${path}`, {
    method: input ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${process.env.PORTAL_RUNNER_TOKEN}`,
      "content-type": "application/json",
    },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
  expect(response.ok).toBe(true);
  return (await response.json()) as Ledger;
}
export async function setup(
  context: BrowserContext,
  extensionId: string,
  seed = 7,
  evaluationCase?: string,
) {
  await runner("/reset", { seed, ...(evaluationCase ? { evaluationCase } : {}) });
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
  return panel;
}
export async function prepare(panel: Page, context: BrowserContext, index: number, seed = 7) {
  const region = panel.getByRole("region", {
    name: `Preparation for local:job-${seed}-${index}`,
    exact: true,
  });
  await region.getByRole("button", { name: "Review local preparation", exact: true }).click();
  await region.getByLabel("Current city for this application", { exact: true }).fill("Bengaluru");
  await region
    .getByLabel("Work arrangement for this application", { exact: true })
    .selectOption("Remote");
  const details = region.locator("details");
  if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
  if ([8, 9, 13].includes(index)) {
    for (const [label, value] of [
      ["Total experience in months", "36"],
      ["Notice period in days", "30"],
      ["Current compensation", "900000"],
      ["Expected compensation", "1500000"],
    ])
      await details.getByLabel(label!, { exact: true }).fill(value!);
    await details.getByLabel("Compensation currency", { exact: true }).selectOption("INR");
    await details.getByLabel("Compensation period", { exact: true }).selectOption("Year");
    await details.getByLabel("Résumé for this local application", { exact: true }).setInputFiles({
      name: "synthetic-resume.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(resume),
    });
    await expect(details.getByText(/Selected: synthetic-resume.txt/)).toBeVisible();
  }
  await details
    .getByLabel("I approve these answers, this file, and preparation through local review")
    .check();
  const opened = context.waitForEvent("page");
  await details
    .getByRole("button", { name: "Prepare complete local application", exact: true })
    .click();
  return { region, application: await opened };
}
