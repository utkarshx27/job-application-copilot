# Job Application Copilot

[![CI](https://github.com/utkarshx27/job-application-copilot/actions/workflows/ci.yml/badge.svg)](https://github.com/utkarshx27/job-application-copilot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A local-first, user-controlled Chrome extension for safely assisting with job application forms. The project is designed around verified candidate facts, deterministic ATS adapters, explicit review, and a strict separation between autofill and submission.

> [!IMPORTANT]
> This project is an early-stage copilot. It can manage a local candidate profile and fill explicitly reviewed, high-confidence fields, but it does not navigate through or submit job applications.

## Project status

Phases 0 through 6 are complete. Phase 6 extends the deterministic application flow to Ashby and SmartRecruiters:

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
- Deterministic R0/R1 semantic field mapping with calibrated confidence.
- Review UI with per-field selection, reasons, confidence, and highlight mode.
- Service-worker-revalidated fill plans with no page-supplied values.
- React-safe and Vue-safe text, select, radio, checkbox, and textarea drivers.
- User-edit detection that prevents later copilot overwrites.
- Dynamic-form rescanning and controlled React/Vue Test ATS fixtures.
- Greenhouse and Lever detection with adapter-specific field rules.
- Normalized job extraction, requisition identity, and local job snapshots.
- Explicit custom-question review for unmatched text and native select controls.
- Hash-verified, short-lived approval for one selected PDF/DOCX résumé upload.
- Confirmation-page detection and local APPLYING/APPLIED tracker transitions.
- Sanitized Greenhouse/Lever fixtures and controlled Chromium flows.
- Read-only public-form QA capture with isolated browser sessions and blocked mutating requests.
- Sanitized metadata replay, separate human ground truth, prioritized review queues, and gate metrics.
- Versioned canonical question ontology with aliases, keyword rules, and local semantic matching.
- Explicit risk policies that separate current authorization, current sponsorship, and future sponsorship.
- Company, country, role, application, and global saved-response scopes with context enforcement.
- Teach-once custom-answer controls that default to not saving and always require review before fill.
- Answer expiry, stale-response prompts, and a hard ban on sensitive-answer inference or reuse.
- Provider-neutral, schema-validated AI tasks with bounded retries, timeouts, and content-free audits.
- Optional OpenAI Responses adapter with strict structured output, no tools, and `store: false`.
- Session-only API configuration that is excluded from profiles, backups, page fields, and audit records.
- Deterministic-first narrative classification and minimized professional evidence selection.
- Unsupported-claim, sensitive-data, prompt-injection, and hard character-limit blockers.
- Evidence-visible draft review with separate use-draft and reviewed-fill actions.
- Ashby and SmartRecruiters detection, normalized job extraction, field rules, résumé upload, and confirmation tracking.
- Dynamic-question rescanning and safe discovery of ARIA combobox, listbox, checkbox, and radio controls.
- Custom ATS widgets remain visible but manual-only; the extension never simulates arbitrary component clicks.

Ashby and SmartRecruiters follow the same review and safety boundaries as Greenhouse and Lever. Native supported controls can be filled after review; custom role-based widgets are detected, explained, and left for the user. Next is the dedicated Phase 7 Workday workstream. See the [Phase 6 architecture](./docs/architecture/phase-6-ashby-smartrecruiters.md), the [Phase 5 grounded AI architecture](./docs/architecture/phase-5-grounded-ai.md), and the full [implementation blueprint](./IMPLEMENTATION_Job_Application_Copilot.md).

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
  form-engine/               Semantic mapping, confidence, and reviewed fill planning
  ai-gateway/                Provider-neutral structured AI tasks and adapters
  grounded-generation/       Evidence selection, policy, claims, and draft validation
  question-ontology/         Versioned questions, risk, aliases, and deterministic classification
  saved-response-engine/     Scoped matching, freshness, and teach-once response policy
  job-schema/                Job, ATS, upload, confirmation, and tracker contracts
  ats-core/                  Shared adapter interfaces and bounded page parsing
  ats-greenhouse/            Greenhouse detector, extraction, and field rules
  ats-lever/                 Lever detector, extraction, and field rules
  ats-ashby/                 Ashby detector, extraction, and field rules
  ats-smartrecruiters/       SmartRecruiters detector, extraction, and field rules
  ats-qa/                    Sanitization, replay metrics, and human-review contracts
  application-state/         Local application tracker transitions
  profile-core/              Truth Vault, versioning, migration, and import review
  resume-parser/             Conservative local résumé text parser
  shared/                    Site policy and shared utilities
fixtures/ats/                Sanitized ATS regression fixtures
qa/ats/                      Public-form QA URL template and manual-review workflow
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
npm run check:phase2
npm run check:phase3
npm run check:phase4
npm run check:phase5
npm run check:phase6
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
6. Open the extension side panel and choose **Scan and match visible form**.

The controlled site includes `/ashby.html` and `/smartrecruiters.html` alongside the existing Greenhouse and Lever pages when `npm run serve --workspace @copilot/test-ats` is running.

AI drafting is optional. In the Observe tab, enter an OpenAI model and API key and enable it for the current browser session. The extension asks for access only to the OpenAI API origin. For an eligible narrative question, choose **Draft with grounded AI**, inspect the draft and evidence IDs, choose **Use this draft in review**, edit it if needed, and finally choose **Fill reviewed custom answers**. No AI action navigates or submits the application.

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
npm run check:phase2     # Complete Phase 2 release gate
npm run check:phase3     # Controlled Phase 3 gate
npm run check:phase4     # Complete Phase 4 release gate
npm run check:phase5     # Complete Phase 5 release gate
npm run check:phase6     # Complete Phase 6 release gate
```

The E2E build receives access only to `http://127.0.0.1/*`. That test-only permission is generated into `apps/extension/dist-e2e` and is never included in the production manifest.

The Phase 3 public-form gate is driven by the read-only commands below. See [the QA workflow](./qa/ats/README.md) for the exact manual checks and privacy rules.

```bash
npm run ats:qa:capture -- --input qa/ats/urls.local.json
npm run ats:qa:init-review
npm run ats:qa:replay
```

## Safety and privacy

- The extension does not submit applications.
- Fields are filled only after explicit side-panel review; navigation and submission remain manual.
- Résumé upload requires selecting the exact file and pressing a separate approval button; raw files are not retained.
- LinkedIn is manual-only and is not scanned.
- Password and hidden fields are excluded from discovery.
- Government IDs, banking details, credentials, and arbitrary file access are outside the command protocol.
- Real candidate information must never be committed in fixtures or test data.
- Résumé files are parsed locally, limited to 5 MB, and are not retained as raw files.
- JSON exports are not encrypted and must be stored securely by the user.
- Tests against real employer sites must stop before submission.
- Public QA capture never types, clicks, uploads, submits, or retains browser session data.
- Saved answers remain local, default to not being stored, expire by question policy, and are never reused for R4 sensitive questions.
- AI provider keys are stored only in `chrome.storage.session`; they are never added to profile data, backups, page fields, or audit records.
- Question classification receives no candidate profile. Draft generation receives only selected verified professional facts and bounded job context.
- AI output cannot issue browser commands and never fills automatically. Invalid, unsupported, sensitive, or over-limit drafts are withheld.
- Role-based custom ATS widgets are scanned as manual-only controls and cannot be targeted by the native fill driver.

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](./CONTRIBUTING.md), follow the [Code of Conduct](./CODE_OF_CONDUCT.md), and run `npm run check:phase6` before opening a pull request.

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
