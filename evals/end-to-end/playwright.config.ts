import { defineConfig } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { platform, release } from "node:os";
import { resolve } from "node:path";

// Inherited by the server and test workers, never passed to a browser context.
process.env.PORTAL_RUNNER_TOKEN ??= randomBytes(32).toString("hex");

// Snapshot before execution. Never attach runner tokens, environment variables,
// private profiles or fixture answers to the public test report.
const root = resolve(import.meta.dirname, "../..");
function hashes(directory: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(resolve(root, directory), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry): [string, string] => {
        const path = resolve(entry.parentPath, entry.name);
        return [
          path.slice(root.length + 1).replaceAll("\\", "/"),
          createHash("sha256").update(readFileSync(path)).digest("hex"),
        ];
      })
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

export default defineConfig({
  metadata: {
    ag09: {
      capturedAt: new Date().toISOString(),
      environment: { platform: platform(), release: release(), node: process.version },
      buildHashes: hashes("apps/extension/dist-e2e"),
      sourceHashes: {
        ...hashes("apps/extension/src"),
        ...hashes("packages/agent-core/src"),
        ...hashes("apps/test-ats/src"),
        ...hashes("apps/test-ats/server"),
        ...hashes("evals/end-to-end"),
      },
    },
  },
  testDir: ".",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [
    [process.env.CI ? "github" : "list"],
    ["json", { outputFile: resolve(import.meta.dirname, "../../test-results/e2e-results.json") }],
  ],
  outputDir: "../../test-results/playwright",
  webServer: [
    {
      command: "npm run serve --workspace @copilot/test-ats",
      url: "http://127.0.0.1:4173/healthz",
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      command: "npm run dev --workspace @copilot/sync-server",
      url: "http://127.0.0.1:8787/health",
      reuseExistingServer: false,
      timeout: 15_000,
    },
  ],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
