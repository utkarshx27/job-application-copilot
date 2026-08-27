import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = import.meta.dirname;
const outdir = resolve(root, "dist");

await rm(outdir, { recursive: true, force: true });
if (process.argv.includes("--clean")) process.exit(0);

await mkdir(outdir, { recursive: true });
await cp(resolve(root, "public"), outdir, { recursive: true });
