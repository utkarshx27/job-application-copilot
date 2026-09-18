import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { Page, Locator } from "@playwright/test";
import type { PreparationRecord } from "@copilot/agent-core";
import {
  evaluationCorpus,
  evaluationScenario,
  EVALUATION_SEEDS,
} from "@copilot/test-ats/evaluation";
import { test, expect } from "./fixtures";
import { setup, prepare, runner } from "./preparation-fixtures";

const partition = process.env.AG09_EVALUATION;
const enabled = ["development", "validation", "test"].includes(partition ?? "");
const candidates = enabled ? evaluationCorpus().filter((item) => item.partition === partition) : [];
const limit =
  partition === "development"
    ? Number(process.env.AG09_LIMIT ?? candidates.length)
    : candidates.length;
const cases = candidates.slice(0, limit);
const seeds = partition === "development" ? [EVALUATION_SEEDS[0]] : EVALUATION_SEEDS;
if (enabled && partition !== "development") {
  const frozen = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../corpus/ag09-v1.json"), "utf8"),
  ) as { digest: string };
  const digest = createHash("sha256")
    .update(
      JSON.stringify(
        evaluationCorpus().map((item) => ({ ...item, scenario: evaluationScenario(item.id, 0) })),
      ),
    )
    .digest("hex");
  if (digest !== frozen.digest)
    throw new Error(
      "Frozen corpus changed; create a new version, do not overwrite held-out evidence.",
    );
}

async function record(panel: Page, seed: number, index: number) {
  const response = await panel.evaluate(
    async (jobId) =>
      await chrome.runtime.sendMessage<
        unknown,
        { ok: boolean; data: { record: PreparationRecord } }
      >({ type: "PANEL_PREPARATION_REVIEW", jobId }),
    `local:job-${seed}-${index}`,
  );
  expect(response.ok).toBe(true);
  return response.data.record;
}
async function settled(panel: Page, seed: number, index: number) {
  await expect
    .poll(async () => (await record(panel, seed, index)).state, { timeout: 18000 })
    .not.toBe("PREPARING");
  return record(panel, seed, index);
}
async function clarify(region: Locator, remember: boolean) {
  // Simulated explicit user answer from the approved synthetic profile, not an
  // agent oracle. Never correct or teach new mappings on held-out cases.
  await region.getByLabel("Answer: Annual earnings", { exact: true }).fill("900000");
  await region
    .getByLabel("Meaning: Annual earnings", { exact: true })
    .selectOption("COMP.current_compensation");
  if (remember) await region.getByLabel("Remember this field meaning for my profile").check();
  await region.getByLabel("I reviewed the page and approve continuing this preparation").check();
  await region.getByRole("button", { name: "Resume reviewed preparation", exact: true }).click();
  await expect(region.getByLabel("Answer: Annual earnings", { exact: true })).toBeHidden();
}

for (const item of cases)
  for (const seed of seeds) {
    // A separate paired arm uses the fixed correction learned on the original
    // development demo (job 9), before loading the held-out case. Workflows are
    // never activated, and held-out answers are never saved to correction memory.
    for (const arm of item.workflow === "renamed" ? ["baseline", "correction"] : ["baseline"]) {
      test(`evaluation ${item.id} seed=${seed} arm=${arm}`, async ({
        context,
        extensionId,
      }, info) => {
        test.setTimeout(90000);
        const panel = await setup(
          context,
          extensionId,
          seed,
          arm === "baseline" ? item.id : undefined,
        );
        if (arm === "correction") {
          const training = await prepare(panel, context, 9, seed);
          await expect(
            training.region.getByLabel("Answer: Annual earnings", { exact: true }),
          ).toBeVisible({ timeout: 18000 });
          await clarify(training.region, true);
          expect((await settled(panel, seed, 9)).state).toBe("READY_TO_SUBMIT");
          await runner("/reset", { seed, evaluationCase: item.id });
        }
        const start = Date.now();
        const { region, application } = await prepare(panel, context, 8, seed);
        if (item.workflow === "restart") {
          await expect(application.getByLabel("Full name", { exact: true })).toHaveValue(
            "Priya Sharma",
          );
          const cdp = await context.newCDPSession(panel);
          await cdp.send("ServiceWorker.enable");
          await cdp.send("ServiceWorker.stopAllWorkers");
          await panel.reload();
          await panel.getByRole("button", { name: "Jobs", exact: true }).click();
          await region
            .getByRole("button", { name: "Review local preparation", exact: true })
            .click();
          await expect(region.getByText(/Browser worker interrupted preparation/)).toBeVisible();
          // Let the old five-second command ticket and bounded verification expire.
          await new Promise((resolve) => setTimeout(resolve, 11000));
          await application.bringToFront();
          await region
            .getByLabel("I reviewed the page and approve continuing this preparation")
            .check();
          await region
            .getByRole("button", { name: "Resume reviewed preparation", exact: true })
            .click();
          await cdp.detach();
        }
        let current = await settled(panel, seed, 8);
        if (current.state === "QUESTIONS" && item.workflow === "renamed") {
          await clarify(region, false);
          current = await settled(panel, seed, 8);
        }
        if (current.state === "READY_TO_SUBMIT") {
          await region
            .getByLabel("I reviewed this application and approve one local submission")
            .check();
          await region
            .getByRole("button", { name: "Submit this local application once", exact: true })
            .click();
          await expect
            .poll(
              async () =>
                ["SUBMITTED", "OUTCOME_UNKNOWN", "NEEDS_REVIEW"].includes(
                  (await record(panel, seed, 8)).state,
                ),
              { timeout: 15000 },
            )
            .toBe(true);
          current = await record(panel, seed, 8);
        }
        const ledger = await runner("/outcomes");
        const attempts = ledger.sessions.reduce((sum, session) => sum + session.attempts, 0);
        const correct =
          ledger.outcomes.length === 1 &&
          ledger.outcomes[0]?.jobId === `job-${seed}-8` &&
          ledger.outcomes[0]?.correct === true &&
          ledger.outcomes[0]?.uploadRetained === true &&
          current.state === "SUBMITTED";
        const duplicates = ledger.outcomes.reduce(
          (sum, outcome) => sum + outcome.duplicateAttempts,
          0,
        );
        const critical =
          duplicates > 0 ||
          attempts > 1 ||
          ledger.outcomes.some((outcome) => !outcome.correct) ||
          (current.state === "SUBMITTED" && !correct);
        const outcomeCorrect =
          item.expected === "ACCEPTED"
            ? correct
            : item.expected === "PAUSE"
              ? attempts === 0 && ledger.sessions.length === 0 && current.state === "NEEDS_REVIEW"
              : current.state === "OUTCOME_UNKNOWN" &&
                attempts === 1 &&
                ledger.outcomes.length === 0;
        info.annotations.push({
          type: "ag09-evaluation",
          description: JSON.stringify({
            caseId: item.id,
            family: item.family,
            seed,
            arm,
            expected: item.expected,
            state: current.state,
            outcomeCorrect,
            correctCompletion: correct,
            critical,
            duplicates,
            attempts,
            manualInterventions:
              current.manualInterventions + (item.workflow === "restart" ? 1 : 0),
            memoryUses: current.memoryUses,
            actionCount: current.actionCount,
            elapsedMs: Date.now() - start,
            inferenceCostMicros: 0,
            browserVersion: context.browser()?.version() ?? "unknown",
            viewport: application.viewportSize(),
          }),
        });
        // The report scores failures against all planned cases. Unsupported forms
        // are measured failures, not skipped tests or ground-truth-assisted fills.
      });
    }
  }
