# Frozen composition evaluation v2

Status: **first frozen run failed; retained as regression evidence after the initialization fix**. Results must be read separately from the preserved v1 baseline. This is a deterministic local-controller test, not a model or live-site benchmark.

## Protocol

- 300 new scenario specifications, split into 180 development, 60 validation and 60 test cases with whole families kept together.
- Seeds 53, 71 and 89 give 180 baseline test episodes and 18 paired correction episodes.
- New combinations: modal forms with open shadow roots or custom comboboxes, nested frames, delayed initialization, reversed field order, and recovery/response faults on compound surfaces.
- Freeze hash: `1ae4dd6f535b4dde8f8c71813c9d79914e88feee377dfc5bc684c6eacc6a10d8`.
- The extension/controller is not modified in response to this test run. Missing observations and unsupported but completable scenarios count against planned denominators.
- Ground truth and the outcome ledger stay in the private runner. The browser uses the ordinary profile, answer review, preparation and separate final-approval path.

V2 reuses the renderer, field semantics and primitive widgets from v1. Its held-out novelty is the newly frozen composition/order/timing specification, not independently authored websites or unseen screening-field semantics. Families have new IDs but retain the original schema grouping. Do not claim broad generalization from a pass. Once results guide further fixes, retire these cases into regression too.

## Run

```powershell
$env:AG09_CORPUS='v2'
npm run agent:corpus:verify
npm run agent:evaluate -- test
Remove-Item Env:AG09_CORPUS
```

Omitting `AG09_CORPUS` selects v1 for backward compatibility. `agent:corpus:freeze` exclusively creates a manifest and cannot overwrite one. V1 manifest and historical baseline evidence must not be modified. Reports are timestamped and version-prefixed under `test-results/evaluation/`.

The same planned gates apply: 90% completion, 70% without additional input after approvals, 90% recovery, correct boundary handling, no observed critical failures or duplicates, and paired correction benefit. A green harness test only means the episode was measured; inspect the outcome metrics. The five-user study and broader live-access gates stay open regardless of narrow benchmark results.

## First frozen run: failed

The [preserved baseline summary](../../evals/reports/ag09-v2-baseline.json) contains source/build hashes, the raw report checksum and all harness failures. All 198 planned episodes were attempted: 180 harness passes and 18 failures. Only 162/180 baseline episodes produced scored observations; missing restart observations remain failures in the planned denominators.

| Metric                                  | Result                                                        |
| --------------------------------------- | ------------------------------------------------------------- |
| Correct completion                      | 18/144 (12.5%)                                                |
| No extra input after approvals          | 18/144 (12.5%)                                                |
| Recovery                                | 0/18                                                          |
| Correct boundary outcomes               | 18/36                                                         |
| Observed critical failures / duplicates | 0 / 0; missing observations prevent a clean safety-gate claim |
| Complete correction pairs               | 0/18; benefit not measurable                                  |

Nested-frame cases completed. Delayed dialogs were treated as unexpected before server initialization established application identity, blocking subsequent preparation. Restart cases failed while waiting for the first filled field, before worker interruption could be tested. False-confirmation cases did not reach the intended submission boundary; an earlier pause does not count as the required outcome.

V2 deliberately stresses different combinations from v1, so 12.5% versus 50% is not a like-for-like regression measurement. Following this run, the controller gained bounded post-Open waiting for a single recognized local application dialog to initialize; unrelated dialogs remain rejected. Composed-surface tests now belong to development regression. Any improved held-out claim needs another independently frozen evaluation; neither v1 nor v2 can be recycled as unseen evidence after informing fixes.

## Post-fix development verification (not held-out)

- Formatting, lint, type checks, all 286 unit tests across 56 files and builds passed.
- The 24-test combined preparation/control regression passed, followed by a separate passing never-initializing-dialog test. That test verifies bounded pause, one open dialog and no application session or submission.
- A development-only run of the first ten v2 cases (one schema family, seed 53) plus one correction arm passed all 11 harness tests: completion 8/8, no-extra-input 6/8, recovery 1/1, boundary outcomes 2/2, zero observed critical failures/duplicates and one correction pair reducing prompts 1 to 0.
- Development report: `test-results/evaluation/v2-development-2026-09-19T06-18-04-089Z.json`. This small post-fix smoke run does not revise the frozen 12.5% baseline or establish generalization.

## Remaining sequence

Do not mark the full roadmap complete. A further independently frozen evaluation is needed for the changed controller. The five-user study requires real participants and reviewed findings. AG-10 still needs connector-specific authorization and passed prerequisite gates before read-only transport or a preparation pilot. AG-11 inference integration/validation, AG-12 measured optional learning experiments and AG-13 packaging/controlled rollout remain separate unfinished work; none is implied by this local fix.
