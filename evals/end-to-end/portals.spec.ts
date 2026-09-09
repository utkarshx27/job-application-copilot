import { test, expect } from "@playwright/test";
import type { PublicScenario } from "@copilot/test-ats";
import { runPortalFixture, type PortalRun } from "./portal-driver";
import { evaluatePortalOutcome } from "./portal-outcome";

type Ledger = {
  outcomes: {
    applicationId: string;
    jobId: string;
    scenarioId: string;
    correct: boolean;
    acceptedCount: number;
    duplicateAttempts: number;
    uploadRetained: boolean;
  }[];
  sessions: { id: string; jobId: string; stage: string; attempts: number }[];
};
async function runner<T>(path: string, input?: unknown): Promise<T> {
  const token = process.env.PORTAL_RUNNER_TOKEN;
  if (!token) throw new Error("Runner token is missing");
  // Node's fetch is separate from the application browser and its recorded requests.
  const response = await fetch(`http://127.0.0.1:4174${path}`, {
    method: input === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  if (!response.ok) throw new Error(`Runner request failed: ${response.status}`);
  return (await response.json()) as T;
}

for (const scenarioId of ["portal-01", "portal-06"]) {
  test(`portal handoff preserves a non-default job through ${scenarioId}`, async ({ page }) => {
    await runner("/reset", { seed: 7 });
    const fixtures = await runner<{ candidate: Record<string, string>; resume: string }>(
      "/fixtures",
    );
    const response = await fetch("http://127.0.0.1:4173/api/portal/scenarios");
    const scenarios = (await response.json()) as PublicScenario[];
    const scenario = scenarios.find((entry) => entry.id === scenarioId)!;
    await page.goto(`http://127.0.0.1:4173/portal.html?scenario=${scenarioId}&jobId=job-7-1`);
    await expect(
      page.getByRole("heading", { name: "Frontend Engineer at Example Labs", exact: true }),
    ).toBeVisible();
    const run = await runPortalFixture(page, scenario.fields, fixtures.candidate, fixtures.resume);
    expect(run.state).toBe("PAGE_CONFIRMATION");
    expect(run.jobId).toBe("job-7-1");
    const ledger = await runner<Ledger>("/outcomes");
    expect(ledger.sessions).toHaveLength(1);
    expect(ledger.sessions[0]?.jobId).toBe("job-7-1");
    expect(ledger.outcomes).toHaveLength(1);
    expect(ledger.outcomes[0]).toMatchObject({ jobId: "job-7-1", correct: true, acceptedCount: 1 });
  });
}

test("portal handoff rejects expired, missing and ambiguous jobs without opening a session", async ({
  page,
}) => {
  await runner("/reset", { seed: 7 });
  for (const query of [
    "jobId=job-7-6",
    "jobId=job-7-7",
    "jobId=job-8-1",
    "jobId=",
    "jobId=job-7-1&jobId=job-7-2",
  ]) {
    await page.goto(`http://127.0.0.1:4173/portal.html?scenario=portal-01&${query}`);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply locally", exact: true })).toHaveCount(0);
  }
  expect((await runner<Ledger>("/outcomes")).sessions).toHaveLength(0);
});

const cases: [string, PortalRun["state"] | "EVIDENCE"][] = [
  ["greenhouse-native", "PAGE_CONFIRMATION"],
  ["lever-upload", "PAGE_CONFIRMATION"],
  ["ashby-labels", "PAGE_CONFIRMATION"],
  ["smartrecruiters-shadow", "PAGE_CONFIRMATION"],
  ["workday-steps", "PAGE_CONFIRMATION"],
  ["icims-nested-frame", "PAGE_CONFIRMATION"],
  ["taleo-validation", "NEEDS_MANUAL"],
  ["workable-history", "PAGE_CONFIRMATION"],
  ["bamboohr-renamed", "PAGE_CONFIRMATION"],
  ["jobvite-combobox", "PAGE_CONFIRMATION"],
  ["comeet-shadow", "PAGE_CONFIRMATION"],
  ["linkedin-modal", "PAGE_CONFIRMATION"],
  ["naukri-screening", "PAGE_CONFIRMATION"],
  ["wellfound-startup", "PAGE_CONFIRMATION"],
  ["indeed-dialog", "PAGE_CONFIRMATION"],
  ["glassdoor-evidence", "EVIDENCE"],
  ["generic-delayed", "PAGE_CONFIRMATION"],
  ["generic-stale", "PAGE_CONFIRMATION"],
  ["generic-challenge", "PAUSED_ACCESS"],
  ["generic-session", "PAUSED_ACCESS"],
  ["generic-missing-answer", "NEEDS_ANSWER"],
  ["generic-lost-response", "OUTCOME_UNKNOWN"],
  ["generic-false-confirmation", "PAGE_CONFIRMATION"],
  ["generic-wrong-confirmation", "IDENTITY_MISMATCH"],
  ["generic-closed-shadow", "NEEDS_MANUAL"],
  ["generic-external-handoff", "NEEDS_MANUAL"],
  ["generic-closed-tab", "PAUSED_CLOSED_TAB"],
  ["generic-duplicate", "PAGE_CONFIRMATION"],
  ["generic-expired-step", "PAUSED_ACCESS"],
];
for (const [id, expectedState] of cases) {
  test(`portal harness: ${id}`, async ({ page }, testInfo) => {
    await runner("/reset", { seed: 7 });
    const profile = await runner<{
      candidate: Record<string, string>;
      resume: string;
      scenarios: { id: string; publicId: string }[];
    }>("/fixtures");
    const response = await fetch("http://127.0.0.1:4173/api/portal/scenarios");
    const scenarios = (await response.json()) as PublicScenario[];
    const scenario = scenarios.find(
      (item) => item.id === profile.scenarios.find((fixture) => fixture.id === id)?.publicId,
    );
    if (!scenario) throw new Error("Missing public scenario");
    const browserDestinations: string[] = [];
    page.on("request", (request) => {
      browserDestinations.push(request.url());
    });
    await page.goto(`http://127.0.0.1:4173/portal.html?scenario=${scenario.id}`);
    await expect(page.getByRole("heading", { name: scenario.title, exact: true })).toBeVisible();
    if (expectedState === "EVIDENCE") {
      await expect(page.getByText("Rating unavailable", { exact: false })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Example Labs", exact: false, level: 3 }),
      ).toHaveCount(2);
      expect((await runner<Ledger>("/outcomes")).outcomes).toEqual([]);
      return;
    }
    const pending = runPortalFixture(page, scenario.fields, profile.candidate, profile.resume);
    if (id === "generic-closed-tab") {
      await expect(page.getByText("Loading application controls…", { exact: true })).toBeVisible();
      await page.close();
    }
    const run = await pending;
    expect(run.state).toBe(expectedState);
    const accepted =
      ["PAGE_CONFIRMATION", "OUTCOME_UNKNOWN", "IDENTITY_MISMATCH"].includes(expectedState) &&
      id !== "generic-false-confirmation";
    let ledger = await runner<Ledger>("/outcomes");
    expect(ledger.outcomes).toHaveLength(accepted ? 1 : 0);
    if (accepted) {
      expect(ledger.outcomes[0]).toMatchObject({
        scenarioId: id,
        correct: true,
        acceptedCount: 1,
        duplicateAttempts: 0,
      });
      if (id === "lever-upload") expect(ledger.outcomes[0]?.uploadRetained).toBe(true);
    }
    if (id === "generic-duplicate") {
      const duplicate = await fetch(
        `http://127.0.0.1:4173/api/portal/applications/${run.applicationId}/submit`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ consent: true }),
        },
      );
      expect(duplicate.status).toBe(409);
      ledger = await runner<Ledger>("/outcomes");
      expect(ledger.outcomes[0]).toMatchObject({ acceptedCount: 1, duplicateAttempts: 1 });
    }
    if (id.includes("shadow") && expectedState === "PAGE_CONFIRMATION")
      expect(run.strategies).toContain("SHADOW");
    if (id.includes("frame") || id === "workday-steps") expect(run.strategies).toContain("FRAME");
    if (id.includes("combobox") || id === "indeed-dialog")
      expect(run.strategies).toContain("COMBOBOX");
    if (id === "generic-stale") expect(run.strategies).toContain("REOBSERVE");
    if (id === "bamboohr-renamed") expect(run.strategies).toContain("LABEL");
    expect(
      browserDestinations.every((url) => new URL(url).origin === "http://127.0.0.1:4173"),
    ).toBe(true);
    const verdict = evaluatePortalOutcome(run, ledger);
    if (id === "generic-false-confirmation") expect(verdict).toBe("FALSE_CONFIRMATION");
    if (id === "generic-lost-response") expect(verdict).toBe("ACCEPTED_RESPONSE_LOST");
    if (id === "generic-duplicate") expect(verdict).toBe("DUPLICATE_BLOCKED");
    await testInfo.attach("portal-outcome", {
      body: JSON.stringify({ scenarioId: id, run, verdict, ledger }),
      contentType: "application/json",
    });
  });
}

