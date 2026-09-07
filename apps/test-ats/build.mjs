import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = import.meta.dirname;
const outdir = resolve(root, "dist");
const serverOutdir = resolve(root, "dist-server");

await rm(outdir, { recursive: true, force: true });
await rm(serverOutdir, { recursive: true, force: true });
if (process.argv.includes("--clean")) process.exit(0);

await mkdir(outdir, { recursive: true });
await cp(resolve(root, "public"), outdir, { recursive: true });
await build({
  entryPoints: [resolve(root, "src/frameworks.tsx")],
  outfile: resolve(outdir, "frameworks.js"),
  bundle: true,
  format: "esm",
  target: "chrome120",
  minify: true,
});
await build({
  entryPoints: [resolve(root, "src/portal.ts")],
  outfile: resolve(outdir, "portal.js"),
  bundle: true,
  format: "esm",
  target: "chrome120",
});
await build({
  entryPoints: [resolve(root, "server/portal-server.ts")],
  outfile: resolve(root, "dist-server/portal-server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
});
