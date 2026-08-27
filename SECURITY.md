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
- incorrect work-authorization or legal-answer automation.

The project is pre-release. Security fixes are applied to the latest `main` branch until versioned releases begin.
