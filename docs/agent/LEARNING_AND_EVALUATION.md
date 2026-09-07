# Learning from corrections and evaluating the agent

Status: proposed design and targets. None of the metrics below are measured results for this project.

## What learning means

Ship useful learning without model training first. A person correcting “Country code” to a phone dialing prefix should prevent that mistake on a comparable control. A correction to their own expected salary should update only the authorized private answer scope. A transient network failure should not rewrite either mapping.

Keep three separate layers:

1. **Private facts and approved answers:** existing profile/saved-response model, with provenance, verification, sensitivity, scope and expiry.
2. **Correction memory:** observed mistake, rejected interpretation, accepted interpretation, supporting observation, user confirmation, context and applicability.
3. **Procedural skills:** parameterized interaction patterns, such as selecting a country option or adding an employment row, backed by validated trajectories.

Reflexion demonstrates feedback-driven textual memory without weight updates; Agent Workflow Memory and ReasoningBank motivate retrieving reusable procedures and lessons. These ideas guide this design; their reported benchmark outcomes are not promised here. See the [research review](./RESEARCH.md).

## Correction records and retrieval

Proposed correction fields: ID, owner, correction kind, canonical question, rejected/accepted mapping or action, fact/answer references, control family, adapter/version scope, locale, observation hash, user confirmation, creation/expiry, revision, and superseded-by link. Store personal answer values in the private answer store, not shared rule records.

Kinds: `PROFILE_FACT`, `ANSWER`, `FIELD_MEANING`, `CONTROL_ACTION`, `RANKING_PREFERENCE`, and `TRANSIENT_FAILURE`. Similarity alone cannot choose between them.

Retrieval order:

1. Enforce user ownership, active state, expiry, fact verification, profile revision, sensitivity, and exact scope filters.
2. Match canonical semantics and negative examples, then lexical similarity; benchmark optional embeddings against this baseline.
3. Retrieve at most three applicable lessons initially to control prompt size and conflicting advice.
4. Require current control preconditions; a stored target reference from another observation cannot be executed.
5. Record memory version IDs in the trace so the decision can be reproduced or rolled back.

Examples requiring negative matches: current versus expected salary; monthly versus annual pay; residence versus citizenship; authorization now versus future sponsorship; willing to relocate versus already located there; country versus dialing code; total experience versus years with one technology; optional marketing consent versus required application declarations.

User corrections override model guesses but not unrelated verified facts. When two confirmed corrections conflict, ask for resolution. Changes to profile values invalidate dependent answer caches. Forget/delete removes derived embeddings and retrieval caches; correction sync is off until schema and deletion semantics are implemented.

## Workflow skills

Proposed skill fields: ID/version, general or adapter-specific applicability, semantic task, parameter types, preconditions, permitted typed actions, postconditions, fixture IDs, observed successes/failures, expiration and retirement reason.

Promotion lifecycle:

```text
CANDIDATE -> OFFLINE_VALIDATED -> ACTIVE -> RETIRED
     |              |
  REJECTED       REJECTED
```

Model-generated lessons are candidates, not executable instructions. A user-confirmed private answer can become reusable immediately within its allowed scope; a generalized interaction skill needs offline replay and review. One failure can retire a dangerous skill; success counts alone cannot override a wrong-field regression.

Do not store arbitrary JavaScript, credentials, personal values, page-provided instructions, raw screenshots or hidden chain-of-thought as skills. Store concise observations and outcome reasons. Community-shared skills must be sanitized, versioned, license-checked, validated and reviewed before activation.

## Benchmark design

Maintain separate corpora for:

- deterministic parser/control regression;
- full local application episodes;
- discovery, ranking and employer-evidence tasks;
- prompt injection and boundary behavior;
- separately authorized live compatibility observations.

Initial data target: **300 distinct synthetic application scenarios**, with 180 training/development, 60 validation, and 60 frozen test scenarios. Group by template/workflow family and employer layout before splitting; screenshots from one template must not leak across partitions. Stratify across dialog applications, screening forms, startup applications and existing employer ATS patterns. Include both completable tasks and tasks whose correct outcome is clarification or abstention.

