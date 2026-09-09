# AG-09: reviewed local first-screen preparation

Status: **first native-screen increment implemented; AG-09 is not complete**. Available only in research/E2E builds. No models or API keys are required. This does not enable live application automation, uploads, Next or submission.

## Try it

Build/load the research extension and start the local Test ATS using [these commands](./MEMORY_AND_JOBS.md#start-the-research-build). Use a separate Chrome test profile and synthetic contact details.

1. Verify a full name, email and E.164 phone number in **Profile**. For the seeded candidate, use Priya Sharma, `priya@example.test` and `+919876543210`.
2. Open **Jobs**, search the demo catalog and find an available job.
3. Select **Review local preparation**. Review the selected role, employer, location and profile revision.
4. Enter the current city and choose the work-arrangement answer for this application. These are job-specific answers, not automatically inferred from desired location or saved globally as facts.
5. Check **I approve these answers for this local job and first screen only**, then **Prepare local first screen**.
6. Keep the newly opened application tab active. The extension opens the native application and fills its five reviewed fields. It checks retained values and stops on the first screen.
7. Inspect the page. The tracker records **Applying**, never Applied. Continue through later steps manually for now.

No résumé is selected or uploaded by this increment: the supported native fixture has no résumé control. Even if a profile contains résumé-derived facts, this authorization does not grant file access or upload permission.

## Approval, recovery and deletion

- Only exact URLs shaped as `http://127.0.0.1:4173/portal.html?scenario=portal-01&jobId=job-SEED-ID` from the stored local catalog are allowed. Imports, extra URL parameters, other hosts/routes and unavailable jobs cannot acquire preparation authority.
- Review and approval each recheck the job through the local catalog, using the persistent 50-read daily budget. A changed listing requires a new search/review. Exclusions and dismissal remain binding.
- Approval expires after ten minutes and is bound to vault/profile identity, revision, a digest of the complete profile, job identity and the reviewed answers. Contact facts must be verified and current. Desired locations are not treated as current residence.
- The private state records each command before dispatch. Competing approval clicks can claim it only once. A prepared job returns its existing record rather than opening another tab.
- The receiver is an isolated-world function with a fixed native-control contract. The second command targets the document identified by the first command. It does not accept page-supplied selectors, script, action types or destinations.
- Unknown/extra/hidden controls, changed labels, iframe/shadow controls, overlays, validation alerts and conflicting prefilled values stop preparation. Existing values are not overwritten. Each dispatched command is bounded; there is no automatic retry.
- **Cancel this preparation** prevents later commands. A command already dispatched may finish, including its bounded five-field fill. Cancellation does not erase page values or close tabs.
- A worker restart converts unfinished preparation to **Needs review**, without replaying the click or fill. Inspect the existing page; automatic resume is intentionally unavailable in this increment.
- Prepared records reconcile an idempotent tracker update, including after a worker restart. No submission receipt is claimed.
- After cancellation, **Forget preparation record** removes the approval and private answer snapshot. This cannot be undone and does not remove the separate tracker history or clear the application page. Forgetting/reviewing again is not a declaration that the employer application was withdrawn.

Records live in `copilot-job-preparation-v1` IndexedDB, scoped by vault/profile identity, with a maximum of 100 retained records. This private store contains the approved answer snapshot; it is excluded from profile backups, sync, diagnostic exports and model input. Cancel/forget records you no longer need. Uninstalling the research extension removes its local storage.

## Implementation and validation

Contracts live in `packages/agent-core/src/job-preparation.ts`; the controller, isolated document function and UI are `apps/extension/src/job-preparation-*` and `sidepanel/job-preparation.tsx`. The separate AG-05 executor and its URL restrictions remain unchanged.

Tests cover exact URL authority, stale profile/job/approval rejection, competing claims, worker interruption, uncertain dispatch, deletion, native-control guardrails, page-origin message rejection and the real Chrome Jobs → review → first-screen → tracker flow. The independent runner verifies zero accepted applications and zero submission attempts. These tests do not establish multi-step preparation or submission reliability.

## Remaining AG-09 increments

1. Extend the existing durable executor contracts to local portal steps, reviewed files and grouped missing-answer recovery. Avoid adding a second general-purpose action engine; this initial adapter deliberately supports only two fixed commands.
2. Connect scoped correction/workflow memory to that executor and validate corrected second-run behavior on held-out layouts.
3. Add separate per-application local submission consent, receipt reconciliation, duplicate/uncertain-outcome tests and tracker confirmation.
4. Evaluate the complete résumé-to-outcome flow, recovery/latency/action costs and five-user onboarding study before declaring AG-09 complete.
