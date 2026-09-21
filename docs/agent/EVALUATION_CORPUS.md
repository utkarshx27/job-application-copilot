# Frozen synthetic evaluation v1

V1 is preserved historical/regression evidence. See [the separately frozen v2 composition protocol](./EVALUATION_V2.md) for the follow-up evaluation of control fixes and its shared-renderer limitations.

This benchmark evaluates the actual research extension preparation controller against the local simulator. It does not enable a live connector or use the separate fixture-filling driver. Models and cloud calls are off.

## What the 300 scenarios mean

The corpus contains **30 screening schemas × 10 workflow variants = 300 distinct scenario specifications**. Schemas have different required combinations of experience, notice, expected compensation, currency and compensation period. Every schema includes approved contact details, current compensation and an exact synthetic résumé. Variants exercise native and renamed controls, dialogs, frames, shadow roots, comboboxes, lost responses, false confirmations, challenges and worker interruption.

All variants belonging to one field-set family stay in the same partition: **18 families / 180 development scenarios, 6 / 60 validation, 6 / 60 frozen test**. The scenarios share a renderer and primitive controls. They are not 300 independently authored websites; 60 test specifications are correlated within six schema groups. This is a bounded synthetic baseline, not proof of broad employer-layout generalization. Existing development demos have already exposed several primitive control families to the implementation.

The checked-in [manifest](../../evals/corpus/ag09-v1.json) freezes full scenario definitions, grouping, expected outcomes, seeds and correction policy. `agent:corpus:freeze` uses exclusive creation and will not overwrite it. `agent:corpus:verify` checks stored content against its SHA-256 and the current generator. After using test outcomes to change behavior, retire v1 into regression and create a genuinely new held-out partition rather than reporting improvements on v1 as unseen generalization.

## Commands

```powershell
npm run agent:corpus:verify
npm run agent:evaluate -- development
npm run agent:evaluate -- validation
npm run agent:evaluate -- test
```

Development runs use seed 17. For a quick development-only smoke run, set `$env:AG09_LIMIT='10'`; this limit is ignored for validation and test. Each of the 60 test cases runs with seeds **17, 29, 43**, giving **180 baseline episodes**. Eighteen additional fresh-browser episodes evaluate a paired correction arm on the renamed cases. Seeds change opaque identities/options; repeated seeds do not add independent templates. Evaluation is opt-in; ordinary `npm run test:e2e` does not run these longer episodes.

Do not run two browser suites simultaneously; they share local ports. Do not modify application, fixture or evaluator sources during a frozen run. The command builds the extension and simulator, verifies the corpus, runs all planned episodes without stopping on unsupported product behavior, and writes timestamped JSON/Markdown under `test-results/evaluation/`. A nonzero exit can mean **measured product gates failed**, even when every Playwright harness test completed. Inspect the report, not just the green test count. Earlier reports are retained by timestamp.

## Authority, scoring and memory

- Only the authenticated Node runner can select a corpus case through `/reset`. The public scenario response omits faults and expected outcomes. The runner token and expected-answer ledger never enter browser or model execution.
- Setup supplies an approved synthetic profile and file through the ordinary panel. Filling, advancing and submission run through the real extension, with separate final approval. There is no automatic live submission or challenge bypass.
- The private simulator ledger checks exact submitted values, uploaded bytes, job identity, acceptance and duplicate attempts. The evaluator additionally checks the extension's final state. A success-looking page is not sufficient.
- An unsupported but completable scenario remains a **completion failure**. Challenge cases require a pause before creating an application. False confirmations require an unknown outcome, not a success claim. Harness errors/timeouts remain missing unsuccessful planned observations; they do not shrink denominators.
- The correction arm learns only the fixed, previously available development demo's `Annual earnings → current compensation` mapping before the test case is loaded. It uses the same verified synthetic profile. Held-out clarification is explicit simulated user input and never saved to memory. Workflow candidates are not activated.
- Reports give completion, additional-input-free completion, interruption recovery, correct boundary handling, observed critical signals, duplicate counts, action counts, elapsed times and paired clarification reduction. Setup and development memory-training time are excluded from application elapsed time; restart waiting is included. No inference cost is incurred. Final submission still requires its separate approval, so the additional-input metric is not literal one-click autonomous submission.
- Critical signals here are incorrect accepted answers/files, duplicate attempts and false Submitted claims. The wider protected-fact, privacy, harmful-transfer, discovery/evidence, time/token-budget and user-study gates still need their own evidence. Zero observed signals is not proof of zero real-world risk.

Current thresholds are the existing proposed 90% correct completion, 70% completion without extra input, 90% interruption recovery, all dedicated boundary cases correct, no observed critical signals, and at least 50% paired clarification reduction when the baseline is nonzero. Reports always keep overall release acceptance open; a successful narrow benchmark cannot approve the five-user study or broader release requirements.

## Human study

Use the [five-user study kit](./AG09_USABILITY_STUDY.md). The structured observation tool checks completeness and summarizes real, consented observations; it does not generate participants, independently verify attendance, or resolve findings automatically.
