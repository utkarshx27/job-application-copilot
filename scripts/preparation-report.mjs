import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const results = JSON.parse(await readFile(resolve(root, "test-results/e2e-results.json"), "utf8"));
const checks = [];
function walk(suite) {
  for (const spec of suite.specs ?? []) {
    if (!/complete-preparation\.spec\.ts$/.test(spec.file ?? suite.file ?? "")) continue;
    for (const test of spec.tests ?? []) {
      const result = test.results?.at(-1);
      checks.push({
        name: spec.title,
        status: result?.status ?? "missing",
        durationMs: result?.duration ?? null,
        retries: (test.results?.length ?? 1) - 1,
      });
    }
  }
  for (const child of suite.suites ?? []) walk(child);
}
for (const suite of results.suites ?? []) walk(suite);
const snapshot = results.config?.metadata?.ag09;
const provenanceAvailable = Boolean(
  snapshot?.capturedAt &&
  Object.keys(snapshot.sourceHashes ?? {}).length &&
  Object.keys(snapshot.buildHashes ?? {}).length,
);
const report = {
  version: 2,
  generatedAt: new Date().toISOString(),
  testStartedAt: results.stats?.startTime ?? null,
  scope:
    "Local native integrated application regression checks; not a frozen held-out release evaluation",
  provenanceAvailable,
  snapshot: snapshot ?? null,
  model: "none",
  inferenceCostMicros: 0,
  runnerErrors: results.errors ?? [],
  checks,
  passed: checks.filter((c) => c.status === "passed").length,
  total: checks.length,
  releaseGate: {
    status: "OPEN",
    reason:
      "The 300-scenario corpus with 60 frozen test templates and observed five-user study are not established by this development regression suite.",
  },
};
await mkdir(resolve(root, "test-results"), { recursive: true });
await writeFile(
  resolve(root, "test-results/ag09-report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
await writeFile(
  resolve(root, "test-results/ag09-report.md"),
  `# AG-09 local regression report\n\n${report.passed}/${report.total} checks passed. These are test cases, not independent application templates or a live-site success rate.\n\nPre-run provenance: ${provenanceAvailable ? "available" : "MISSING"}. Runner errors: ${report.runnerErrors.length}.\n\n| Check | Result | Retries | Test duration |\n| --- | --- | --- | --- |\n${checks.map((c) => `| ${c.name.replaceAll("|", "/")} | ${c.status} | ${c.retries} | ${c.durationMs === null ? "Unknown" : (c.durationMs / 1000).toFixed(1) + " s"} |`).join("\n")}\n\nInference: deterministic, zero model calls. The pre-run source/build snapshot and environment, when available, are in ag09-report.json. Retries or missing provenance prevent a clean regression result.\n\nRelease gate: OPEN. ${report.releaseGate.reason}\n`,
);
console.log(
  `AG-09: ${report.passed}/${report.total} regression checks passed. Report: test-results/ag09-report.md`,
);
if (
  !provenanceAvailable ||
  !checks.length ||
  checks.some((c) => c.status !== "passed" || c.retries > 0) ||
  (results.errors?.length ?? 0) > 0
) {
  console.error(
    "AG-09 regression evidence is incomplete, failed, retried, or missing pre-run provenance.",
  );
  process.exitCode = 1;
}