Twenty seeded smoke scenarios support ordinary CI while the larger suite develops. A release evaluation repeats each of the 60 frozen test scenarios with three recorded run seeds, producing 180 runs; repetitions do not create 180 independent templates. Keep ranking/evidence labels in their own held-out sets. Never call synthetic coverage “validated on 300 live websites.”

Test expected values, accepted applications, file identity and duplicate counts through simulator state unavailable to the agent. Freeze task manifest, fixture checksum, browser/OS, viewport, model/weight version, runtime, quantization, prompts, memory snapshot, budgets and seed. Pin external benchmark versions before comparisons.

## Baselines and ablations

Run comparable tasks under identical budgets:

| Variant                                 | Question it answers                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| Current deterministic engine            | What already works without new AI?                                               |
| Engine plus small text-model fallback   | Does interpretation improve completion?                                          |
| Text path plus selective vision         | Does vision solve otherwise inaccessible controls?                               |
| Agent plus reviewed corrections         | Do user fixes prevent equivalent mistakes?                                       |
| Agent plus validated workflow skills    | Does procedural memory reduce steps and interventions?                           |
| Optional SFT or RL candidate            | Do weight updates beat memory alone?                                             |
| Optional Stagehand/Browser Use executor | Does a framework outperform the repository controller under the same boundaries? |

Use fixed memory snapshots for baseline comparisons. Evaluate learning in a separate sequence: correction on development tasks, frozen promoted memory, then new held-out tasks. Do not feed test outcomes back into memory midway through a claimed frozen evaluation.

Use validation data to choose prompts, skills, weights and budgets. If frozen-test failures guide a later change, retire that test partition into regression data and obtain a fresh untouched partition before claiming held-out generalization again. Retain both reports so improvements and regressions remain auditable.

## Metrics and proposed local release gates

These are initial engineering targets to review after the baseline, not performance guarantees. Report numerator, denominator, task families, repeated seeds, and uncertainty. Aggregate scores cannot hide a severely failing connector.

| Metric                 | Definition                                                                                                                                                                                                             | Initial local gate                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Correct completion     | Required values, every agent-populated factual answer (including optional ones), authorized file, and final state are correct; denominator is all completable frozen runs including failures, timeouts and abandonment | At least 90% of completable frozen runs                                                            |
| One-click completion   | Correct completions needing no additional input after initial per-job authorization divided by all completable frozen runs, including failures, timeouts and abandonment                                               | At least 70%; report it separately from overall completion                                         |
| Critical failures      | Wrong protected facts, cross-profile leak, unauthorized action, duplicate submission or false Submitted claim                                                                                                          | Zero observed in release suite and boundary tests                                                  |
| Correct pause          | Ground-truth exception tasks pause at the expected boundary before a prohibited mutation                                                                                                                               | 100% of dedicated boundary suite                                                                   |
| Manual interventions   | Additional prompts/corrections on completable tasks, excluding initial authorization                                                                                                                                   | Median at most one; also report p90 and abandonment                                                |
| Correction benefit     | Recurrence of a corrected error on equivalent held-out tasks                                                                                                                                                           | At least 50% relative reduction versus no-memory baseline when nonzero baseline permits comparison |
| Harmful transfer       | Correction reused for a deliberately different meaning                                                                                                                                                                 | Zero observed on paired counterfactual suite                                                       |
| Recovery               | Supported resumable interruption tasks recover with fresh state and correct result                                                                                                                                     | At least 90%; all ambiguous submission cases pause without retry                                   |
| Discovery hard filters | Known disallowed jobs incorrectly included                                                                                                                                                                             | Zero observed in labeled hard-filter tests                                                         |
| Company ratings        | Numerical claims match resolved source/scale/date; unavailable evidence remains unknown                                                                                                                                | 100% of deterministic evidence checks                                                              |
| Budget adherence       | Run honors configured token/action/time/cost ceilings                                                                                                                                                                  | 100% of budget tests                                                                               |

