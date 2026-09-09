import { test, expect } from "./fixtures";
test("reviewed field correction survives reload, fills a fresh form and disappears after forget", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByLabel("Full legal name").fill("Nora Example");
  await panel.getByLabel("Given name", { exact: true }).fill("Nora");
  await panel.getByLabel("Target roles", { exact: true }).fill("Platform Engineer");
  await panel.getByLabel("Preferred locations", { exact: true }).fill("Bengaluru");
  await panel.getByLabel("Remote", { exact: true }).check();
  await panel.getByLabel("Email", { exact: true }).fill("nora@example.test");
  await panel.getByLabel("I reviewed my contact details and job preferences").check();
  await panel.getByRole("button", { name: "Save my setup" }).click();
  await expect(panel.getByRole("heading", { name: "Your setup is ready" })).toBeVisible();
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/memory.html");
  await panel.getByRole("button", { name: "Observe", exact: true }).click();
  await page.bringToFront();
  const scan = async () => {
    await panel.getByRole("button", { name: "Scan and match visible form" }).click();
    await expect(panel.locator(".mapping-fields")).toBeVisible();
  };
  await scan();
  let row = panel.locator(".mapping-fields > li").filter({ hasText: "Preferred inbox" });
  await expect(row.getByText("Unmapped", { exact: true })).toBeVisible();
  await row.getByText("Correct field meaning", { exact: true }).click();
  await row.getByLabel("Meaning for Preferred inbox").selectOption("CONTACT.email");
  await row.getByRole("button", { name: "Confirm and remember meaning" }).click();
  await expect(row.getByText("CONTACT.email", { exact: true })).toBeVisible();
  await panel.reload();
  await panel.getByRole("button", { name: "Observe", exact: true }).click();
  await page.reload();
  await page.bringToFront();
  await scan();
  row = panel.locator(".mapping-fields > li").filter({ hasText: "Preferred inbox" });
  await expect(row.getByText("CONTACT.email", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Fill selected fields", exact: true }).click();
  await expect(page.getByLabel("Preferred inbox")).toHaveValue("nora@example.test");
  await expect(page.getByLabel("Country of residence")).toHaveValue("");
  await panel.getByText("Experimental agent lab", { exact: true }).click();
  const memory = panel.getByRole("region", { name: "Correction memory" });
  await memory.getByRole("button", { name: "Refresh corrections" }).click();
  await memory.getByRole("button", { name: "Forget correction" }).click();
  await expect(memory.getByText(/No corrections yet/)).toBeVisible();
  await page.reload();
  await page.bringToFront();
  await scan();
  await expect(row.getByText("Unmapped", { exact: true })).toBeVisible();
});

test("workflow memory validates a second local run, reuses fresh targets and can be forgotten", async ({
  context,
  extensionId,
}) => {
  test.setTimeout(65000);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByText("Experimental agent lab", { exact: true }).click();
  const executor = panel.getByRole("region", { name: "Local application executor" });
  const memory = panel.getByRole("region", { name: "Correction memory" });
  await executor.getByLabel("Enable local execution").check();
  await executor
    .getByLabel("I approve this synthetic profile, file, and local step navigation")
    .check();
  let page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/agent.html");
  const prepare = async (count: number) => {
    // Keep the earlier prepared application intact; one active run owns each tab.
    if (count > 1) {
      page = await context.newPage();
      await page.goto("http://127.0.0.1:4173/agent.html");
    }
    await page.bringToFront();
    await executor.getByRole("button", { name: "Prepare synthetic application" }).click();
    await expect(
      executor.getByRole("heading", { name: "Application ready for review" }),
    ).toHaveCount(count, { timeout: 20000 });
  };
  await prepare(1);
  await memory.getByRole("button", { name: "Refresh completed demos" }).click();
  await memory.getByLabel("Completed demo", { exact: true }).selectOption({ index: 1 });
  await memory.getByRole("button", { name: "Capture workflow candidate" }).click();
  await expect(memory.getByText(/CANDIDATE · Revision/)).toBeVisible();
  await expect(memory.getByRole("button", { name: "Activate workflow" })).toBeDisabled();
  await prepare(2);
  await memory.getByRole("button", { name: "Refresh completed demos" }).click();
  await memory.getByLabel("Completed demo", { exact: true }).selectOption({ index: 1 });
  await memory.getByRole("button", { name: "Validate against selected demo" }).click();
  await expect(memory.getByText(/OFFLINE_VALIDATED · Revision/)).toBeVisible();
  await memory.getByRole("button", { name: "Activate workflow" }).click();
  await expect(memory.getByText(/^ACTIVE · Revision/)).toBeVisible();
  await prepare(3);
  const reused = await panel.evaluate(
    () =>
      new Promise<boolean>((resolve, reject) => {
        const request = indexedDB.open("copilot-executor-v1");
        request.onerror = () => reject(new Error("storage"));
        request.onsuccess = () => {
          const tx = request.result.transaction("controller");
          const get = tx.objectStore("controller").get("state");
          get.onsuccess = () => {
            const store = get.result as {
              runs: {
                intents: {
                  status: string;
                  proposal: { memoryRef?: { id: string; revision: number } };
                }[];
              }[];
            };
            resolve(
              store.runs
                .at(-1)!
                .intents.some(
                  (intent) => intent.status === "VERIFIED" && !!intent.proposal.memoryRef,
                ),
            );
            request.result.close();
          };
        };
      }),
  );
  expect(reused).toBe(true);
  await memory.getByRole("button", { name: "Forget workflow" }).click();
  await expect(memory.getByRole("button", { name: "Forget workflow" })).toHaveCount(0);
});
