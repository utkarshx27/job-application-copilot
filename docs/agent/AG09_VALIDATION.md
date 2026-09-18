# AG-09 validation and pilot hold

Status: **OPEN — no live connector pilot**.

## Automated local evidence

Run `npm run verify` for formatting, lint, types, unit tests, production builds and the complete Chrome regression suite. Then run `npm run agent:report` to extract the integrated preparation results. `npm run test:preparation` rebuilds and runs just that integrated suite.

The report retains pre-run source and extension-build hashes, environment and test start time from Playwright results. Test failures, retries, runner errors and missing pre-run metadata fail report generation. Generated evidence lives in ignored `test-results/ag09-report.json` and `.md`; it contains no runner credentials. Do not rebuild or edit execution sources during a run. A report generated successfully is regression evidence, not release acceptance.

The native flow regression covers correct retained file/answers and one accepted application, correction/workflow reuse, worker restart, competing approvals, changed summary values, changed file hash, changed job identity, unexpected frames, private-data clearing, and lost/false/wrong-identity submission responses. Tests query the independent simulator ledger; visible success text alone is not acceptance evidence.

## Latest local validation

- Formatting, lint, type checking and builds passed; 278 unit tests passed across 54 files.
- The complete Chrome regression suite finished with 88 passed, zero skipped, zero failed and zero flaky tests (run beginning 2026-09-17 at 05:02:54 UTC). This includes the 11 AG-09 preparation checks after the shared-fixture refactor.
- The frozen benchmark completed all 180 baseline episodes and 18 additional correction-arm episodes. Harness completion is not product success: correct completion was 72/144 (50%), below the proposed 90% gate. Recovery was 18/18, boundary handling 36/36, with no observed critical signals or duplicate attempts.
- In 18 paired renamed-field cases, development-trained correction memory reduced clarifications from 18 to zero. This is evidence for one learned meaning, not arbitrary-question generalization.
- See the [measured baseline](./AG09_BASELINE_V1.md), [sanitized evidence](../../evals/reports/ag09-v1-baseline.json) and [corpus protocol](./EVALUATION_CORPUS.md). The live pilot remains blocked by missed outcome gates and missing human/broader evidence.

## Gates still requiring evidence

| Gate             | Required evidence                                                                                                                   | Current limitation                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Frozen corpus    | 300 distinct scenarios split 180/60/60 by template/workflow family, with three recorded seeds per frozen test template              | v1 exists and was evaluated; its 30 grouped schemas share one renderer, not independent employer implementations   |
| Outcome gates    | Completion, correct pauses, protected facts, duplicate prevention, recovery and budget results under the frozen evaluation protocol | Completion 50% and additional-input-free completion 25% miss the 90%/70% gates; broader controls remain incomplete |
| Learning benefit | Paired no-memory/reviewed-memory results and deliberately different-meaning counterfactuals                                         | 18 complete pairs show clarification reduction; broader harmful-transfer and unseen-meaning evidence remains open  |
| Usability        | At least five new participants, anonymous task observations, assistance/abandonment and reviewed findings                           | Study kit exists; real observations still required                                                                 |

Use [the evaluation protocol](./LEARNING_AND_EVALUATION.md) and [participant study kit](./AG09_USABILITY_STUDY.md). Freeze scenarios and ground truth before execution, keep labels outside browser/agent access, and record all failures. If test outcomes guide implementation changes, retire those cases into regression and create a new held-out partition before claiming generalization.

Only review AG-10 pilot eligibility after these gates have evidence and findings are resolved. This checklist does not authorize live crawling, account actions or application submissions.
