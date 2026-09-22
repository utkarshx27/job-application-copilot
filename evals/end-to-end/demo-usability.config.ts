import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Only these panel tests may share a running demo server. They do not use the
// authenticated runner/reset API or submit applications. Each gets a fresh
// isolated extension profile, never the user's Chrome profile.
export default defineConfig({
  ...base,
  testMatch: ["demo-usability.spec.ts", "discovery.spec.ts"],
  webServer: (Array.isArray(base.webServer) ? base.webServer : []).map((server) => ({
    ...server,
    reuseExistingServer: true,
  })),
});
