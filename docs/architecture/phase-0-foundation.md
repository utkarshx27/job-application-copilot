# Phase 0 — Engineering Foundation

Phase 0 is complete when the extension builds, loads in Chromium, opens its side panel, communicates with the service worker and content script, and rejects commands outside the typed runtime protocol.

## Implemented

- npm workspaces monorepo with shared TypeScript configuration.
- ESLint, Prettier, Vitest, and GitHub Actions CI.
- Manifest V3 extension with action-opened side panel and minimal permissions.
- Runtime-validated panel and content-script messages.
- Allowlisted browser command schema with no arbitrary JavaScript command.
- Versioned candidate truth, form snapshot, fixture, and site-policy schemas.
- Accessible visible-form scanner that excludes passwords and hidden controls.
- Controlled Test ATS application with standard and dynamic fields.
- Sanitized, schema-validated generic ATS fixture.
- Playwright persistent-Chromium harness for unpacked extension testing.
- End-to-end coverage for side panel → service worker → content script → page scan.

The E2E manifest adds access only to `http://127.0.0.1/*`. This test-only permission is generated into `apps/extension/dist-e2e` and is not present in the production manifest or `apps/extension/dist`.

## Verification

Run the complete Phase 0 gate:

```bash
npm run check:phase0
```

The first machine setup also requires Playwright's bundled Chromium:

```bash
npx playwright install chromium
```

Unit tests cover schemas, policy, command rejection, accessible names, sensitive control exclusion, and duplicate control IDs. Browser smoke tests load the unpacked MV3 extension and compare a live page scan with the committed sanitized fixture.
