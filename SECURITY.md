# Security Policy

## Reporting a vulnerability

Please do not disclose security vulnerabilities in a public issue.

Use GitHub's private vulnerability reporting flow:

https://github.com/utkarshx27/job-application-copilot/security/advisories/new

Include:

- the affected component and version or commit;
- reproduction steps using synthetic data;
- expected and observed behavior;
- potential impact;
- any suggested mitigation.

Do not include real candidate information, access tokens, employer credentials, or live application data. We will acknowledge a report as soon as practical and coordinate remediation and disclosure through the private advisory.

## Security-sensitive areas

Reports are especially helpful for:

- unauthorized form filling, navigation, or submission;
- sensitive candidate-data exposure;
- command-schema or origin-validation bypasses;
- extension permission escalation;
- arbitrary script execution;
- prompt injection that changes browser actions;
- credential, file, or cross-tab leakage;
- sync authentication/session bypasses, ciphertext tampering, key leakage, or cross-account access;
- device revocation, encrypted-backup, or account-deletion failures;
- controlled-navigation origin, intent persistence, validation, duplicate-dispatch, or transition-verification bypasses;
- incorrect work-authorization or legal-answer automation.

## Optional sync deployment

The bundled sync server is a controlled, self-hostable MVP. Do not expose the default JSON-backed deployment directly to the public internet. Use TLS, restrict allowed origins, protect and back up the state file, monitor access, and complete the production-hardening work documented in the [optional sync architecture record](./docs/architecture/phase-10-optional-cloud-sync.md).

## Browser site access

The extension uses the `tabs` permission only to identify the URL of the active application tab.
When the user chooses Scan, it requests optional host access for that active hostname only. It does
not collect background tab history or request persistent content access to every website at once.

## Controlled navigation boundary

Auto-next is limited to the exact local Workday Test ATS fixture, defaults off, and requires a second per-application opt-in. Real ATS pages remain manual-only. The extension persists dispatch before clicking, performs at most one click, verifies the transition, and never retries. See the [controlled navigation architecture record](./docs/architecture/phase-11-controlled-auto-next.md).

Controlled submission is a separate default-off capability restricted to the exact local Test ATS Review page. It requires an on-page attestation, global and application opt-ins, explicit final authorization, and confirmation identity verification. Real ATS submission is not enabled. See the [controlled submission architecture record](./docs/architecture/phase-12-controlled-submission.md).

The project is pre-release. Security fixes are applied to the latest `main` branch until versioned releases begin.