Track median/p95 elapsed time, actual input/output tokens, vision calls, retry costs, memory retrieval latency, and cost per successful application. Calculate the last metric using **all attempted-run costs divided by correct completions**, not only costs from successful runs. Local hardware/energy and hosted search/infrastructure costs are reported separately.

For an initial hosted-model development profile, propose a configurable $0.05 inference ceiling, 60 action ceiling, and five-minute active-work ceiling per local application, excluding time waiting for the user. These are experimental guardrails, not expected costs or speed promises. Reserve cost before dispatch and stop if no affordable validated next action exists. Tune budgets using validation data before freezing a release test.

Run paired comparisons; report task-family-clustered bootstrap intervals for improvements where practical. For zero critical errors, report the sample size and a binomial uncertainty bound where independence is reasonable; correlated repeated runs are not proof of zero real-world risk. Keep live pilot results separate from synthetic benchmarks.

## Required failure scenarios

- Incorrect but plausible salary/work-authorization/location mappings.
- Hidden duplicate fields, overlay interception, stale target refs, shadow roots and frame changes.
- Long forms, conditional fields, reordered dropdown options, repeated work-history rows and custom dates.
- Page validation that rejects a value even though read-back initially appears correct.
- Wrong resume selected, stale file authorization, upload parser overwrites and failed retention.
- User edit/takeover, account switch, job change, permission revocation and expired consent.
- Worker crash before/after dispatch, duplicate message delivery, tab closure and tracker outbox replay.
- Submission accepted with lost response, misleading success text and different-job confirmation.
- Injected page/resume/job/review text requesting profile export, external navigation, invented facts or memory changes.
- Model outage, invalid schema, token overrun, unavailable local model and accidental cloud fallback.
- Source challenge, rate limit, login wall, expired listing and sparse employer evidence.

## Optional offline training

Only begin AG-12 when the memory baseline and failure taxonomy show a repeatable gap, rights to the examples and base weights are clear, and the simulator provides meaningful ground truth. A few personal corrections are not enough to claim a generally trained application agent.

Sequence: curate sanitized trajectories, supervised fine-tune an optional small policy, then compare constrained skill-conditioned RL or failure-derived curriculum against that baseline. Keep every rollout inside resettable local emulations. Never explore alternative submissions against a live application or use interview/rejection outcomes as the sole learning signal.

Proposed reward design:

- A critical violation terminates the episode with failure reward (initially -1) and fails promotion regardless of aggregate reward.
- Correct verified completion receives terminal success reward (initially +1).
- Correct clarification receives success only on tasks explicitly labeled as requiring it; endless abstention cannot earn success on completable tasks.
- Incorrect or incomplete outcomes receive no success reward.
- Apply a small capped efficiency penalty only within safe successful trajectories (initial maximum 0.1 total), so cheaper wrong actions cannot compensate for failure.
- If intermediate progress rewards are added, award only a newly verified milestone once. Fill/clear or navigation loops must not farm reward.

Use simulator assertions for factual correctness, outcome, consent and duplicates. Model judges may supplement narrative-quality review but cannot be the only verifier. Spot-check judge agreement with human labels and test reward hacking deliberately.

Pin training code, dataset split, reward version, base weight/license, optimizer settings, compute budget and output artifacts. Keep weights separate from private user memory. Evaluate promotion on the frozen suite with no new critical failures and measurable improvement over memory-only operation; otherwise retain the baseline. Provide rollback and no live weight updates.

## Research export and human review

Provide an opt-in export preview with redaction and a deterministic schema. Default exports contain sanitized control structure, action types, outcome codes, timing and model/version IDs. Screenshots, answer values, resumes, cookies, tokens and session data are excluded. Any optional private artifact export has its own explicit selection and retention limit.

Human review remains necessary for ambiguous semantic labels, narrative factuality, employer identity/source interpretation, new sensitive questions, privacy of fixtures, and selected live compatibility observations. Review by template family and error type; automate repeatable assertions after the first reviewed case.
