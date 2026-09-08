import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const directory = resolve(".tmp/inference-benchmark");
await mkdir(directory, { recursive: true });
const outfile = resolve(directory, "run.mjs");
await build({
  entryPoints: [resolve("scripts/inference-benchmark.ts")],
  outfile,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
});
await import(pathToFileURL(outfile).href);
