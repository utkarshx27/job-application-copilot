import { build } from "esbuild";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = import.meta.dirname;
const outdir = resolve(root, "dist");
await rm(outdir, { recursive: true, force: true });
await build({
  entryPoints: [resolve(root, "src/index.ts")],
  outfile: resolve(outdir, "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
});
