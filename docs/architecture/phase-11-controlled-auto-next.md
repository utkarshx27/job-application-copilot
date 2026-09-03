# Phase 11: controlled auto-next

Phase 11 adds one narrowly bounded navigation action: one verified **Next** click on the local Workday Test ATS fixture. It does not enable navigation on real Workday tenants or any other ATS, and it does not add a Submit command.

## Release boundary

- Global feature flag defaults to off.
- Each application requires a separate opt-in.
- The only permitted page is exactly `http://127.0.0.1:4173/workday.html` (a query string may select a controlled failure fixture).
- The adapter must report `CONTROLLED_TEST_ONLY`, Workday detection and Next evidence must each meet `0.995`, and the exact Next control must be a unique enabled `button[data-automation-id='bottom-navigation-next-button']` with text `Next`.
- Real Workday pages remain `MANUAL_ONLY` until the independent 250-form pre-submit validation gate is complete.

## State machine and click contract

The background worker persists each intent in `chrome.storage.local` before any click:

```text
PREPARED -> CLICK_DISPATCHED -> VERIFYING -> ADVANCED
    |              |               |
 ABORTED         FAILED          FAILED
```

The panel creates a short-lived `PREPARED` intent and shows a cancelable three-second countdown. Execution rechecks the tab, URL, analysis ID, adapter version, page key, fingerprint, and user-edit version. The worker then persists `CLICK_DISPATCHED` before sending the fixed token `WORKDAY_BOTTOM_NAVIGATION_NEXT` to the content driver. Neither the panel nor page can supply a selector.

Once dispatched, the worker never retries. A service-worker restart or repeated execute request finds a non-`PREPARED` intent and stops. The content driver also records the dispatched intent on the document and refuses the same intent again.

## Stop conditions

Readiness or execution stops for:

- disabled feature or missing application opt-in;
- unsupported adapter, uncontrolled host, or confidence below `0.995`;
- a stale analysis, URL, page key, fingerprint, adapter version, or user edit;
- authentication, CAPTCHA, assessment, visible validation error, or missing required value;
- unresolved R3/R4 or manual-only controls;
- résumé reconciliation, a revisit/loop, absent or ambiguous Next, or any visible Submit control;
- expired intent or an unverified transition.

Phase 11 does not submit. Phase 12 later introduced a separate synthetic Test ATS submission path; real application submission remains manual.

## Transition verification and metrics

After the single click, the worker requires a changed Workday page key or fingerprint. It polls the read-only inspector for at most five seconds. If no transition appears, the intent becomes `FAILED` with `TRANSITION_TIMEOUT`; the UI directs the user to continue manually and no second click occurs.

Stored metrics contain counts only: prepared intents, verified advances, validation failures, navigation loops, user aborts, and transition timeouts. They contain no field labels, answers, candidate data, or page text.

## Controlled validation

The gate covers default-off behavior, dual opt-in, exact fixed-token commands, countdown cancellation, required-field and manual-edit stops, one-click transition verification, duplicate execute rejection, absence of Submit capability, and a real MV3 Chromium path.

```bash
npm run verify
```

Phase 12 later added a separate fixed-token submission state machine for the exact local Test ATS review fixture. Phase 11 itself still provides no submission state or command, and real ATS submission remains disabled.
