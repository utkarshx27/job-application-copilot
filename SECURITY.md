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
- incorrect work-authorization or legal-answer automation.

## Optional sync deployment

The bundled sync server is a controlled, self-hostable MVP. Do not expose the default JSON-backed deployment directly to the public internet. Use TLS, restrict allowed origins, protect and back up the state file, monitor access, and complete the production-hardening work documented in [`docs/architecture/phase-10-optional-cloud-sync.md`](./docs/architecture/phase-10-optional-cloud-sync.md).

The project is pre-release. Security fixes are applied to the latest `main` branch until versioned releases begin.
