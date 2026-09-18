import { test, expect } from "./fixtures";
import type { PreparationRecord } from "@copilot/agent-core";
import { runner, setup, prepare } from "./preparation-fixtures";

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

for (const mutation of ["resume identity", "job identity", "unexpected frame"] as const) {
  test(`final approval rejects changed ${mutation} without submitting`, async ({
    context,
    extensionId,
  }) => {
    const panel = await setup(context, extensionId);
    const { region, application } = await prepare(panel, context, 8);
    await expect(region.getByText(/Application prepared through review/)).toBeVisible({
      timeout: 20000,
    });
    await application.evaluate((kind) => {
      if (kind === "resume identity") {
        document
          .querySelector("[data-upload-sha256]")!
          .setAttribute("data-upload-sha256", "0".repeat(64));
      } else if (kind === "job identity") {
        document.querySelector("[data-application-id]")!.setAttribute("data-job-id", "job-7-1");
      } else {
        document.body.append(document.createElement("iframe"));
      }
    }, mutation);
    const response = await panel.evaluate(async () => {
      const view = await chrome.runtime.sendMessage<
        unknown,
        { data: { record: PreparationRecord } }
      >({
        type: "PANEL_PREPARATION_REVIEW",
        jobId: "local:job-7-8",
      });
      return await chrome.runtime.sendMessage<
        unknown,
        { ok: boolean; data: { record: PreparationRecord } }
      >({
        type: "PANEL_PREPARATION_SUBMIT",
        id: view.data.record.id,
        revision: view.data.record.revision,
        confirmed: true,
      });
    });
    expect(response.ok).toBe(true);
    expect(response.data.record.state).toBe("NEEDS_REVIEW");
    expect(response.data.record.receipt).toBeNull();
    expect(response.data.record.reason).toMatch(
      mutation === "resume identity"
        ? /final review differs/
        : /Application observation unavailable/,
    );
    const ledger = await runner("/outcomes");
    expect(ledger.sessions).toHaveLength(1);
    expect(ledger.sessions[0]?.attempts).toBe(0);
    expect(ledger.outcomes).toHaveLength(0);
    await expect(region.getByText(/Verified receipt:/)).toHaveCount(0);
  });
}

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
