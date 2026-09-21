import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const { evaluationCorpus, evaluationScenario, CORPUS_VERSION, EVALUATION_SEEDS } = await import(
  process.env.AG09_CORPUS === "v2"
    ? "../apps/test-ats/server/evaluation-corpus-v2.ts"
    : "../apps/test-ats/server/evaluation-corpus.ts"
);

const root = resolve(import.meta.dirname, "..");
const path = resolve(
  root,
  `evals/corpus/ag09-${process.env.AG09_CORPUS === "v2" ? "v2" : "v1"}.json`,
);
const scenarios = evaluationCorpus().map((item) => ({
  ...item,
  scenario: evaluationScenario(item.id, 0),
}));
const digest = createHash("sha256").update(JSON.stringify(scenarios)).digest("hex");
if (process.argv.includes("--freeze")) {
  await mkdir(resolve(root, "evals/corpus"), { recursive: true });
  await writeFile(
    path,
    JSON.stringify(
      {
        version: CORPUS_VERSION,
        frozenAt: new Date().toISOString(),
        digest,
        seeds: EVALUATION_SEEDS,
        grouping: "field-set family; shared renderer, not independent employers",
        correctionPolicy:
          "Original development job 9: user-reviewed Annual earnings -> COMP.current_compensation. No held-out correction saving or workflow activation.",
        scenarios,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(`Frozen ${scenarios.length} scenarios: ${digest}`);
} else {
  const existing = JSON.parse(await readFile(path, "utf8"));
  const storedDigest = createHash("sha256")
    .update(JSON.stringify(existing.scenarios))
    .digest("hex");
  if (
    existing.digest !== digest ||
    storedDigest !== digest ||
    JSON.stringify(existing.seeds) !== JSON.stringify(EVALUATION_SEEDS)
  )
    throw new Error("Frozen corpus checksum mismatch");
  console.log(`Verified ${scenarios.length} frozen scenarios: ${digest}`);
}
