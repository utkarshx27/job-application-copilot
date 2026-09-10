# Contributing

Thanks for helping build Job Application Copilot. Accuracy, user control, privacy, and maintainability matter more than raw automation coverage.

## Before you start

- Search existing issues before opening a new one.
- Use an issue to discuss large architectural changes before implementation.
- Keep changes focused and avoid unrelated rewrites.
- Never include real candidate data, credentials, session tokens, CSRF tokens, or unsanitized employer pages.
- Never submit a test application to a real employer.

## Local setup

```bash
npm install
npx playwright install chromium
npm run verify
```

Node.js 22+ and npm 11+ are required.

## Development workflow

1. Fork the repository.
2. Create a branch from `main`.
3. Add or update tests with the implementation.
4. Run formatting and the relevant focused tests while developing.
5. Run `npm run verify` before opening a pull request.
6. Explain behavior changes, safety impact, and verification in the pull request.

When contributing public ATS QA fixtures, follow [`qa/ats/README.md`](./qa/ats/README.md). Never commit the raw URL list, browser state, personal information, raw employer HTML, or application answers. Public-page capture must remain read-only and pre-submit.

For the research-only local executor, follow [the AG-05 guide](./docs/agent/EXECUTOR.md) and run `npm run test:executor`. Keep new handlers on explicit synthetic fixtures, verify retained values/outcomes independently, and test stale documents, revocation and worker recovery. Do not expand live permissions or replace manual screenshot review with automatic coordinate actions without a separate capability review and evidence.

For correction/workflow memory and the research Jobs view, follow [memory and discovery usage](./docs/agent/MEMORY_AND_JOBS.md). Include counterfactual scope/ownership tests for memory changes, persistent-budget/cancellation tests for source changes, and exact employer/source/date evidence for rating changes. Do not promote a local demo result into a claim of live portal support. AG-09 now integrates native local preparation and verified submission; broader evaluation, the [five-user study](./docs/agent/AG09_USABILITY_STUDY.md), additional control families and provider pairing remain open contributor work.

Useful commands:

```bash
npm run format
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run verify
```

## Choosing work

The original milestone plan is complete. Ongoing work stays open through GitHub issues, pull
requests, and the living [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) backlog. Contributors can
propose new ATS adapters, mappings, tests, accessibility improvements, security hardening, or
documentation without inventing another numbered milestone sequence.

For a new ATS or significant browser capability, open an issue first and include:

- the user problem and intended safety boundary;
- synthetic or sanitized examples;
- required browser permissions and failure behavior;
- a test strategy, including manual checks when automation cannot establish correctness.

## Fixture rules

Fixtures must be synthetic or fully sanitized. Remove:

- candidate names, emails, phones, addresses, and résumé contents;
- session IDs, CSRF tokens, cookies, and authentication state;
- employer-confidential text or internal identifiers;
- analytics payloads that are not needed for the test.

Every committed ATS fixture should have a stable ID, adapter/version metadata, expected field mappings, and a test that validates its schema or behavior.

## Safety rules

Pull requests must not add:

- CAPTCHA or bot-detection bypasses;
- arbitrary JavaScript execution from runtime messages or model output;
- automated LinkedIn actions;
- password, government-ID, banking, or payment autofill;
- unattended submission behavior;
- AI inference for work authorization, EEO, legal, or similarly sensitive facts.

If a change touches runtime permissions, origin validation, sensitive fields, navigation, uploads, or submission state, describe the threat model and failure behavior in the pull request.

## Pull request expectations

A pull request is ready when:

- formatting, lint, type checking, unit tests, builds, and browser smoke tests pass;
- new behavior has regression coverage;
- documentation is updated where users or contributors are affected;
- generated files and personal data are not committed;
- manual user edits remain authoritative over automation.

By contributing, you agree that your contributions are licensed under the repository's MIT License.
