import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const corpusVersion = process.env.AG09_CORPUS === "v2" ? "v2" : "v1";
const { evaluationCorpus, EVALUATION_SEEDS } = await import(
  corpusVersion === "v2"
    ? "../apps/test-ats/server/evaluation-corpus-v2.ts"
    : "../apps/test-ats/server/evaluation-corpus.ts"
);
import { scoreEvaluation } from "../apps/test-ats/server/evaluation-score.ts";

const root = resolve(import.meta.dirname, "..");
const results = JSON.parse(await readFile(resolve(root, "test-results/e2e-results.json"), "utf8"));
const partition = process.env.AG09_EVALUATION;
if (!["development", "validation", "test"].includes(partition))
  throw new Error("Specify AG09_EVALUATION partition");
const all = evaluationCorpus().filter((item) => item.partition === partition);
const cases = all.slice(
  0,
  partition === "development" ? Number(process.env.AG09_LIMIT ?? all.length) : all.length,
);
const observations = [];
const failures = [];
function walk(suite) {
  for (const spec of suite.specs ?? [])
    for (const test of spec.tests ?? []) {
      if (!spec.title.startsWith("evaluation ")) continue;
      const result = test.results?.at(-1);
      if (result?.status !== "passed" || test.results.length !== 1)
        failures.push({ title: spec.title, status: result?.status ?? "missing" });
      // A timed-out/failed test cannot contribute a successful observation.
      else
        for (const annotation of test.annotations ?? [])
          if (annotation.type === "ag09-evaluation")
            observations.push(JSON.parse(annotation.description));
    }
  for (const child of suite.suites ?? []) walk(child);
}
for (const suite of results.suites ?? []) walk(suite);
const metrics = scoreEvaluation(
  cases,
  partition === "development" ? [EVALUATION_SEEDS[0]] : EVALUATION_SEEDS,
  observations,
);
const report = {
  version: 1,
  corpusVersion,
  corpus:
    partition === "development"
      ? null
      : JSON.parse(await readFile(resolve(root, `evals/corpus/ag09-${corpusVersion}.json`), "utf8"))
          .digest,
  model: "none; deterministic controller with fixed development-reviewed correction arm",
  inferenceCostMicros: 0,
  partition,
  generatedAt: new Date().toISOString(),
  testStartedAt: results.stats?.startTime,
  snapshot: results.config?.metadata?.ag09 ?? null,
  failures,
  runnerErrors: results.errors ?? [],
  metrics,
  observations,
};
await mkdir(resolve(root, "test-results/evaluation"), { recursive: true });
const name = `${corpusVersion}-${partition}-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
await writeFile(
  resolve(root, `test-results/evaluation/${name}.json`),
  JSON.stringify(report, null, 2) + "\n",
);
const fraction = (value) => `${value.numerator}/${value.denominator}`;
await writeFile(
  resolve(root, `test-results/evaluation/${name}.md`),
  `# AG-09 ${partition} evaluation\n\nBaseline runs: ${metrics.measuredBaselineRuns}/${metrics.baselineRuns}; grouped schemas: ${metrics.schemaGroups}. These scenarios share one renderer and are not independent websites.\n\n- Correct completion: ${fraction(metrics.completion)}\n- No additional input after approvals: ${fraction(metrics.noExtraInput)}\n- Recovery: ${fraction(metrics.recovery)}\n- Correct boundary handling: ${fraction(metrics.boundary)}\n- Critical failures: ${metrics.criticalFailures}\n- Duplicate attempts: ${metrics.duplicateAttempts}\n- Correction pairs: ${metrics.correction.completePairs}/${metrics.correction.plannedPairs}; prompt reduction: ${metrics.correction.relativePromptReduction ?? "unavailable"}\n- Harness failures: ${failures.length}\n\nRelease acceptance: OPEN. Missing evidence: ${metrics.unmeasured.join("; ")}. Final submission still needs separate user approval.\n`,
);
console.log(JSON.stringify(metrics, null, 2));
console.log(`Report: test-results/evaluation/${name}.md`);
if (
  failures.length ||
  report.runnerErrors.length ||
  !report.snapshot ||
  !metrics.measuredGatesPassed
)
  process.exitCode = 1;
