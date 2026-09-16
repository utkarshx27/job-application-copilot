# AG-09 validation and pilot hold

Status: **OPEN — no live connector pilot**.

## Automated local evidence

Run `npm run verify` for formatting, lint, types, unit tests, production builds and the complete Chrome regression suite. Then run `npm run agent:report` to extract the integrated preparation results. `npm run test:preparation` rebuilds and runs just that integrated suite.

The report retains pre-run source and extension-build hashes, environment and test start time from Playwright results. Test failures, retries, runner errors and missing pre-run metadata fail report generation. Generated evidence lives in ignored `test-results/ag09-report.json` and `.md`; it contains no runner credentials. Do not rebuild or edit execution sources during a run. A report generated successfully is regression evidence, not release acceptance.

The native flow regression covers correct retained file/answers and one accepted application, correction/workflow reuse, worker restart, competing approvals, changed summary values, changed file hash, changed job identity, unexpected frames, private-data clearing, and lost/false/wrong-identity submission responses. Tests query the independent simulator ledger; visible success text alone is not acceptance evidence.

## Latest local validation

- Formatting, lint, type checking and builds passed; 273 unit tests passed across 52 files.
- All 85 pre-existing Chrome checks passed in the full-suite runs. New boundary assertions initially expected API rejection and specific injected error text; the controller instead returns a persisted review state and Chrome can return a generic observation error. Those test expectations were corrected without changing application code.
- The final targeted AG-09 run passed all 11 checks with zero retries, including durable `NEEDS_REVIEW`, no receipt and zero server submission attempts for all three added mutations. `npm run test:preparation` and report generation exited successfully.
- A full-suite all-green rerun after the final assertion-only adjustment was not performed. This evidence is not a frozen release evaluation.

## Gates still requiring evidence

| Gate             | Required evidence                                                                                                                   | Current limitation                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Frozen corpus    | 300 distinct scenarios split 180/60/60 by template/workflow family, with three recorded seeds per frozen test template              | Existing development cases are not this corpus; repeated runs cannot substitute for distinct templates |
| Outcome gates    | Completion, correct pauses, protected facts, duplicate prevention, recovery and budget results under the frozen evaluation protocol | Native regression results do not establish the aggregate thresholds in the evaluation plan             |
| Learning benefit | Paired no-memory/reviewed-memory results and deliberately different-meaning counterfactuals                                         | One demonstrated reuse sequence does not establish the proposed 50% reduction on held-out tasks        |
| Usability        | At least five new participants, anonymous task observations, assistance/abandonment and reviewed findings                           | Study kit exists; real observations still required                                                     |

Use [the evaluation protocol](./LEARNING_AND_EVALUATION.md) and [participant study kit](./AG09_USABILITY_STUDY.md). Freeze scenarios and ground truth before execution, keep labels outside browser/agent access, and record all failures. If test outcomes guide implementation changes, retire those cases into regression and create a new held-out partition before claiming generalization.

Only review AG-10 pilot eligibility after these gates have evidence and findings are resolved. This checklist does not authorize live crawling, account actions or application submissions.
