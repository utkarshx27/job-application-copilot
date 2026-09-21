# AG-09 validation and pilot hold

Status: **OPEN — no live connector pilot**.

Follow-up: the [frozen v2 composition evaluation](./EVALUATION_V2.md) ran all 198 planned episodes and failed the gates: 18/144 correct completions, 0/18 recovery and 18/36 correct boundary outcomes. Its initialization failures prompted a bounded dialog-wait fix; v2 is now regression evidence, not an unseen test for that fix. Five real new-user observations are still missing.

## Automated local evidence

Run `npm run verify` for formatting, lint, types, unit tests, production builds and the complete Chrome regression suite. Then run `npm run agent:report` to extract the integrated preparation results. `npm run test:preparation` rebuilds and runs just that integrated suite.

The report retains pre-run source and extension-build hashes, environment and test start time from Playwright results. Test failures, retries, runner errors and missing pre-run metadata fail report generation. Generated evidence lives in ignored `test-results/ag09-report.json` and `.md`; it contains no runner credentials. Do not rebuild or edit execution sources during a run. A report generated successfully is regression evidence, not release acceptance.

The native flow regression covers correct retained file/answers and one accepted application, correction/workflow reuse, worker restart, competing approvals, changed summary values, changed file hash, changed job identity, unexpected frames, private-data clearing, and lost/false/wrong-identity submission responses. Tests query the independent simulator ledger; visible success text alone is not acceptance evidence.

## Frozen v1 validation (preserved)

- Formatting, lint, type checking and builds passed; 278 unit tests passed across 54 files.
- The complete Chrome regression suite finished with 88 passed, zero skipped, zero failed and zero flaky tests (run beginning 2026-09-17 at 05:02:54 UTC). This includes the 11 AG-09 preparation checks after the shared-fixture refactor.
- The frozen benchmark completed all 180 baseline episodes and 18 additional correction-arm episodes. Harness completion is not product success: correct completion was 72/144 (50%), below the proposed 90% gate. Recovery was 18/18, boundary handling 36/36, with no observed critical signals or duplicate attempts.
- In 18 paired renamed-field cases, development-trained correction memory reduced clarifications from 18 to zero. This is evidence for one learned meaning, not arbitrary-question generalization.
- See the [measured baseline](./AG09_BASELINE_V1.md), [sanitized evidence](../../evals/reports/ag09-v1-baseline.json) and [corpus protocol](./EVALUATION_CORPUS.md). The live pilot remains blocked by missed outcome gates and missing human/broader evidence.

## Control-gap development regressions

The integrated controller now handles bounded local application dialogs, same-origin application frames, open shadow roots and button/listbox comboboxes. The combined preparation/control suite passed 20 Chrome tests, including nine control regressions. These verify one correct accepted application with retained résumé for each control family, frame worker recovery, frame reload rejection, unexpected-dialog/overlay stops and rejection of options changed during opening.

Full follow-up verification passed formatting, lint, type checking, builds, 278 unit tests across 54 files and all 97 Chrome regression tests. The frozen corpus verifier also passed with the original v1 hash. These results cover the local implementation, not a fresh held-out benchmark.

The v1 corpus and baseline evidence remain unchanged. Because those outcomes informed implementation, a fresh frozen held-out evaluation is required before improved completion or release readiness can be claimed. Development regressions are not a replacement benchmark. The five-user study still requires actual participants using synthetic profiles; no observations are fabricated. Live connectors remain on hold.

## Gates still requiring evidence

| Gate             | Required evidence                                                                                                                   | Current limitation                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Frozen corpus    | 300 distinct scenarios split 180/60/60 by template/workflow family, with three recorded seeds per frozen test template              | v1 exists and was evaluated; its 30 grouped schemas share one renderer, not independent employer implementations        |
| Outcome gates    | Completion, correct pauses, protected facts, duplicate prevention, recovery and budget results under the frozen evaluation protocol | v1 completion 50% and additional-input-free completion 25% missed the gates; control fixes need fresh held-out evidence |
| Learning benefit | Paired no-memory/reviewed-memory results and deliberately different-meaning counterfactuals                                         | 18 complete pairs show clarification reduction; broader harmful-transfer and unseen-meaning evidence remains open       |
| Usability        | At least five new participants, anonymous task observations, assistance/abandonment and reviewed findings                           | Study kit exists; real observations still required                                                                      |

Use [the evaluation protocol](./LEARNING_AND_EVALUATION.md) and [participant study kit](./AG09_USABILITY_STUDY.md). Freeze scenarios and ground truth before execution, keep labels outside browser/agent access, and record all failures. If test outcomes guide implementation changes, retire those cases into regression and create a new held-out partition before claiming generalization.

Only review AG-10 pilot eligibility after these gates have evidence and findings are resolved. This checklist does not authorize live crawling, account actions or application submissions.
