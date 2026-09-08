import { context } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = import.meta.dirname;
const watch = process.argv.includes("--watch");
const cleanOnly = process.argv.includes("--clean");
const e2e = process.argv.includes("--e2e");
const research = process.argv.includes("--research");
const outdir = resolve(root, e2e ? "dist-e2e" : research ? "dist-research" : "dist");

if (cleanOnly) {
  await Promise.all(
    ["dist", "dist-e2e", "dist-research"].map((directory) =>
      rm(resolve(root, directory), { recursive: true, force: true }),
    ),
  );
  process.exit(0);
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
if (e2e || research) manifest.host_permissions = ["http://127.0.0.1/*"];
if (e2e || research) manifest.optional_permissions = ["debugger"];
if (research) manifest.name += " (Research)";

await Promise.all([
  writeFile(resolve(outdir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`),
  cp(resolve(root, "src/sidepanel/index.html"), resolve(outdir, "sidepanel.html")),
  cp(resolve(root, "src/sidepanel/styles.css"), resolve(outdir, "sidepanel.css")),
  cp(
    resolve(root, "../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
    resolve(outdir, "pdf.worker.mjs"),
  ),
  cp(resolve(root, "../../node_modules/pdfjs-dist/wasm"), resolve(outdir, "pdf-wasm"), {
    recursive: true,
  }),
  cp(
    resolve(root, "../../node_modules/pdfjs-dist/standard_fonts"),
    resolve(outdir, "pdf-standard-fonts"),
    { recursive: true },
  ),
]);

const shared = {
  define: { __AGENT_LAB_BUILD__: JSON.stringify(e2e || research) },
  bundle: true,
  minify: !watch,
  sourcemap: watch,
  target: "chrome120",
  logLevel: "info",
};

const worker = await context({
  ...shared,
  entryPoints: [resolve(root, "src/background.ts")],
  outfile: resolve(outdir, "background.js"),
  format: "esm",
});
const content = await context({
  ...shared,
  entryPoints: [resolve(root, "src/content.ts")],
  outfile: resolve(outdir, "content.js"),
  format: "iife",
});
const panel = await context({
  ...shared,
  entryPoints: [resolve(root, "src/sidepanel/main.tsx")],
  outfile: resolve(outdir, "sidepanel.js"),
  format: "esm",
});

const contexts = [worker, content, panel];
if (e2e || research)
  contexts.push(
    await context({
      ...shared,
      entryPoints: [resolve(root, "src/agent-execution-content.ts")],
      outfile: resolve(outdir, "agent-execution.js"),
      format: "iife",
    }),
  );
if (watch) {
  await Promise.all(contexts.map((item) => item.watch()));
  console.log("Watching extension sources…");
} else {
  await Promise.all(contexts.map((item) => item.rebuild()));
  await Promise.all(contexts.map((item) => item.dispose()));
}
