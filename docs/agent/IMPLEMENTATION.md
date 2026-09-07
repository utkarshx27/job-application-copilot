# Implementation work packages

Status: **AG-01 foundation implemented; AG-02–AG-13 unstarted.** The experimental lab is read-only, not the complete agent product. Browser-mutation acceptance and tracker delivery must be verified again when AG-05 connects an executor. See [current implementation and evidence](./AGENT_LAB.md), [architecture](./ARCHITECTURE.md), and [evaluation](./LEARNING_AND_EVALUATION.md).

## Delivery order

| ID    | Work package                               | Depends on                                     | Delivery result                                         |
| ----- | ------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------- |
| AG-01 | Contracts, durable state, baseline         | None                                           | Testable agent foundation with no new live capabilities |
| AG-02 | Simple onboarding and preferences          | AG-01 contracts                                | One reviewed candidate setup                            |
| AG-03 | Portal emulations and outcome harness      | AG-01 contracts                                | Resettable local jobs, forms and employer evidence      |
| AG-04 | Provider routing and budget controls       | AG-01, AG-03 seed fixtures                     | Measurable structured inference                         |
| AG-05 | Application controller and custom controls | AG-01, AG-03, AG-04                            | Observe, act, verify and resume locally                 |
| AG-06 | Correction and workflow memory             | AG-02, AG-03, AG-05                            | Reviewed corrections improve later runs                 |
| AG-07 | Discovery and job ranking                  | AG-02, AG-03                                   | Shortlist from emulated/imported/permitted sources      |
| AG-08 | Company evidence                           | AG-03, AG-07 job identity                      | Sourced employer information with uncertainty           |
| AG-09 | One-click local product slice              | AG-02 through AG-08                            | Resume to verified synthetic application                |
| AG-10 | Live connector assessment and pilot        | AG-05, AG-07, AG-09 gates                      | Capability-specific, documented live evidence           |
| AG-11 | Local inference and optional companion     | AG-04, AG-09 benchmark                         | Reproducible local-model option                         |
| AG-12 | Offline training experiment                | AG-06, AG-09 data/evals                        | Optional measured model improvement                     |
| AG-13 | Distribution and controlled rollout        | AG-09; AG-10 for live claims; AG-11 if bundled | Usable release with accurate support matrix             |

AG-02 and AG-03 can run in parallel after agreeing on schemas. Discovery imports and company evidence can proceed independently of visual control. AG-11 can start profiling earlier after AG-04; it is not a dependency for a hosted-model prototype. AG-12 is an optional research track and must not delay useful correction memory or a release.

## AG-01: contracts, durable state, and baseline

Implementation: `packages/agent-core`, `packages/browser-command-schema`, extension `agent-storage.ts`, `agent-controller.ts`, `agent-config.ts`, and `sidepanel/agent-lab.tsx`. Available only in research/E2E builds; defaults off. The lab performs structural read checkpoints on the exact local Workday fixture. [Run it and inspect the evidence](./AGENT_LAB.md).

Scope adjustment: the core models future fill/next/submit transitions, but the runtime exposes none of those actions through the agent. Its confirmation outbox is tested with synthetic reducer events, not wired to real submissions or the existing tracker. AG-05 must implement and validate the document-side mutation receiver, independent postcondition verifier, and idempotent tracker consumer before claiming those capabilities.

Deliverables:

- Define `AgentRun`, observation, action proposal, consent, pause reason, budget and journal schemas from the architecture document.
- Implement a pure state reducer and IndexedDB transaction adapter with run revision, application lease/fencing token, per-intent dispatch claim, event ordering, and idempotent tracker outbox.
- Add an experimental controller flag that defaults off and only targets an explicit local fixture allowlist initially.
- Keep field values out of diagnostic event payloads; use references to the private profile store.
- Record a baseline report for the current deterministic engine and commands using existing fixtures. Do not convert old test counts into a new agent coverage claim.

Acceptance:

- A worker restart restores a run and forces a fresh observation before a new mutation.
- Repeated messages and competing panel instances cannot dispatch the same intent twice.
- A delayed command from an expired lease owner is rejected by the executor, including after a worker restart.
- A crash after intent persistence has an explicit recoverable/uncertain state.
- Existing policies, profile backups, manual fill, and current `npm run verify` remain intact.

## AG-02: simple onboarding and preferences

Primary locations: `packages/candidate-schema`, `packages/profile-core`, `packages/resume-parser`, and extracted components under `apps/extension/src/sidepanel`.

