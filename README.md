# Job Application Copilot

[![CI](https://github.com/utkarshx27/job-application-copilot/actions/workflows/ci.yml/badge.svg)](https://github.com/utkarshx27/job-application-copilot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A local-first, user-controlled Chrome extension for safely assisting with job application forms. The project is designed around verified candidate facts, deterministic ATS adapters, explicit review, and a strict separation between autofill and submission.

> [!IMPORTANT]
> This project is an early-stage copilot. It can manage a local candidate profile and fill explicitly reviewed, high-confidence fields, but it does not navigate through or submit job applications.

## Project status

Phases 0 through 6 and Phases 8 through 10 are complete as controlled implementations. Phase 7 has a complete controlled Workday implementation; its separate 250-form public validation gate remains open:

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
- Workday tenant/site detection, normalized job extraction, authentication-boundary explanations, and confirmation tracking.
- Read-only Workday SPA step modeling with persisted local progress and refresh recovery.
- Privacy-preserving prefilled-state detection: résumé/account-parsed values are never captured and are protected from overwrite.
- Deterministic first-record work-history and education mappings, manual-only skill widgets, and dynamic questionnaire rescanning.
- Controlled Test ATS auto-next with default-off global and per-application opt-ins, a cancelable countdown, persisted one-shot intents, exact Workday Next evidence, and verified transitions.
- Controlled Test ATS submission with a separate state machine, final summary, on-page attestation, dual opt-in, explicit authorization, cancelable countdown, one dispatch, and verified confirmation.
- Real ATS navigation and submission remain disabled; the submission command is valid only for the exact local Workday Test ATS review fixture.
- Version 2 local tracker with automatic preservation and migration of version 1 application history.
- Canonical ATS requisition/URL job identities and append-only, changed-only job snapshots.
- Evidence-backed duplicate warnings for existing records, requisitions, URLs, and matching job details.
- Editable lifecycle statuses, summary counts, filters, and accessible board/table tracker views.
- Validated CSV import/export with per-row errors and spreadsheet-formula neutralization.
- Deterministic iCIMS, Taleo, Workable, BambooHR, Jobvite, and Comeet adapters.
- JSON-LD-first job extraction with platform-specific host, DOM, and requisition-route evidence.
- Sanitized metadata fixtures and real Chromium reviewed-fill/résumé-upload coverage for all six Phase 9 ATS platforms.
- Opt-in encrypted sync for the validated profile vault and application tracker while local-only mode remains the default.
- Separate passphrase-derived authentication and AES-256-GCM keys; the server stores ciphertext and cannot read synchronized records.
- Session-only unlock keys, optimistic revision conflicts, device listing/revocation, encrypted backup, and account-wide cloud deletion.
- Self-hostable Fastify sync service with atomic JSON persistence for controlled/local deployments.
- Runtime-requested optional host access and a real Chromium create-account, backup, and session-lock test.

Phase 12 is complete for the controlled local Workday Test ATS only. Real Workday and every other real ATS remain manual for navigation and submission. Production submission requires a separate security, policy, staging, and canary release decision. See the [Phase 12 architecture](./docs/architecture/phase-12-controlled-submission.md), [Phase 11 architecture](./docs/architecture/phase-11-controlled-auto-next.md), [Workday QA workflow](./qa/workday/README.md), and the full [implementation blueprint](./IMPLEMENTATION_Job_Application_Copilot.md).

## Design principles

- **Truthful by construction:** generated content cannot redefine candidate facts.
- **Local first:** basic profile and autofill functionality must not require cloud storage.
- **User controlled:** review and real-world submission remain user actions; the synthetic Test ATS requires multiple explicit approvals.
- **Deterministic before AI:** known fields use tested rules; AI is reserved for appropriate open-text assistance.
- **Unknown is not No:** ambiguous or missing facts must be reviewed, never silently converted.
- **Pages are untrusted:** browser commands are allowlisted and webpage text is treated as data.
- **Graceful fallback:** unsupported sites should still offer useful copy assistance.

## Repository structure

```text
apps/
  extension/                 Manifest V3 extension and side panel
  sync-server/               Optional encrypted sync API and storage
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
  ats-workday/               Workday detector, workflow model, and safe field rules
  ats-icims/                 iCIMS detector, extraction, and field rules
  ats-taleo/                 Oracle Taleo detector, extraction, and field rules
  ats-workable/              Workable detector, extraction, and field rules
  ats-bamboohr/              BambooHR detector, extraction, and field rules
  ats-jobvite/               Jobvite detector, extraction, and field rules
  ats-comeet/                Comeet detector, extraction, and field rules
  ats-qa/                    Sanitization, replay metrics, and human-review contracts
  application-state/         Local application tracker transitions
  profile-core/              Truth Vault, versioning, migration, and import review
  resume-parser/             Conservative local résumé text parser
  sync-core/                 Encryption, sync schemas, revisions, and conflict merging
  navigation-core/           Controlled Next readiness, persisted intents, and metrics
  submission-core/           Test ATS submission policy, one-shot intents, and metrics
  shared/                    Site policy and shared utilities
fixtures/ats/                Sanitized ATS regression fixtures
qa/ats/                      Public-form QA URL template and manual-review workflow
qa/workday/                  Workday multi-step pre-submit validation workflow
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
npm run check:phase7
npm run check:phase8
npm run check:phase9
npm run check:phase10
npm run check:phase11
npm run check:phase12
```

Build the production extension:

```bash
npm run build
```

Run the optional local sync server in a separate terminal:

```bash
npm run dev --workspace @copilot/sync-server
```

Then open the extension's **Sync** tab and use `http://127.0.0.1:8787`. The server persists encrypted records under `.tmp/sync-server/state.json` by default. This local JSON repository is for controlled/self-hosted development; review the [Phase 10 production-hardening requirements](./docs/architecture/phase-10-optional-cloud-sync.md) before exposing it to the internet.

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select `apps/extension/dist`.
5. Open an employer or controlled application form.
6. Open the extension side panel and choose **Scan and match visible form**.

The controlled site includes `/ashby.html`, `/smartrecruiters.html`, `/workday.html`, `/icims.html`, `/taleo.html`, `/workable.html`, `/bamboohr.html`, `/jobvite.html`, and `/comeet.html` alongside the existing Greenhouse and Lever pages when `npm run serve --workspace @copilot/test-ats` is running. The Workday fixture preserves its current step across refreshes. On that exact local fixture only, the Observe tab can enable experimental auto-next. On Review, controlled submission additionally requires all steps to have been scanned, the page attestation, separate submission flags, final summary authorization, and a five-second cancellation window.

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
npm run check:phase7     # Controlled Phase 7 gate; public Workday validation is separate
npm run check:phase8     # Complete Phase 8 tracker and duplicate-engine gate
npm run check:phase9     # Controlled Phase 9 additional-ATS gate
npm run check:phase10    # Controlled Phase 10 encrypted-sync gate
npm run check:phase11    # Controlled Phase 11 one-shot auto-next gate
npm run check:phase12    # Controlled Phase 12 Test ATS submission gate
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
- Fields are filled only after explicit side-panel review. Navigation and submission remain manual on real sites. The exact local Workday Test ATS alone exposes separately enabled one-shot Next and submission test paths.
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
- Existing values are represented only as an empty/prefilled state; their contents are not captured, and reviewed fill plans cannot overwrite them.
- Real Workday authentication, Back, Next, and Submit remain manual. Fixed-token Next and Submit plans are restricted to the exact local Test ATS fixture, with separate persisted state machines and no generic selector command.
- Duplicate detection is advisory and local; it never merges applications or blocks user actions.
- Tracker CSV exports can contain application history and should be stored securely.
- Phase 9 custom ATS widgets, unknown questions, salary, references, consent, and disclosures remain manual or explicitly reviewed.
- Cloud sync is optional. The passphrase and readable profile/tracker records are not sent to the server, and unlock material is session-only.
- Signing into an existing sync account restores its cloud profile/tracker on that browser; export local data first if it must be preserved.
- The included JSON-backed sync server is a controlled MVP, not an internet-scale identity or disaster-recovery service.

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](./CONTRIBUTING.md), follow the [Code of Conduct](./CODE_OF_CONDUCT.md), and run `npm run check:phase12` before opening a pull request.

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

This project is not affiliated with Greenhouse, Lever, Ashby, SmartRecruiters, Workday, iCIMS, Oracle Taleo, Workable, BambooHR, Jobvite, Comeet, LinkedIn, or any other ATS or job platform. Users and contributors are responsible for complying with applicable site terms, laws, and employer policies.

## License

Licensed under the [MIT License](./LICENSE).
