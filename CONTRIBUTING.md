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
npm run check:phase2
```

Node.js 22+ and npm 11+ are required.

## Development workflow

1. Fork the repository.
2. Create a branch from `main`.
3. Add or update tests with the implementation.
4. Run formatting and the relevant focused tests while developing.
5. Run `npm run check:phase2` before opening a pull request.
6. Explain behavior changes, safety impact, and verification in the pull request.

Useful commands:

```bash
npm run format
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run check:phase2
```

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
