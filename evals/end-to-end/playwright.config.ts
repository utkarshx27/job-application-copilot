import { defineConfig } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

// Inherited by the server and test workers, never passed to a browser context.
process.env.PORTAL_RUNNER_TOKEN ??= randomBytes(32).toString("hex");

export default defineConfig({
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
