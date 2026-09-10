import { test, expect } from "./fixtures";
import type { Page, BrowserContext } from "@playwright/test";
import type { PreparationRecord } from "@copilot/agent-core";

const resume = "Synthetic resume: Priya Sharma; Example Labs; 36 months of experience.";
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
async function runner(path: string, input?: unknown) {
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
async function setup(context: BrowserContext, extensionId: string) {
  await runner("/reset", { seed: 7 });
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
async function prepare(panel: Page, context: BrowserContext, index: number) {
  const region = panel.getByRole("region", {
    name: `Preparation for local:job-7-${index}`,
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

test("complete local preparation retains the reviewed resume and submits exactly once with a verified tracker receipt", async ({
  context,
  extensionId,
}) => {
  const panel = await setup(context, extensionId);
  const { region, application } = await prepare(panel, context, 8);
  await expect(region.getByText(/Application prepared through review/)).toBeVisible({
    timeout: 20000,
  });
  await expect(
    application.getByText("Resume retained for this application", { exact: true }),
  ).toBeVisible();
  expect((await runner("/outcomes")).outcomes).toHaveLength(0);
  const submit = region.getByRole("button", {
    name: "Submit this local application once",
    exact: true,
  });
  await expect(submit).toBeDisabled();
  await region.getByLabel("I reviewed this application and approve one local submission").check();
  await submit.click();
  await expect(
    region.getByText("The local server confirmed this application was accepted.", { exact: true }),
  ).toBeVisible();
  const outcomes = await runner("/outcomes");
  expect(outcomes.outcomes).toHaveLength(1);
  expect(outcomes.outcomes[0]).toMatchObject({
    jobId: "job-7-8",
    correct: true,
    acceptedCount: 1,
    duplicateAttempts: 0,
    uploadRetained: true,
  });
  const response = await panel.evaluate(
    async () =>
      await chrome.runtime.sendMessage<unknown, { data: { applications: { status: string }[] } }>({
        type: "PANEL_TRACKER_GET",
      }),
  );
  expect(response.data.applications).toHaveLength(1);
  expect(response.data.applications[0]).toMatchObject({ status: "APPLIED" });
  const pageCount = context.pages().length;
  await panel.reload();
  await panel.getByRole("button", { name: "Jobs", exact: true }).click();
  await region.getByRole("button", { name: "Review local preparation", exact: true }).click();
  await expect(region.getByText(/Verified receipt:/)).toBeVisible();
  expect(context.pages()).toHaveLength(pageCount);
  expect((await runner("/outcomes")).sessions[0]?.attempts).toBe(1);
  await region.getByRole("button", { name: "Clear private application data", exact: true }).click();
  const cleared = await panel.evaluate(
    async () =>
      await chrome.runtime.sendMessage<unknown, { data: { record: PreparationRecord } }>({
        type: "PANEL_PREPARATION_REVIEW",
        jobId: "local:job-7-8",
      }),
  );
  expect(cleared.data.record.file).toBeNull();
  expect(cleared.data.record.answers).toBeNull();
  expect(cleared.data.record.receipt).not.toBeNull();
  const retry = await panel.evaluate(
    async ({ id, revision }) =>
      await chrome.runtime.sendMessage<unknown, { ok: boolean }>({
        type: "PANEL_PREPARATION_SUBMIT",
        id,
        revision,
        confirmed: true,
      }),
    cleared.data.record,
  );
  expect(retry.ok).toBe(false);
  expect((await runner("/outcomes")).sessions[0]?.attempts).toBe(1);
});

test("a reviewed correction removes the repeated clarification on a separate renamed job and validates workflow memory", async ({
  context,
  extensionId,
}) => {
  test.setTimeout(60000);
  const panel = await setup(context, extensionId);
  const first = await prepare(panel, context, 9);
  await expect(
    first.region.getByRole("group", { name: "Review missing or conflicting answers" }),
  ).toBeVisible({ timeout: 20000 });
  await first.region.getByLabel("Answer: Annual earnings", { exact: true }).fill("900000");
  await first.region
    .getByLabel("Meaning: Annual earnings", { exact: true })
    .selectOption("COMP.current_compensation");
  await first.region.getByLabel("Remember this field meaning for my profile").check();
  await first.region
    .getByLabel("I reviewed the page and approve continuing this preparation")
    .check();
  await first.region
    .getByRole("button", { name: "Resume reviewed preparation", exact: true })
    .click();
  await expect(first.region.getByText(/Application prepared through review/)).toBeVisible({
    timeout: 20000,
  });
  const second = await prepare(panel, context, 13);
  await expect(second.region.getByText(/Application prepared through review/)).toBeVisible({
    timeout: 20000,
  });
  await expect(
    second.region.getByText(/1 memory-assisted actions · 0 question reviews/),
  ).toBeVisible();
  await second.region
    .getByRole("button", { name: "Enable validated workflow reuse", exact: true })
    .click();
  await expect(second.region.locator('[role="alert"]')).toHaveCount(0);
  await second.region
    .getByLabel("I reviewed this application and approve one local submission")
    .check();
  await second.region
    .getByRole("button", { name: "Submit this local application once", exact: true })
    .click();
  await expect(second.region.getByText(/Verified receipt:/)).toBeVisible();
  expect((await runner("/outcomes")).outcomes[0]).toMatchObject({
    jobId: "job-7-13",
    correct: true,
  });
  await first.region.getByRole("button", { name: "Cancel this preparation", exact: true }).click();
  await first.region
    .getByRole("button", { name: "Forget preparation record", exact: true })
    .click();
  const third = await prepare(panel, context, 9);
  await expect(third.region.getByText(/Application prepared through review/)).toBeVisible({
    timeout: 20000,
  });
  const thirdView = await panel.evaluate(
    async () =>
      await chrome.runtime.sendMessage<unknown, { data: { record: PreparationRecord } }>({
        type: "PANEL_PREPARATION_REVIEW",
        jobId: "local:job-7-9",
      }),
  );
  expect(thirdView.data.record.memoryUses).toBeGreaterThan(1);
  expect(thirdView.data.record.manualInterventions).toBe(0);
});

test("changed review values block submission before any server attempt", async ({
  context,
  extensionId,
}) => {
  const panel = await setup(context, extensionId);
  const { region, application } = await prepare(panel, context, 8);
  await expect(region.getByText(/Application prepared through review/)).toBeVisible({
    timeout: 20000,
  });
  await application
    .locator("dl dd")
    .filter({ hasText: "900000" })
    .evaluate((element) => {
      element.textContent = "1500000";
    });
  await region.getByLabel("I reviewed this application and approve one local submission").check();
  await region
    .getByRole("button", { name: "Submit this local application once", exact: true })
    .click();
  await expect(region.getByText(/final review differs/)).toBeVisible();
  expect((await runner("/outcomes")).sessions[0]?.attempts).toBe(0);
});

test("complete preparation survives a worker restart without opening another application", async ({
  context,
  extensionId,
}) => {
  test.setTimeout(60000);
  const panel = await setup(context, extensionId);
  const { region, application } = await prepare(panel, context, 8);
  await expect(application.getByLabel("Full name", { exact: true })).toHaveValue("Priya Sharma");
  const cdp = await context.newCDPSession(panel);
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  const stoppedAt = Date.now();
  await panel.reload();
  await panel.getByRole("button", { name: "Jobs", exact: true }).click();
  await region.getByRole("button", { name: "Review local preparation", exact: true }).click();
  await expect(region.getByText(/Browser worker interrupted preparation/)).toBeVisible();
  // A previously issued document command has a five-second ticket plus a bounded verification window.
  await expect
    .poll(() => Date.now() - stoppedAt, { timeout: 15000, intervals: [1000] })
    .toBeGreaterThan(11000);
  await application.bringToFront();
  await region.getByLabel("I reviewed the page and approve continuing this preparation").check();
  await region.getByRole("button", { name: "Resume reviewed preparation", exact: true }).click();
  await expect(region.getByText(/Application prepared through review/)).toBeVisible({
    timeout: 20000,
  });
  expect((await runner("/outcomes")).sessions).toHaveLength(1);
  await region.getByLabel("I reviewed this application and approve one local submission").check();
  await region
    .getByRole("button", { name: "Submit this local application once", exact: true })
    .click();
  await expect(region.getByText(/Verified receipt:/)).toBeVisible();
  expect((await runner("/outcomes")).outcomes[0]).toMatchObject({
    correct: true,
    acceptedCount: 1,
    duplicateAttempts: 0,
  });
  await cdp.detach();
});

test("competing final approvals dispatch only one local submission", async ({
  context,
  extensionId,
}) => {
  const panel = await setup(context, extensionId);
  const { region } = await prepare(panel, context, 1);
  await expect(region.getByText(/Application prepared through review/)).toBeVisible({
    timeout: 20000,
  });
  const responses = await panel.evaluate(async () => {
    const view = await chrome.runtime.sendMessage<unknown, { data: { record: PreparationRecord } }>(
      {
        type: "PANEL_PREPARATION_REVIEW",
        jobId: "local:job-7-1",
      },
    );
    const request = {
      type: "PANEL_PREPARATION_SUBMIT",
      id: view.data.record.id,
      revision: view.data.record.revision,
      confirmed: true,
    };
    return (await Promise.all([
      chrome.runtime.sendMessage(request),
      chrome.runtime.sendMessage(request),
    ])) as { ok: boolean }[];
  });
  expect(responses.filter((r) => r.ok)).toHaveLength(1);
  const ledger = await runner("/outcomes");
  expect(ledger.sessions[0]?.attempts).toBe(1);
  expect(ledger.outcomes[0]).toMatchObject({
    correct: true,
    acceptedCount: 1,
    duplicateAttempts: 0,
  });
});

for (const [index, label, accepted] of [
  [10, "lost response", true],
  [11, "false confirmation", false],
  [12, "wrong response identity", true],
] as const) {
  test(`complete preparation reconciles ${label} without repeating submission`, async ({
    context,
    extensionId,
  }) => {
    const panel = await setup(context, extensionId);
    const { region } = await prepare(panel, context, index);
    await expect(region.getByText(/Application prepared through review/)).toBeVisible({
      timeout: 20000,
    });
    await region.getByLabel("I reviewed this application and approve one local submission").check();
    await region
      .getByRole("button", { name: "Submit this local application once", exact: true })
      .click();
    if (accepted) await expect(region.getByText(/Verified receipt:/)).toBeVisible();
    else {
      await expect(
        region.getByRole("button", { name: "Check application receipt", exact: true }),
      ).toBeVisible();
      await region.getByRole("button", { name: "Check application receipt", exact: true }).click();
      await expect(region.getByText(/Receipt unavailable/)).toBeVisible();
      await expect(region.getByText(/Verified receipt:/)).toHaveCount(0);
    }
    const ledger = await runner("/outcomes");
    expect(ledger.sessions[0]?.attempts).toBe(1);
    expect(ledger.outcomes).toHaveLength(accepted ? 1 : 0);
  });
}
