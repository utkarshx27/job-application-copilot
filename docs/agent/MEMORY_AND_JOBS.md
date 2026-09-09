# Correction memory, Jobs and company evidence

These capabilities are available in the **research build only**. They use local storage and need no model, API key or GPU. Normal extension builds keep the existing reviewed-autofill UI. This is an implemented local/import research slice, not live job-board automation or the complete AG-09 application flow.

## Start the research build

```bash
npm run build:research --workspace @copilot/extension
npm run build --workspace @copilot/test-ats
npm run serve --workspace @copilot/test-ats
```

Load `apps/extension/dist-research` through `chrome://extensions` using **Load unpacked**. Use a separate Chrome test profile and synthetic candidate information. The local server must be on `http://127.0.0.1:4173`; a different host/port is not automatically authorized.

## Teach a field meaning (AG-06)

1. Complete and verify the synthetic profile setup, including an email.
2. Open `http://127.0.0.1:4173/memory.html`. In **Observe**, scan the visible form.
3. Expand **Correct field meaning** for **Preferred inbox**, choose **Email**, and confirm. The panel rescans; normal selected-field review and filling still apply.
4. Reload and scan again to check that the correction persists.
5. Open **Experimental agent lab → Correction memory** to inspect, edit/reconfirm or forget the record. Forgetting removes it from subsequent retrieval; it does not undo a previous form fill.

Corrections store a meaning reference, question/group wording, exact origin/adapter/version/control/locale scope, profile ownership/version, observation hash and expiry—not an answer copied from the form. Equivalent labels use conservative normalization, not fuzzy semantic guessing. Conflicts stop reuse. A verified, current profile fact is still required. Sensitive questions cannot be turned into ordinary contact fields by memory; unsupported salary and dial-code references remain manual.

Records expire after at most 90 days. Updating the profile version invalidates reuse until reconfirmed. Oversized questions are not truncated into ambiguous matching keys. This is reviewed memory, **not reinforcement learning or model training**.

## Validate a local workflow (AG-06)

1. Follow [the local executor guide](./EXECUTOR.md) to prepare the synthetic `agent.html` application. It stops at review.
2. In **Correction memory**, refresh completed demos, select that run and capture a workflow candidate.
3. Open another `agent.html` demo in a **new tab** and prepare it. The earlier tab remains owned by its prepared application.
4. Refresh completed demos, select the new run and validate the candidate against it. Identical verified typed steps allow activation; a different sequence is rejected.
5. Activate the validated candidate and prepare a third new-tab demo. Matching current targets can use the stored field order. Old DOM targets, file bytes and answers are never replayed.

The workflow library exposes candidate, offline-validated, active, retired and rejected states. Records expire after 30 days and are bound to the current vault/profile/version. Each proposal using a workflow records its ID/revision. Fresh observations, approval, action limits and postcondition checks remain mandatory. Retire or forget to stop subsequent reuse; an action already committed may finish. Promotion currently proves repeatability on this demo, not generalization to other forms.

## Find and review jobs (AG-07)

Open **Jobs** in the research panel. **Search demo jobs** reads only the synthetic catalog; it never searches LinkedIn, Naukri, Wellfound or another external board. **Paste a job listing** accepts a title, employer, location, URL and description without fetching the URL. Imported links open for manual review.

- Searches are limited to five pages and 50 catalog reads per UTC day per local profile identity. Failed reads count, and the budget survives worker restarts. Cancel stops a running search. The displayed source status distinguishes errors, cancellation and exhausted budget.
- Tracking-link duplicates retain one shortlist entry with source references. Local listings with distinct job IDs remain distinct even when they share a demo destination.
- Fit is deterministic: preferred title +60, location +30, directly comparable expected compensation +10. Currency and period must match. This is a preference score, not hiring probability. It does not yet evaluate skills, experience or work arrangement.
- Company and keyword exclusions hide jobs by default. Dismissal is a reversible per-listing decision, not an employer fact or a learned global preference.
- Expired, unknown and stale availability remain visible. Unknown salary is never inferred. Reviewed native first-screen preparation rechecks local listing availability before opening and filling the selected job. Imports remain manual; this flow does not automate Next or Submit.

The application-demo link carries the selected job ID. Before offering **Apply locally**, the destination rechecks that specific job and shows its actual title/company/location. The ID is retained through embedded forms and receipts; invalid, expired or ambiguous links stop without starting a session. Available native demo jobs also offer [reviewed first-screen preparation](./JOB_PREPARATION.md). This new per-job action does not authorize Next, uploads or submission.

**Forget listing** removes the entry, its dismissal and company evidence no longer referenced by another listing. There is no undo. A later catalog search or import can add it again.

## Review company evidence (AG-08)

The demo catalog includes similarly named employers in different locations and conflicting, stale, sparse or absent ratings. Evidence is matched by explicit employer key, name and location; uncertain identity yields **Unavailable**. Ratings retain source, scale, review count and retrieval date. Records older than 180 days are labelled stale; fewer than 10 reviews are labelled a small sample. No composite reputation score is invented.

For an imported job, expand **Add or remove company evidence**. Enter public numerical rating metadata and its source URL/date, then confirm the employer/location identity. These are **manually entered source claims, not independently verified findings**. Saving an existing source URL replaces its prior rating; different sources remain separate. Do not paste copyrighted review text, credentials or personal data.

Evidence is cached across listings with the same stored employer/location identity. **Forget company evidence** deletes it for all those listings. No Glassdoor crawler or external research provider is enabled.

## Storage, tests and contributor handoff

Memory and discovery use separate extension-private IndexedDB databases, scoped to vault/profile identity. They are not included in profile JSON exports or encrypted sync. Importing a different profile does not expose another profile's records. Deleting a record does not clear independently stored application history. Back up needed information separately before uninstalling the research extension.

Implementation: `packages/agent-core/src/{feedback-memory,workflow-memory,discovery}.ts`, extension memory/discovery repositories and controllers, strict panel messages, and the corresponding side-panel components. No page-origin message can use these panel-only capabilities.

Tests: core scope/conflict/expiry/identity/ranking regressions; IndexedDB concurrency and deletion; persistent source budgets, failed requests, cancellation and profile changes; Chrome correction persistence/fill/forget, workflow capture/validate/reuse, and catalog/import/evidence/dismissal flows. Run `npm run verify` for the full suite.

Still open: broader held-out memory/fit evaluations, editable dismissal reasons, additional authorized source adapters, automatic company identity/research providers, AG-09 reviewed files/multi-step preparation and separately approved verified synthetic submission integration, five-user usability study, browser-local inference pairing, and live connector assessments. Do not infer these capabilities from the local tests.