test("portal harness: deterministic search, pagination, duplicate identities and private runner channel", async ({
  page,
}) => {
  await runner("/reset", { seed: 19 });
  const first = (await (await fetch("http://127.0.0.1:4173/api/portal/jobs")).json()) as unknown;
  await runner("/reset", { seed: 19 });
  expect(await (await fetch("http://127.0.0.1:4173/api/portal/jobs")).json()).toEqual(first);
  await page.goto("http://127.0.0.1:4173/portal.html");
  const search = page.getByRole("region", { name: "Job search" });
  await expect(search.getByRole("article")).toHaveCount(3);
  await search.getByRole("button", { name: "Next results" }).click();
  await expect(search.getByText("Job identity: job-19-0", { exact: true })).toBeVisible();
  await search.getByRole("button", { name: "Next results" }).click();
  await expect(search.getByText("Job expired")).toBeVisible();
  await expect(search.getByText("Employer handoff unavailable")).toBeVisible();
  const runnerDenied = await fetch("http://127.0.0.1:4174/fixtures");
  expect(runnerDenied.status).toBe(403);
  const fromBrowser = await fetch("http://127.0.0.1:4174/fixtures", {
    headers: {
      authorization: `Bearer ${process.env.PORTAL_RUNNER_TOKEN ?? ""}`,
      origin: "http://127.0.0.1:4173",
    },
  });
  expect(fromBrowser.status).toBe(403);
  for (const path of [
    "/api/portal/outcomes",
    "/api/portal/fixtures",
    "/dist-server/portal-server.mjs",
    "/server/portal-catalog.ts",
  ])
    expect((await fetch(`http://127.0.0.1:4173${path}`)).status).toBe(404);
  const publicScript = await (await fetch("http://127.0.0.1:4173/portal.js")).text();
  expect(publicScript).not.toContain("SYNTHETIC_CANDIDATE");
  expect(publicScript).not.toContain(process.env.PORTAL_RUNNER_TOKEN);
});

