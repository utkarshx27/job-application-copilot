# AG-09: reviewed local application flow

Status: **native local product flow implemented; broader release evaluation and the five-user study remain open**. Available in research/E2E builds, without a model, API key or GPU. This development result does not establish live portal automation or frozen-corpus performance gates.

## Try the complete flow

Build/load the research extension and start the local Test ATS using [these commands](./MEMORY_AND_JOBS.md#start-the-research-build). Use a separate Chrome test profile and synthetic details.

1. Import a synthetic PDF/DOCX résumé or enter details in **Profile**, then verify full name, email and E.164 phone. The application file is selected separately from profile import.
2. In **Jobs**, search demo jobs and select **Review local preparation** for `job-7-8` (seed 7). Review the actual role, employer, location, fit and company evidence.
3. Enter city and work arrangement. Open **Prepare all local application steps** and review experience, notice period, current/expected compensation, currency and period.
4. Choose the synthetic résumé, approve the answers/file/preparation, and select **Prepare complete local application**. Keep the new application tab active.
5. The controller fills contact details, advances through screening, uploads the reviewed file, and checks the final summary and retained file hash. Missing/conflicting questions appear together. Pause/take over, resume and cancel are available before submission.
6. At final review, inspect the answers and filename. Check **I reviewed this application and approve one local submission**, then **Submit this local application once**.
7. The tracker shows **Applied** only after an independent read of the local server receipt confirms the application/job identities. **Check application receipt** reconciles uncertain outcomes without repeating Submit.

The original **Prepare local first screen** remains available for `portal-01` and authorizes only opening/filling that screen.

For the independently scored seed-7 demo, use Priya Sharma, `priya@example.test`, `+919876543210`, Bengaluru, Remote, 36 experience months, 30 notice days, current compensation 900000, expected compensation 1500000, INR, Year. The synthetic text résumé contains exactly `Synthetic resume: Priya Sharma; Example Labs; 36 months of experience.` without a trailing newline. These are documentation/test inputs, not answers bundled into the executor.

## Correction and workflow reuse

`job-7-9` and `job-7-13` use a renamed native layout. **Annual earnings** deliberately lacks a deterministic interpretation. Review it as current compensation, enter the approved value, and optionally save its meaning. Equivalent questions for the same profile revision can reuse it. Other labels, profiles, expired/conflicting/forgotten corrections do not supply an answer.

Verified runs capture typed workflow candidates in the existing memory store. A separate matching run validates a candidate; **Enable validated workflow reuse** activates it. Active workflows prioritize freshly observed supported fields and do not authorize submission. Inspect, retire or forget memory through **Observe**. Runs with unverified interrupted actions do not become workflow evidence.

## Scope and recovery

- Exact top-level local routes only: `http://127.0.0.1:4173/portal.html?scenario=portal-NN&jobId=job-SEED-ID`, with NN 01, 02 or 30–34, matching the freshly checked stored catalog listing. Imports cannot acquire execution authority.
- The new catalog jobs exercise complete native/renamed forms and lost/false/wrong-response cases. Other emulated control families retain their separate harness and AG-05 capabilities.
- Approval binds profile identity/revision/digest, verified contacts, reviewed answers and exact file bytes. Files are PDF/DOCX/TXT, limited to 500 KB.
- Complete preparation uses the existing agent reducer, leases, intent claims, action budgets and postconditions in a separate private executor repository. The isolated document receiver rechecks document identity, control structure and the observation hash.
- Final approval narrows the same prepared run to Submit. Before dispatch, listing availability and the complete answer/file summary are checked again. Tracker writes are idempotent.
- Worker interruption requires explicit review/resume. An already dispatched command may finish; its short-lived ticket must expire before recovery. Reloading the application document requires manual inspection; a lost application session is not reconstructed.
- Unknown submission blocks resubmission across restarts. Receipt reconciliation can work after the application tab closes. Missing receipts never imply success.
- Approval expires after ten minutes. Explicit preparation resume renews that window without resetting the action budget. Cancel does not erase page values or withdraw an accepted application.

Private answers/file bytes live in `copilot-job-preparation-v1` and are excluded from profile backups, sync, model input and diagnostics. Cancel then **Forget preparation record** removes an unsubmitted preparation. **Clear private application data** removes answers/files from submitted or uncertain records while keeping job/receipt identity to prevent duplicates. Tracker and correction/workflow memory are managed separately. Old records load with additive defaults; do not downgrade against newer research stores without using a fresh test profile.

## Verification and reporting

```powershell
npm run test:preparation
npm run agent:report
```

The first command builds/runs integrated Chrome tests and generates `test-results/ag09-report.md` and `.json`. The second regenerates the report from the latest Playwright results. Reports identify checks, source hashes and environment. **Download metrics without personal data** exports action count, interventions, memory uses, duration, state and zero inference cost.

Tests cover retained résumé bytes, corrected second-run behavior, activated workflow reuse, changed final summaries, actual worker restart, duplicate-submit rejection, private-data clearing and uncertain/false/mismatched responses. The independent runner verifies accepted values, file content and submission counts; its credentials and expected-answer endpoint never enter the application browser or executor.

## Remaining acceptance evidence

The [evaluation plan](./LEARNING_AND_EVALUATION.md) proposes 300 scenarios with 60 frozen test templates and three seeds per test template. This development suite is not that corpus and does not establish its aggregate completion, correction-benefit or latency gates. AI integration and broader/live connectors are separate work packages.

The [five-user study kit](./AG09_USABILITY_STUDY.md) is ready. Participant observations and frozen held-out results have not been fabricated. Full AG-09 release acceptance remains open until these results are collected and reviewed.