Deliverables:

- Split the side-panel monolith into feature modules without changing behavior first.
- Build resume/free-text intake, compact fact review, preferences, and a readiness summary.
- Add structured compensation currency/period, current-versus-expected distinction, location/work arrangement, target roles, notice period, and exclusions.
- Keep extracted assertions unverified; attach document/narrative provenance and handle conflicts through the current vault.
- Offer editable details progressively; display actionable missing information rather than technical mapping codes.
- Add versioned migration, round-trip backups, downgrade/rollback guidance, and an explicit sync compatibility decision for new preference fields.

Acceptance:

- Existing profiles import without loss; a failed migration leaves the original intact.
- An expectation such as “want to work with Rust” does not become “experienced in Rust.”
- Current salary, expected salary, experience duration, location, and work authorization remain distinct.
- A new user can complete setup from the UI without reading developer documentation. Test keyboard and narrow-panel flows.

## AG-03: emulations and outcome harness

Primary locations: `apps/test-ats`, new fixture folders under `fixtures`, proposed `evals/agent`, existing Playwright setup.

Deliverables:

- Implement the search/dialog/screening/review scenarios in [PLATFORMS.md](./PLATFORMS.md).
- Add a resettable server-side application ledger with validation and a ground-truth outcome endpoint available only to the test runner. Use a separate runner channel or authenticated endpoint whose token is never exposed to the application browser, page, or model; the application endpoint must not expose expected answers.
- Add deterministic fault injection for stale layouts, delayed rendering, closed tabs, expired sessions, validation errors, and accepted submissions with lost responses.
- Seed synthetic employers, ratings, roles, profiles, and counterfactual questions.
- Separate visible page content from expected answers and success labels. The agent must not receive test-answer files or verifier endpoints.

Acceptance:

- Replaying a seed produces equivalent job/form state and expected outcome.
- The runner distinguishes a correct application, a false confirmation, a duplicate, and a required pause.
- A local run cannot navigate into a real employer application through a fixture link.
- Start with twenty smoke scenarios; grow and partition the acceptance corpus as defined in the evaluation document.

## AG-04: provider routing and budgets

Primary locations: `packages/ai-gateway`, `packages/grounded-generation`, extension `ai-storage.ts`, new provider adapters and tests.

Deliverables:

- Add task contracts for intake extraction, job interpretation, field interpretation and action proposals. Preserve existing restricted drafting tasks.
- Add capability negotiation for text, image input, structured output, cancellation and token usage. Reject unsupported combinations before a call.
- Add one low-cost hosted provider for the prototype, retain OpenAI compatibility, and define the interface for local inference.
- Normalize provider usage and price snapshots; count failed attempts and output/reasoning charges where reported.
- Implement bounded retry, timeout, token limits, run cost reservation, and an explicit fallback policy. Never silently send a local-only profile to a cloud model.
- Provide a deterministic fixture provider so ordinary CI needs no paid keys.

Acceptance:

- Malformed JSON, wrong task type, unknown targets, fabricated fact refs, prompt injection, timeouts, rate limits and cancellation fail predictably.
- The controller cannot exceed its configured budget by starting several calls simultaneously.
- Missing usage is reported as unknown/estimated, not zero; uncertain metering can stop additional calls.
- The inference router chooses a candidate from measured results in [RESEARCH.md](./RESEARCH.md), with exact versions recorded.

## AG-05: durable application executor

Primary locations: `agent-core`, browser command schema, `scanner.ts`, `form-driver.ts`, `upload-driver.ts`, `ats-page.ts`, navigation/submission packages.

Deliverables:

- Implement the observe/propose/validate/execute/verify loop and target registry.
- Build deterministic handlers for comboboxes, searchable options, date fields, add/remove experience rows, and dynamic validation. Support each handler with synthetic fixtures before declaring it available.
- Preserve existing user-edit tracking and resolve page/profile conflicts visibly.
- Add freshness checks for tab, frame, document, job, profile, viewport and answer revision.
- Generalize workflow state for local dialog and multi-page emulations while keeping existing production URL restrictions.
- Add bounded visual fallback as a separate capability and test optional debugger permission/attachment lifecycle.
- Add Pause, Resume, Take over, Cancel, loop detection, and timeout/uncertain-outcome recovery.

Acceptance:

