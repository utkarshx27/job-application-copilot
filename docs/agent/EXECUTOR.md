# Local application executor

Status: **AG-05 deterministic local execution implemented.** Research/E2E builds only, at `http://127.0.0.1:4173/agent.html`. Normal extension behavior is unchanged. The original Workday checkpoint lab remains a separate read-only tool.

## Run the demo

```bash
npm run build:research --workspace @copilot/extension
npm run build --workspace @copilot/test-ats
npm run serve --workspace @copilot/test-ats
```

Load `apps/extension/dist-research` unpacked in Chrome. Open **Experimental agent lab → Local application executor**, then:

1. Select **Open execution demo**.
2. Review the synthetic profile/file, check its approval box, and enable local execution.
3. Keep the demo tab active and select **Prepare synthetic application**.
4. Observe contact filling, exact country selection, a searchable location control, date, experience row, résumé upload and step transitions.
5. The run stops at **Application ready for review**. Its explicitly synthetic tracker record remains `APPLYING`, never `APPLIED`.

The demo uses Nora Example, `nora@example.test`, India/Bengaluru, 2026-10-01, Synthetic Labs, and a generated `synthetic-resume.txt`. It does not upload your personal résumé. The current profile revision is pinned as a context guard; changing it stops the run. Connecting the complete real-profile product workflow belongs to AG-09.

Use **Pause execution**, **Resume execution**, **Take over manually**, or **Cancel execution**. Existing values and edits are preserved. Invalid/unknown fields require manual completion. Cancellation prevents further dispatch but cannot undo an action already committed to the document.

## Implemented boundaries

- Native text/date/select, searchable combobox open/filter/select, empty experience-row add/remove, synthetic-file upload and local Next handlers.
- Opaque document-owned targets, exact option values rather than indexes, stale structure/value/viewport checks, and document/tab/profile binding.
- Durable intents, expiring leases and consent, a 30-action/zero-API-cost budget, and repeated-target loop detection.
- A separate isolated-world bundle and ordered extension Port. Chrome supplies tab/frame/document identity; only the exact top-level demo URL is accepted. No page message bridge or model-supplied authority exists.
- Persist-before-dispatch commitments, receiver-side duplicate/fence rejection, ordered revocation on pause/cancel, and old-fence invalidation on worker disconnect. The production build does not ship the receiver bundle or enable its commands.
- Delayed value/validity read-back, uploaded-file byte hashes, row-count checks and expected step transitions. Dispatch acknowledgements are not verification.
- Restart pauses interrupted runs; resume observes existing values instead of blindly replaying actions. A lost full-document Next reply is reconciled by reading the new document, never automatically clicking again.
- A durable preparation outbox with idempotent application-ID-based tracker delivery and acknowledgement after the write. No submission is claimed.
- The AG-04 reviewed-reference planner is used by the deterministic runtime. Values come from the approved synthetic facts, never generated text. No model or cloud fallback is invoked.

## Visual fallback and scope decision

**Pause and inspect screenshot** provides bounded **manual visual review**. Chrome separately requests the research build's optional debugger permission. The run pauses, one local JPEG is captured at at most 1000 × 700 pixels within a size cap, and the debugger detaches in a `finally` block. The image stays in panel memory until cleared; it is not saved to diagnostics, sent to a model, or used for coordinate clicks.

Automated vision-based actions are **not implemented**. A separate [local vision benchmark](./VISION.md) evaluates Qwen3-VL on synthetic screenshots; it is not connected to the action controller. Unsupported widgets still require human takeover. Model/browser pairing and broader image-capable evaluation remain AG-04/AG-11 gates; live connectors remain AG-10. Local deterministic AG-05 completion is not a claim that the full vision-agent product is released.

## Verification

```bash
npx vitest run apps/extension/tests/agent-document-executor.test.ts apps/extension/tests/agent-execution-visual.test.ts --pool=threads --maxWorkers=1
npm run test:executor
npm run verify
```

Unit cases cover the real reducer, revoked authority, stale contexts, edited/cleared values, changed options, duplicate receipts, framework rejection and constrained proposals. Visual tests cover permissions, origin/navigation checks, capture bounds, oversized results, failure cleanup and an already-attached debugger.

Chromium cases cover full preparation and retained values/file bytes, tracker idempotence, pause/takeover/cancel, page-origin rejection, actual worker loss, full-document navigation, access challenges, invalid retained fields, extra-row removal and competing starts. Existing browser regressions remain in the full gate.

The full-document fixture mode uses local `sessionStorage` for synthetic demo state and has no employer submission endpoint. These tests do not establish live ATS compatibility or application-submission accuracy.

## Implementation locations

- `agent-document-executor.ts`: targets, dispatch checks and postconditions.
- `agent-execution-content.ts`, `agent-execution-transport.ts`, `agent-execution-protocol.ts`: isolated transport and contracts.
- `agent-execution-controller.ts`, `agent-storage.ts`, `packages/agent-core`: orchestration, recovery, budgets and outbox.
- `agent-action-planner.ts`: AG-04 planning bridge.
- `sidepanel/agent-execution.tsx`, `agent-execution-visual.ts`: controls and manual screenshot review.
- `apps/test-ats/public/agent*`, `evals/end-to-end/executor.spec.ts`: fixtures and browser evidence.

Next: [AG-06 correction memory and subsequent work packages](./IMPLEMENTATION.md). Preserve the local allowlist and separate live-release gates.