test("portal harness: independent ledger detects swapped compensation despite a successful page", async ({
  page,
}) => {
  await runner("/reset", { seed: 7 });
  const profile = await runner<{
    candidate: Record<string, string>;
    resume: string;
    scenarios: { id: string; publicId: string }[];
  }>("/fixtures");
  const fixtureId = profile.scenarios.find((item) => item.id === "naukri-screening")?.publicId;
  const scenarios = (await (
    await fetch("http://127.0.0.1:4173/api/portal/scenarios")
  ).json()) as PublicScenario[];
  const scenario = scenarios.find((item) => item.id === fixtureId);
  if (!scenario) throw new Error("Missing scenario");
  await page.goto(`http://127.0.0.1:4173/portal.html?scenario=${scenario.id}`);
  await expect(page.getByRole("heading", { name: scenario.title, exact: true })).toBeVisible();
  const swapped = {
    ...profile.candidate,
    currentSalary: profile.candidate.expectedSalary ?? "",
    expectedSalary: profile.candidate.currentSalary ?? "",
  };
  const run = await runPortalFixture(page, scenario.fields, swapped, profile.resume);
  expect(run.state).toBe("PAGE_CONFIRMATION");
  const ledger = await runner<Ledger>("/outcomes");
  expect(evaluatePortalOutcome(run, ledger)).toBe("INCORRECT_APPLICATION");
  expect(ledger.outcomes[0]).toMatchObject({ acceptedCount: 1, correct: false });
});
