import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const partition = process.argv[2] ?? "development";
if (!["development", "validation", "test"].includes(partition))
  throw new Error("Use development, validation or test");
const env = { ...process.env, AG09_EVALUATION: partition };
function node(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
for (const args of [
  ...(partition === "development"
    ? []
    : [["--experimental-strip-types", "scripts/evaluation-corpus.mjs"]]),
  ["apps/extension/build.mjs", "--e2e"],
  ["apps/test-ats/build.mjs"],
])
  if (node(args)) process.exit(1);
const status = node([
  "node_modules/@playwright/test/cli.js",
  "test",
  "--config",
  "evals/end-to-end/playwright.config.ts",
  "evaluation.spec.ts",
]);
const report = node(["--experimental-strip-types", "scripts/evaluation-report.mjs"]);
process.exitCode = status || report;
