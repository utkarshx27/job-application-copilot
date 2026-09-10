import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { platform, release } from "node:os";

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
const files = [
  "apps/extension/src/job-preparation-controller.ts",
  "apps/extension/src/portal-preparation-executor.ts",
  "apps/extension/src/portal-preparation-document.ts",
  "packages/agent-core/src/index.ts",
  "packages/agent-core/src/job-preparation.ts",
  "apps/test-ats/server/portal-catalog.ts",
  "apps/test-ats/server/portal-server.ts",
  "evals/end-to-end/complete-preparation.spec.ts",
];
const sourceHashes = Object.fromEntries(
  await Promise.all(
    files.map(async (path) => [
      path,
      createHash("sha256")
        .update(await readFile(resolve(root, path)))
        .digest("hex"),
    ]),
  ),
);
const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  scope:
    "Local native integrated application regression checks; not a frozen held-out release evaluation",
  environment: { platform: platform(), release: release(), node: process.version },
  model: "none",
  inferenceCostMicros: 0,
  sourceHashes,
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
  `# AG-09 local regression report\n\n${report.passed}/${report.total} checks passed. These are test cases, not independent application templates or a live-site success rate.\n\n| Check | Result | Test duration |\n| --- | --- | --- |\n${checks.map((c) => `| ${c.name.replaceAll("|", "/")} | ${c.status} | ${c.durationMs === null ? "Unknown" : (c.durationMs / 1000).toFixed(1) + " s"} |`).join("\n")}\n\nInference: deterministic, zero model calls. Full source hashes and environment are in ag09-report.json.\n\nRelease gate: OPEN. ${report.releaseGate.reason}\n`,
);
console.log(
  `AG-09: ${report.passed}/${report.total} regression checks passed. Report: test-results/ag09-report.md`,
);
if (!checks.length || checks.some((c) => c.status !== "passed")) process.exitCode = 1;
