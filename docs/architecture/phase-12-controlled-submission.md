# Phase 12: controlled Test ATS submission

Phase 12 implements submission only for the exact local Workday Test ATS review fixture. It does not enable submission on real Workday tenants, other ATS platforms, LinkedIn, or job boards.

## Trust and release boundary

- Submission defaults off globally and per application.
- The only permitted source is `http://127.0.0.1:4173/workday.html` on the controlled `REVIEW` step.
- The adapter must supply exact `data-automation-id="submit"`, `data-controlled-submit="true"`, and `Submit application` evidence at confidence `0.995` or greater.
- The page cannot supply a selector or command. The only target token is `WORKDAY_TEST_ATS_SUBMIT`.
- Real ATS pages fail the origin, mode, review-page, marker, and confidence checks.

## Required user decisions

Submission requires four distinct approvals:

1. The user completes the on-page Test ATS review attestation.
2. The user enables the global controlled-submission flag.
3. The user enables submission for the current application.
4. The user checks the final side-panel authorization after reviewing the job and workflow summary.

Preparing the intent starts a cancelable five-second countdown. Disabling either flag aborts any prepared intent.

## Readiness policy

The state machine stops unless:

- the current page is the controlled Workday Review fixture;
- all workflow steps were observed and no revisit/loop is active;
- every visible required control is complete;
- no unresolved R3/R4 or manual-only review control remains;
- no authentication, CAPTCHA, assessment, validation, or résumé-reconciliation gate exists;
- there is no different tracked application conflict;
- Next is absent and the exact enabled Submit control is unique;
- no submission has already been dispatched for the review fingerprint.

Any page or user edit after preparation invalidates the intent.

## One-shot state machine

```text
PREPARED -> SUBMIT_DISPATCHED -> VERIFYING -> CONFIRMED
    |               |               |
 ABORTED           FAILED          FAILED
```

`SUBMIT_DISPATCHED` is persisted to `chrome.storage.local` before the content command is sent. Once dispatched, the worker never retries. Repeated requests and service-worker restarts find a non-`PREPARED` intent and stop. The content driver also rejects the same intent on the document.

After the single click, the worker requires confirmation evidence for the same normalized application identity. Only then does the existing tracker move the application to `APPLIED`. A missing or mismatched confirmation produces a terminal failure and manual recovery guidance.

## Data minimization

The submission store contains intent identifiers, adapter/page fingerprints, timestamps, state, confirmation reference, and counters. Metrics record only prepared, dispatched, confirmed, aborted, validation-failure, and confirmation-timeout counts. Candidate answers and field labels are not stored.

## Validation gate

The controlled gate covers default-off behavior, dual opt-in, literal explicit consent, countdown cancellation, stale-edit rejection, fixed-token schema enforcement, persisted-before-click ordering, confirmation identity binding, duplicate-execute rejection, tracker confirmation, and a real MV3 Chromium flow.

```bash
npm run check:phase12
```

Production submission requires a new threat review, policy approval, staging validation, real-form canaries, rollback controls, and an explicit release decision. It is not authorized by this implementation.
