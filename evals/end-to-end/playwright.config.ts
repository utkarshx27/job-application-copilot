import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? "github" : "list",
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
