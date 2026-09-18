import type { PreparationRecord } from "@copilot/agent-core";
import { test, expect } from "./fixtures";
import { prepare, runner, setup } from "./preparation-fixtures";

test("combobox options changed while opening are never selected", async ({
  context,
  extensionId,
}) => {
  await context.addInitScript(() => {
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement) || target.getAttribute("role") !== "combobox")
        return;
      const list = document.getElementById(target.getAttribute("aria-controls") ?? "");
      const option = list?.querySelector('[role="option"]');
      if (option) option.textContent = "Unreviewed replacement";
    });
  });
  const panel = await setup(context, extensionId, 7, "screening-27-combobox");
  const { region, application } = await prepare(panel, context, 8);
  await expect(
    region.getByRole("button", { name: "Resume reviewed preparation", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    application.getByRole("combobox", { name: "Work arrangement", exact: true }),
  ).toHaveText("Choose an option");
  const ledger = await runner("/outcomes");
  expect(ledger.sessions[0]?.attempts).toBe(0);
  expect(ledger.outcomes).toHaveLength(0);
});

for (const obstacle of ["unexpected dialog", "covered frame"] as const) {
  test(`final approval pauses for ${obstacle}`, async ({ context, extensionId }) => {
    const panel = await setup(
      context,
      extensionId,
      7,
      `screening-27-${obstacle === "covered frame" ? "frame" : "dialog"}`,
    );
    const { region, application } = await prepare(panel, context, 8);
    await expect(region.getByText(/Application prepared through review/)).toBeVisible({
      timeout: 20000,
    });
    await application.evaluate((kind) => {
      if (kind === "unexpected dialog") {
        const dialog = document.createElement("dialog");
        dialog.textContent = "Unexpected access request";
        document.body.append(dialog);
        dialog.showModal();
      } else {
        const cover = document.createElement("div");
        cover.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:white";
        document.body.append(cover);
      }
    }, obstacle);
    const response = await panel.evaluate(async () => {
      const view = await chrome.runtime.sendMessage<
        unknown,
        { data: { record: PreparationRecord } }
      >({ type: "PANEL_PREPARATION_REVIEW", jobId: "local:job-7-8" });
      return await chrome.runtime.sendMessage<unknown, { data: { record: PreparationRecord } }>({
        type: "PANEL_PREPARATION_SUBMIT",
        id: view.data.record.id,
        revision: view.data.record.revision,
        confirmed: true,
      });
    });
    expect(response.data.record.state).toBe("NEEDS_REVIEW");
    const ledger = await runner("/outcomes");
    expect(ledger.sessions[0]?.attempts).toBe(0);
    expect(ledger.outcomes).toHaveLength(0);
  });
}

test("frame preparation resumes after worker loss without changing the bound application", async ({
  context,
  extensionId,
}) => {
  test.setTimeout(60000);
  const panel = await setup(context, extensionId, 7, "screening-27-frame");
  const { region, application } = await prepare(panel, context, 8);
  await expect(
    application.frameLocator("iframe").getByLabel("Full name", { exact: true }),
  ).toHaveValue("Priya Sharma");
  const cdp = await context.newCDPSession(panel);
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  await panel.reload();
  await panel.getByRole("button", { name: "Jobs", exact: true }).click();
  await region.getByRole("button", { name: "Review local preparation", exact: true }).click();
  await expect(region.getByText(/Browser worker interrupted preparation/)).toBeVisible();
  await new Promise((resolve) => setTimeout(resolve, 11000));
  await application.bringToFront();
  await region.getByLabel("I reviewed the page and approve continuing this preparation").check();
  await region.getByRole("button", { name: "Resume reviewed preparation", exact: true }).click();
  await expect(region.getByText(/Application prepared through review/)).toBeVisible({
    timeout: 20000,
  });
  await region.getByLabel("I reviewed this application and approve one local submission").check();
  await region
    .getByRole("button", { name: "Submit this local application once", exact: true })
    .click();
  await expect(region.getByText(/Verified receipt:/)).toBeVisible();
  const ledger = await runner("/outcomes");
  expect(ledger.sessions).toHaveLength(1);
  expect(ledger.outcomes[0]).toMatchObject({
    correct: true,
    acceptedCount: 1,
    duplicateAttempts: 0,
  });
  await cdp.detach();
});

for (const workflow of ["dialog", "frame", "shadow", "combobox"] as const) {
  test(`local preparation completes ${workflow} controls with one verified submission`, async ({
    context,
    extensionId,
  }) => {
    const panel = await setup(context, extensionId, 7, `screening-27-${workflow}`);
    const { region } = await prepare(panel, context, 8);
    await expect(region.getByText(/Application prepared through review/)).toBeVisible({
      timeout: 20000,
    });
    expect((await runner("/outcomes")).outcomes).toHaveLength(0);
    await region.getByLabel("I reviewed this application and approve one local submission").check();
    await region
      .getByRole("button", { name: "Submit this local application once", exact: true })
      .click();
    await expect(region.getByText(/Verified receipt:/)).toBeVisible();
    const ledger = await runner("/outcomes");
    expect(ledger.sessions).toHaveLength(1);
    expect(ledger.sessions[0]?.attempts).toBe(1);
    expect(ledger.outcomes).toHaveLength(1);
    expect(ledger.outcomes[0]).toMatchObject({
      jobId: "job-7-8",
      correct: true,
      acceptedCount: 1,
      duplicateAttempts: 0,
      uploadRetained: true,
    });
  });
}

test("reloading a prepared application frame invalidates its surface binding before submission", async ({
  context,
  extensionId,
}) => {
  const panel = await setup(context, extensionId, 7, "screening-27-frame");
  const { region, application } = await prepare(panel, context, 8);
  await expect(region.getByText(/Application prepared through review/)).toBeVisible({
    timeout: 20000,
  });
  await application
    .locator("iframe")
    .evaluate((frame: HTMLIFrameElement) => frame.contentWindow!.location.reload());
  await expect(
    application.frameLocator("iframe").getByLabel("Full name", { exact: true }),
  ).toHaveValue("");
  const response = await panel.evaluate(async () => {
    const view = await chrome.runtime.sendMessage<unknown, { data: { record: PreparationRecord } }>(
      { type: "PANEL_PREPARATION_REVIEW", jobId: "local:job-7-8" },
    );
    return await chrome.runtime.sendMessage<unknown, { data: { record: PreparationRecord } }>({
      type: "PANEL_PREPARATION_SUBMIT",
      id: view.data.record.id,
      revision: view.data.record.revision,
      confirmed: true,
    });
  });
  expect(response.data.record.state).toBe("NEEDS_REVIEW");
  expect(response.data.record.receipt).toBeNull();
  const ledger = await runner("/outcomes");
  expect(ledger.sessions).toHaveLength(1);
  expect(ledger.sessions[0]?.attempts).toBe(0);
  expect(ledger.outcomes).toHaveLength(0);
});
