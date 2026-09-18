# AG-09 frozen v1 baseline — release gate not passed

Measured on 2026-09-17, beginning at 04:44:21 UTC. All **180 planned baseline episodes plus 18 correction-arm episodes** completed without harness failures, skipped tests or retries. The harness passed 198 tests; **the product completion gates failed**, and `agent:evaluate` correctly exited nonzero.

| Measurement                                         | Observed                                            | Proposed gate                              |
| --------------------------------------------------- | --------------------------------------------------- | ------------------------------------------ |
| Correct completion of completable baseline tasks    | 72/144 (50%)                                        | At least 90% — failed                      |
| Completion without additional input after approvals | 36/144 (25%)                                        | At least 70% — failed                      |
| Worker-interruption recovery                        | 18/18                                               | At least 90% — passed in this sample       |
| Correct challenge/uncertain-outcome handling        | 36/36                                               | 100% — passed in this sample               |
| Observed critical signals                           | 0 across 198 episodes                               | Zero observed — not proof of zero risk     |
| Duplicate submission attempts                       | 0 across 198 episodes                               | Zero observed                              |
| Paired renamed-field clarifications                 | Baseline 18, correction arm 0; 18/18 complete pairs | 100% reduction on this one learned meaning |
| All-baseline elapsed time                           | Median 2.995 s, p95 14.957 s                        | Descriptive; includes unsuccessful pauses  |
| Inference calls/cost                                | None / $0                                           | Deterministic controller only              |

The 36 boundary episodes are not included in the 144 completable-task denominator. The additional 18 correction episodes do not inflate the 180-run baseline. Final submission still requires separate approval; the additional-input metric is not literal autonomous one-click submission.

## Findings and next implementation work

Native, renamed-with-review, lost-response and restart flows completed. **Dialog, frame, shadow-DOM and combobox flows did not complete: 72 baseline failures.** They stopped for review rather than receiving oracle-assisted fills. Integrating those control families into the AG-09 product flow is the main functional gap before a live pilot.

The correction arm learned the fixed `Annual earnings` meaning on the original development demo before loading each test scenario. It did not learn from test outcomes, activate workflow candidates, train model weights or demonstrate generalization to arbitrary unseen questions. Broader harmful-transfer tests remain required.

The corpus consists of 300 specifications derived from 30 screening schemas and ten workflow variants; the test partition has 60 specifications grouped into six screening schemas. All use one renderer. These results are not a claim of compatibility with 300 independent websites, and repeated seeds are correlated. New employer implementations, broader protected-fact/privacy boundaries, discovery/company evidence and the five-user study remain separate evidence gaps.

## Reproduction and evidence

- Corpus SHA-256: `f252af028d72ca0bd6910e0bfbcce8af8d0519d1a22af579e47d223eb2c90138`.
- Seeds: 17, 29, 43. Chromium: 151.0.7922.34; viewport: 1280×720.
- Environment: Windows 10.0.26200, Node v24.14.0.
- Full local JSON and Markdown: `test-results/evaluation/test-2026-09-17T05-01-32-009Z.*`. JSON includes pre-run source/build hashes, browser information and all 198 sanitized observations.
- [Checked-in sanitized baseline evidence](../../evals/reports/ag09-v1-baseline.json) preserves that JSON without credentials, profile values or file bytes.
- [Corpus and commands](./EVALUATION_CORPUS.md), [frozen manifest](../../evals/corpus/ag09-v1.json), [five-user study](./AG09_USABILITY_STUDY.md).

The v1 test outcomes are now observed. If they guide implementation changes, retain this baseline, retire v1 into regression and create new held-out families before claiming unseen generalization. Do not change v1 expectations or omit unsupported cases to meet a threshold.

No live connector pilot was started. No real participant study was conducted; its tools and templates are ready, but observations and findings review still require real people.