- A successful click is not counted as a completed step without state verification.
- A changed dropdown order cannot silently change the chosen answer.
- Resume upload verifies the retained file, not just the input assignment.
- An unresolved submitted outcome never triggers an automatic second submission.
- User takeover, revoked permissions, changed account/job, or an access challenge stops new actions.

## AG-06: correction memory and workflow skills

Primary locations: proposed `packages/feedback-memory`, `packages/saved-response-engine`, profile and side-panel memory components, `evals/agent`.

Deliverables:

- Record reviewed correction events with rejected/accepted interpretation, semantic scope, user, profile revision, evidence and expiry.
- Separate user facts, answer templates, procedural skills, ranking preferences, and transient failures.
- Retrieve a bounded set after exact ownership/scope filters; start with lexical/canonical matching, adding embeddings only if they improve held-out retrieval.
- Add memory inspection, edit, forget, conflict handling, and derived-index deletion.
- Promote procedural skills through candidate, offline-validated, active and retired states. Store parameterized typed actions, not executable page text.

Acceptance:

- A corrected country/dial-code or current/expected-salary mapping improves equivalent tasks without transferring to deliberately different meanings.
- One user's answers never appear in another profile's run.
- Profile updates, expiry, invalidated skills and deletion remove stale answers from retrieval.
- Published regression fixtures use synthetic values; global rule changes require tests and code review.

## AG-07: discovery and ranking

Primary locations: proposed `packages/discovery-core`, job schema, application-state, new Jobs UI.

Deliverables:

- Add connector contracts and capability/status registry, source health, budgets, pagination, cancellation and freshness.
- Implement local seeded search and pasted-description/URL import first. Add permitted public feeds/APIs or reviewed page connectors incrementally.
- Normalize discovery provenance separately from destination ATS identity; deduplicate across sources and recheck availability before applying.
- Apply hard exclusions and transparent fit criteria, then compare optional embedding retrieval/reranking against that baseline.
- Store dismissal reasons as user preferences, not facts about the employer or evidence that form filling failed.

Acceptance:

- Same role discovered twice produces one candidate job with both source references.
- Expired/unknown availability and unknown salary remain visible states.
- Hard exclusions are correct on labeled fixtures; every fit explanation references known facts.
- Read budgets and rate-limit stops work across pagination and retries.

## AG-08: company evidence

Primary locations: proposed `packages/company-research`, job/company evidence schemas, Jobs UI, synthetic review fixtures.

Deliverables:

- Implement employer identity resolution, evidence import/provider interface, source timestamps and cache.
- Represent source rating, scale, review count, geography, and uncertainty separately from summaries.
- Show conflicting, stale, absent or small-sample evidence without inventing a composite reputation score.
- Add source-backed summaries for available evidence, with a user-readable explanation of missing data.

Acceptance:

- Similarly named employers and staffing agencies do not merge automatically without adequate evidence.
- Missing Glassdoor access is Unavailable, never zero stars.
- A displayed numerical rating matches its cited source scale and date.
- Repeated jobs at one employer reuse permitted cached research within freshness rules.

## AG-09: one-click local product slice

Primary locations: side-panel product UI, `agent-core`, tracker, local fixtures and browser evaluations.

Deliverables:

- Connect intake, shortlist, company evidence, per-job review, run progress, grouped questions, correction memory and tracker.
- Display capability-specific actions: Prepare application versus Apply in the enabled local emulation.
- Bind consent to job/destination, profile/resume revision and reviewed answers. Unexpected questions invalidate the affected part and reopen review.
- Confirm the synthetic server accepted exactly one application with correct values before showing Submitted.
- Record onboarding completion, manual interventions, run completion, failures, latency and complete-run cost.

Acceptance:

- Complete the first delivery scenario in the [plan index](./README.md), including a second run improved by a correction.
- Meet the proposed local gates in [LEARNING_AND_EVALUATION.md](./LEARNING_AND_EVALUATION.md).
- Complete a small observed usability study with at least five new users using synthetic profiles. Report setup failures and feedback; do not treat this as broad usability validation.
- The existing production extension behavior remains available behind the normal build.

## AG-10: live connector assessment and research pilot

Primary locations: discovery connectors, ATS drivers, site-policy registry, private research artifacts, public sanitized reports.

Deliverables:

