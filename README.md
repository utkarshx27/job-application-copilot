# Job Application Copilot

[![CI](https://github.com/utkarshx27/job-application-copilot/actions/workflows/ci.yml/badge.svg)](https://github.com/utkarshx27/job-application-copilot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A local-first, user-controlled Chrome extension for safely assisting with job application forms. The project is designed around verified candidate facts, deterministic ATS adapters, explicit review, and a strict separation between autofill and submission.

> [!IMPORTANT]
> This project is an early-stage copilot. It can manage a local candidate profile and scan forms in Observe Mode, but it does not yet fill or submit job applications.

## Project status

Phases 0 and 1 are complete:

- Manifest V3 extension and React side panel.
- Runtime-validated side panel, service worker, and content-script messaging.
- Candidate truth, form, fixture, command, and site-policy schemas.
- Accessible visible-form scanner.
- Password and hidden-control exclusion.
- Controlled Test ATS and sanitized regression fixture.
- Unit, schema, and real Chromium extension tests.
- GitHub Actions release gate.
- Versioned local candidate Truth Vault backed by `chrome.storage.local`.
- Manual profile editor with explicit sensitivity handling.
- Validated JSON backup, restore, and stored-profile migration.
- Local PDF and DOCX résumé extraction with SHA-256 source records.
- Reviewable document-derived facts, conflict resolution, and user verification.
- Sanitized résumé fixtures and Chromium coverage for both file formats.

Phase 2 is next and will expand the generic form engine with semantic mapping, confidence, highlighting, safe fill drivers, and user-edit detection. See the full [implementation blueprint](./IMPLEMENTATION_Job_Application_Copilot.md), [Phase 0 completion notes](./docs/architecture/phase-0-foundation.md), and [Phase 1 completion notes](./docs/architecture/phase-1-truth-vault.md).

## Design principles

- **Truthful by construction:** generated content cannot redefine candidate facts.
- **Local first:** basic profile and autofill functionality must not require cloud storage.
- **User controlled:** review and final submission remain user actions.
- **Deterministic before AI:** known fields use tested rules; AI is reserved for appropriate open-text assistance.
- **Unknown is not No:** ambiguous or missing facts must be reviewed, never silently converted.
- **Pages are untrusted:** browser commands are allowlisted and webpage text is treated as data.
- **Graceful fallback:** unsupported sites should still offer useful copy assistance.

## Repository structure

```text
apps/
  extension/                 Manifest V3 extension and side panel
  test-ats/                  Controlled synthetic application site
packages/
  browser-command-schema/    Runtime and browser command allowlists
  candidate-schema/          Candidate truth model
  form-schema/               Form snapshot and fixture contracts
  profile-core/              Truth Vault, versioning, migration, and import review
  resume-parser/             Conservative local résumé text parser
  shared/                    Site policy and shared utilities
fixtures/ats/                Sanitized ATS regression fixtures
evals/end-to-end/            Playwright extension tests
docs/                        Architecture and engineering notes
```

## Prerequisites

- Node.js 22 or newer
- npm 11 or newer
- Chrome or another Chromium browser for manual extension loading

## Getting started

```bash
git clone https://github.com/utkarshx27/job-application-copilot.git
cd job-application-copilot
npm install
npx playwright install chromium
npm run check:phase1
```

Build the production extension:

```bash
npm run build
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select `apps/extension/dist`.
5. Open an employer or controlled application form.
6. Open the extension side panel and choose **Scan visible form**.

For automatic rebuilds during extension development:

```bash
npm run dev --workspace @copilot/extension
```

## Testing

```bash
npm test                 # Unit and schema tests
npm run test:e2e         # Unpacked-extension tests in bundled Chromium
npm run check:phase0     # Complete Phase 0 release gate
npm run check:phase1     # Complete Phase 1 release gate
```

The E2E build receives access only to `http://127.0.0.1/*`. That test-only permission is generated into `apps/extension/dist-e2e` and is never included in the production manifest.

## Safety and privacy

- The extension does not submit applications.
- LinkedIn is manual-only and is not scanned.
- Password and hidden fields are excluded from discovery.
- Government IDs, banking details, credentials, and arbitrary file access are outside the command protocol.
- Real candidate information must never be committed in fixtures or test data.
- Résumé files are parsed locally, limited to 5 MB, and are not retained as raw files.
- JSON exports are not encrypted and must be stored securely by the user.
- Tests against real employer sites must stop before submission.

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](./CONTRIBUTING.md), follow the [Code of Conduct](./CODE_OF_CONDUCT.md), and run `npm run check:phase1` before opening a pull request.

Good early contribution areas include:

- Candidate schema and migration tests.
- Accessibility improvements.
- Generic form scanner fixtures.
- Security and prompt-injection regression cases.
- Documentation and developer experience.

Please do not submit real applications, personal résumés, authentication data, or unsanitized employer pages as test fixtures.

## Security

Do not report sensitive vulnerabilities in public issues. Follow [SECURITY.md](./SECURITY.md) to submit a private GitHub security advisory.

## Disclaimer

This project is not affiliated with Greenhouse, Lever, Ashby, Workday, LinkedIn, or any other ATS or job platform. Users and contributors are responsible for complying with applicable site terms, laws, and employer policies.

## License

Licensed under the [MIT License](./LICENSE).
