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

Research-only correction/workflow memory and job/evidence records are held in separate extension-private IndexedDB stores, scoped to vault/profile identity. They are excluded from profile backups and cloud sync. Memory stores reviewed meaning references and structural workflow steps, not copied form answers; reuse still requires current ownership, profile revision, expiry and page checks. Jobs reads are restricted to the fixed local catalog with persistent budgets; imported URLs and manually entered company citations are not fetched. These panel-only messages reject page-origin senders. See [storage, deletion and research boundaries](./docs/agent/MEMORY_AND_JOBS.md).

The original auto-next feature is limited to the exact local Workday Test ATS fixture, defaults off, and requires a second per-application opt-in. It persists dispatch before clicking, verifies the transition, and never retries. See the [controlled navigation architecture record](./docs/architecture/phase-11-controlled-auto-next.md).

Research/E2E builds additionally contain the AG-05 executor, restricted to the exact top-level `http://127.0.0.1:4173/agent.html` demo and a separately approved synthetic profile/file. Its isolated-world Port is bound to Chrome's tab/frame/document identity, expiring received intents and fences; worker disconnect and ordered revocation invalidate old execution. A committed action may finish during cancellation, but no new action is dispatched afterward. Full-document navigation is reconciled by reading, not re-clicking. This executor stops at review and has no submission capability. It records synthetic preparation as `APPLYING`, not `APPLIED`.

Only research/E2E manifests offer optional `debugger` permission for bounded manual screenshot review. Attachment is explicit, local-only, and detached on completion/failure; screenshots are panel-memory-only and never sent to a model. The normal build neither ships the execution receiver nor requests debugger permission. Real ATS navigation/submission remain manual. See [executor scope and evidence](./docs/agent/EXECUTOR.md).

Controlled submission is a separate default-off capability restricted to the exact local Test ATS Review page. It requires an on-page attestation, global and application opt-ins, explicit final authorization, and confirmation identity verification. Real ATS submission is not enabled. See the [controlled submission architecture record](./docs/architecture/phase-12-controlled-submission.md).

The project is pre-release. Security fixes are applied to the latest `main` branch until versioned releases begin.