- Assess LinkedIn, Naukri, Wellfound and company sources independently using the diagnostic sequence in the platform plan.
- Record actual scope references, approved target/account context, stricter limits, capability evidence and research expiry. Start with read-only inspection; never send synthetic applications to an unrelated live employer.
- Report exact observed failures: tool error, rendering, login, challenge, denial, rate limit, unavailable listing, or unsupported widget.
- For a supported live preparation pilot, add bounded user-selected runs and explicit stop behavior.
- Any proposed live navigation/submission capability needs its own threat review, named target validation, consent semantics, compatibility tests and rollback switch before enabling. Update `packages/shared`, command schemas, `SECURITY.md`, `CONTRIBUTING.md`, current README and architecture records together if that release changes existing promises.

Acceptance:

- No blanket platform-support claim based only on a public search page.
- Reports identify source method, observation date, sample size, permitted operation and limitations; unsuccessful access remains documented.
- Unknown or expired capability/scope fails closed. Tests cover redirects, lookalike origins and page attempts to self-authorize.
- Live unsupported paths retain a usable manual/import handoff. Security evasion is not a completion criterion.

## AG-11: local model option and companion decision

Primary locations: gateway local provider, optional `apps/agent-companion`, platform installers, model benchmark configurations.

Deliverables:

- Profile the actual target hardware before choosing model size/quantization or download defaults.
- Support one documented local runtime first, with health check, model capability probe, explicit download consent and understandable setup instructions.
- Benchmark Qwen candidates from the research matrix against the same frozen workload as the hosted baseline.
- Implement exact-origin access, authenticated pairing where needed, loopback binding, request/response size limits, and secret redaction.
- If no companion is required, record that decision and keep installation extension-only for hosted mode.

Acceptance:

- Air-gapped/local-only tests make no external inference calls; cloud fallback is never implicit.
- Unknown browser origins and arbitrary endpoint forwarding are rejected.
- Report RAM/VRAM, model revision, quantization, peak memory, latency, throughput, and correctness; do not promise acceptable speed on untested laptops.
- Stopping the local runtime pauses the application rather than losing run state.

## AG-12: offline learning research

Primary locations: versioned synthetic datasets and proposed training/evaluation tooling outside the production extension bundle.

Deliverables:

- Compare no-memory, correction-memory, workflow-memory and optional supervised fine-tuning baselines before choosing RL.
- Train only with opt-in sanitized/synthetic trajectories, license-checked base weights, and resettable simulator tasks.
- Implement verifiable outcomes, hard safety constraints, reward-hacking tests, disjoint template splits and training manifests.
- Use WebRL/SkillRL-style curriculum or skill-conditioned RL only if it improves a measured deficit. No automatic weight changes during live applications.

Acceptance:

- The training run has fixed data/model/code versions, compute budget, reproducible evaluation and a rollback artifact.
- The model improves held-out performance over the memory-only baseline without new critical failures or unacceptable cost.
- A negative result is acceptable research output. Do not ship RL simply to check a feature box.

## AG-13: distribution and rollout

Primary locations: release automation, docs, onboarding, diagnostics/export UI, capability registry.

Deliverables:

- Package reproducible extension artifacts and checksums; document upgrade/reload and migration recovery.
- Provide a demo mode without credentials or API keys using deterministic fixtures.
- Explain local-only and hosted inference, current source availability, real versus emulated behavior, pause reasons and complete-run costs.
- Provide consented redacted bug reports, a contributor guide for connectors, and small labeled issues.
- Roll out each capability to a small consented pilot, then widen only after reviewing its results. Disable a regressed adapter without disabling profile/tracker access.

Acceptance:

- A newcomer can install the artifact, run the demo and understand which live features are available.
- Current README claims match actual capabilities and evidence. Research-only behavior is visibly labeled.
- Release rollback preserves profiles and exposes uncertain application outcomes honestly.

## Contributor issue template

For each work package, open focused issues with: user outcome, owning paths, dependencies, schema/version changes, tests, manual checks, data/permission changes, and a demo artifact. Use checklists for implementation evidence, not a generic “done” marker. Add owner and PR links here once assigned.

## Verification and estimates

Use existing `npm run format:check`, `npm run lint`, `npm run typecheck`, targeted Vitest/Playwright checks, and `npm run verify` for implementation releases. Agent smoke, benchmark and training scripts are proposed deliverables; do not document them as runnable commands until added.

Planning-only changes require Markdown formatting, link checks and `git diff --check`, not another full browser suite. Implementation estimates should be made after AG-01/AG-03 spikes and hardware/source assessment. The advanced agent is a substantial follow-on project; calendar promises before those findings would be speculative.
