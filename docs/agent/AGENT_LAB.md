# Experimental agent foundation (AG-01)

Implemented 2026-09-07 against repository baseline `351a034`. This is the first implementation slice of the [agent plan](./IMPLEMENTATION.md), not a replacement for the working MVP.

## What works now

- A separate research build with an agent lab that defaults off.
- Start, inspect, pause, resume, and cancel durable local checkpoint runs.
- Read visible native control structure on **exactly** `http://127.0.0.1:4173/workday.html`.
- Bind runs to a tab, document identity, profile revision, consent, and budget.
- Save state and intent claims transactionally in IndexedDB before acknowledging them; serialize competing controllers.
- Reject stale leases, changed observations, duplicate receipts, unauthorized capabilities, and exhausted budgets.
- Recover interrupted runs when a new extension worker handles an agent request. A fresh checkpoint is required to resume.
- Preserve uncertain future submission intents without replaying them. This is a reducer contract, not an enabled browser submission feature.

The lab **does not fill, upload, click Next, submit, search jobs, scrape companies, call models, train models, or operate real portals**. Existing manual MVP features remain separate. The agent state is not included in profile export/import or encrypted sync.

## Try it locally

From the repository root, using Node 22 or newer:

```powershell
npm ci
npm run build:research --workspace @copilot/extension
npm run build --workspace @copilot/test-ats
npm run serve --workspace @copilot/test-ats
```

Leave the last command running. In Chrome:

1. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
2. Select `apps/extension/dist-research`. The displayed name includes **(Research)**. Use a separate Chrome research profile and synthetic candidate details to keep this experiment apart from personal applications.
3. Open `http://127.0.0.1:4173/workday.html`. Open this extension's side panel on that tab.
4. Expand **Experimental agent lab** near the bottom, then select **Enable local agent lab**.
5. Click **Start local checkpoint run**. Expect **Checkpoint recorded** with visible-control and event counts. Inputs should remain untouched.
6. Try **Pause run**, **Resume and read checkpoint**, and **Refresh agent runs**. Close/reopen the panel to verify saved progress remains.
7. Disable the lab to pause mutable runs, or cancel a run before starting another for that tab.

Run `npm run build` for the usual release build in `apps/extension/dist`; that build has no agent lab UI and rejects agent activation. Research build settings do not unlock new live-site capabilities. No API key is needed for these checkpoints.

## Limits and troubleshooting

- One active run per application/tab; duplicate starts are rejected. Resume the existing run or cancel it.
- Each lab run has a 30-minute approval and at most 20 read attempts. Failed/uncertain claimed attempts count against the limit. The UI count is attempts, not proof that every checkpoint succeeded.
- Observations expire after 15 seconds; leases after 20 seconds. Changed structure or document identity between probes stops the checkpoint.
- A changed saved profile revision requires cancelling and starting a new run; old consent cannot silently authorize new facts.
- The allowlist does not accept other routes, `localhost`, query strings, fragments, or redirects. The Test ATS server must be running.
- A worker restart pauses an in-flight run on the next lab request; it does not silently resume. Completed read checkpoints remain available.
- Diagnostic metadata includes IDs, profile revision, structural hashes, counts, and event codes. It excludes field values, page text, résumé bytes, credentials, and filenames. Structural hashes do not attest to field values or application correctness.
- The store currently caps history at 100 runs and 1,000 events per run. There is no history pruning or migration UI yet. For a full reset, remove the disposable research extension/profile; removing it also removes any other data stored in that extension, so export anything you need first.
- Corrupt or unsupported stored state is reported, never replaced silently. Preserve it privately for investigation; do not post personal extension storage in issues.

## Implementation map

| Location                                                   | Responsibility                                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `packages/agent-core`                                      | Strict contracts, pure reducer, fencing, budgets, consent, journal, receiver dedup helper, confirmation outbox     |
| `apps/extension/src/agent-storage.ts`                      | Serialized IndexedDB read/write transactions and corruption handling                                               |
| `apps/extension/src/agent-controller.ts`                   | Local read-only workflow, re-observation, recovery, safe status summaries                                          |
| `packages/browser-command-schema` and extension background | Strict panel requests; agent messages require the extension panel's origin/path                                    |
| `apps/extension/src/sidepanel/agent-lab.tsx`               | Opt-in controls and run events                                                                                     |
| `evals/end-to-end/agent.spec.ts`                           | Actual Chromium/extension path, persistence, worker-stop recovery, unchanged inputs, route and sender restrictions |

The reducer's `VERIFY` and `RECONCILE` inputs are trusted controller interfaces. They are **not** exposed as runtime messages or accepted from a model/page. Future execution must supply independent evidence. The current receiver helper runs in the controller and acknowledges read snapshots only; it is not yet a document-side executor for browser mutations. No exactly-once remote-submission guarantee is claimed.

The synthetic confirmation outbox supports identity-bound events and idempotent acknowledgement. AG-05 still needs a transactional/idempotent consumer for the existing tracker and a separate outcome verifier. Do not connect model-produced booleans directly to confirmation.

## Baseline and validation

Before runtime changes, the existing unit suite passed **35 test files / 124 tests** on 2026-09-07. This is a regression baseline for the existing MVP, not a measurement of agent application success, field accuracy, or model cost.

New targeted coverage: **25 unit tests** for contracts/reducer/controller/storage and **3 Chromium end-to-end scenarios** for the lab. The worker-stop scenario injects a synthetic claimed read through the test runner, stops the actual Chrome service worker, and checks recovery. Fault injection is not a production runtime command.

Verification result on 2026-09-07: `npm run verify` passed formatting, lint, TypeScript, **37 unit-test files / 149 tests**, release builds, and **28 Chromium end-to-end tests**. The separate `build:research` command also passed. No live applications, paid models, or personal account sessions were used in these checks.

Run all regression checks:

```powershell
npm run verify
```

Run targeted unit checks:

```powershell
npx vitest run packages/agent-core/tests/agent.test.ts apps/extension/src/agent-controller.test.ts --pool=threads --maxWorkers=1
```

For targeted browser checks, build the E2E extension and Test ATS, then run Playwright with a quoted grep:

```powershell
npm run build:e2e --workspace @copilot/extension
npm run build --workspace @copilot/test-ats
npx playwright test --config evals/end-to-end/playwright.config.ts --grep "agent lab"
```

Next implementation: **AG-02 compact onboarding/preferences** and **AG-03 synthetic portal/outcome harness**, followed by the model router and mutating executor. The new foundation tests do not satisfy the later end-to-end application or live-connector release gates.
