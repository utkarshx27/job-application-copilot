# Inference prototype and local GPU experiment

AG-04 now has a separate structured inference router, provider adapters, and transactional budget storage. AG-11's hardware/model experiment was brought forward at the user's request. This is developer-facing infrastructure, not a completed browser agent or a new option in the production OpenAI drafting panel. AG-05 must connect the executor; AG-11 still needs the browser pairing/access boundary and product setup flow.

## Implemented boundaries

- Tasks: intake extraction, job interpretation, field interpretation, and action proposals. The existing restricted drafting gateway remains unchanged.
- Strict schemas reject extra properties, arbitrary selectors, unknown references, stale observation references, unsupported actions, and proposals against manual-only targets. Generation is constrained to caller-supplied identifiers, not benchmark answer keys.
- Extracted values must occur in their quoted source span and remain `REVIEW_REQUIRED`. A quote proves text provenance, not the correctness of the model's classification. No generated extraction updates a verified profile automatically.
- Adapters: OpenAI Responses, Gemini 3.1 Flash-Lite Generate Content, deterministic fixtures, and two explicitly allowlisted local Ollama candidates. Hosted wire contracts are tested with mocks; no hosted API calls or paid benchmarks were performed.
- The router rejects unapproved cloud routing. Local-only mode has no implicit hosted fallback. Image input is not supported in this prototype; text/structured-output/cancellation/usage capabilities must be present.
- Requests have bounded input preflight, output limits, deadlines, response sizes, and at most two retries. Only explicitly metered rate limits may retry. A timeout or missing usage stops that run; errors are not treated as zero-cost calls.
- USD micro-unit reservations and immutable limits are stored atomically in IndexedDB, before invoking a provider. One in-flight request per run prevents concurrent overspending. A worker crash leaves a pending reservation; reopening storage cannot recreate the same run to reset it.
- Usage includes reported output/reasoning charges. Reasoning is a subset of billed output, not charged twice. Price snapshots identify provider, model, source, date, and expiry. Input preflight is conservative estimation, not a provider tokenizer or a guarantee of the vendor's final bill. Usage exceeding the reserved bounds blocks further calls and preserves the reported charge.
- Audits contain provider/model, limits, usage, and statuses, not prompts, profile facts, credentials, or answers. The **synthetic-only benchmark report** deliberately includes generated answers for diagnosis and stays Git-ignored.

The router does not execute browser actions, grant consent, load arbitrary endpoints, import an entire profile, or choose an alternative provider automatically. Callers must supply narrowly scoped verified fact references and validate page/document freshness again before any future execution.

## Local runtime

Measured machine: GTX 1650, 4 GB VRAM, 16 GB system RAM. Runtime: Ollama `0.33.3`, Windows AMD64. Downloads and model weights are in `.tmp/local-inference`, ignored by Git. System PATH was not changed. Ollama may also maintain its normal per-user runtime configuration.

For this workspace, start the downloaded runtime in one terminal:

```powershell
npm run inference:serve
```

The launcher sets loopback binding, one loaded model, single-request parallelism, and `OLLAMA_NO_CLOUD=1`. It does not install or download anything. Stop the launcher with Ctrl+C when finished. No wildcard browser-origin permission is added. This is a Node-side research setup, **not** an authenticated browser companion or a claim of a fully air-gapped runtime; direct extension integration remains pending.

On a fresh Windows checkout, download the [official Ollama 0.33.3 archive](https://github.com/ollama/ollama/releases/tag/v0.33.3), verify the publisher's SHA256, and extract `ollama-windows-amd64.zip` to `.tmp/local-inference/ollama-v0.33.3`. The archive used here had SHA256 `52cb36a62e7e501f61514f60212dec7117b6c098811357585e02fffe32d2fcd7`. Model downloads require a separate explicit choice; the application never pulls them automatically. On other operating systems, use the official Ollama installation and equivalent loopback/model-directory/cloud-disabled settings; the supplied launcher is Windows-only.

With the server running, download a chosen candidate if it is not already present:

```powershell
& .\.tmp\local-inference\ollama-v0.33.3\ollama.exe pull qwen3:1.7b
& .\.tmp\local-inference\ollama-v0.33.3\ollama.exe pull qwen3:4b-instruct-2507-q4_K_M
```

These are separate choices, not required downloads for ordinary extension users. Approximate model download sizes are 1.36 GB and 2.50 GB, excluding the runtime. The adapter checks the installed model digest before each call and records it in the report. It does not accept arbitrary model names or remote/cloud tags.

## Run and interpret the benchmark

```powershell
npm run inference:benchmark -- --fixture
npm run inference:benchmark -- --local
npm run inference:benchmark -- --local --4b
```

Reports: `test-results/inference/fixture-report.json`, `local-1.7b-report.json`, and `local-4b-report.json`. A nonzero exit code means at least one benchmark case failed; inspect the per-case result. It must not be changed to success merely because a runtime responded.

Workload `agent-smoke-v1` has ten synthetic cases: five field interpretations, goal versus experience extraction, grounded action proposal, a manual-only injection challenge, and cited job interpretation. Prompt/schema revision `agent-inference-v3` uses constrained identifiers. Each case has a separate zero-API-cost, one-attempt budget; there is no cloud fallback or automatic retry. Local electricity and hardware costs are not estimated.

Ollama's grammar compiler rejected the original nested length bounds. The adapter now removes only those expensive bounds/patterns from the generation grammar; the full original output schema and grounding validator still run afterward. This is a transport compatibility change, not relaxed acceptance.

This workload was used during development, so it is **not held out**. It does not measure end-to-end application success, prove general prompt-injection resistance, or justify real auto-submit. Freeze and expand disjoint cases before promoting a model or connecting any automatic action capability.

## Current evidence and decision

The initial generic-schema runs scored 5/10 on both candidates. With the same constrained-identifier revision, the smaller candidate scored 7/10 and the 4B candidate scored 9/10. The latter's remaining failure was an unnecessary pause on a permitted fill. No validation rule was weakened to make that pass.

| Candidate                     | Development smoke checks | Observed loaded GPU allocation                | Observed later-case latency |
| ----------------------------- | ------------------------ | --------------------------------------------- | --------------------------- |
| Qwen3 1.7B Q4_K_M             | 7/10                     | 2.18 GB, fully GPU-resident in this sample    | 0.8–2.9 seconds             |
| Qwen3 4B Instruct 2507 Q4_K_M | 9/10                     | 2.29 GB of 4.13 GB total; partial CPU offload | 3.9–8.5 seconds             |

Validation on 2026-09-08: `npm run verify` passed formatting, lint, type checking, builds, 183 unit tests across 40 files, and all 60 browser regression tests. The local model benchmark intentionally exits nonzero when a case fails; its model-quality result is separate from passing software regression tests.

The 4B run reported about 2.29 GB in VRAM out of a 4.13 GB loaded allocation at 8K context, indicating partial CPU offload. The first case took 17.9 seconds; later cases took roughly 3.9–8.5 seconds. These are observed run samples, not latency guarantees or sampled peak memory. Model digest: `0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0`, Q4_K_M. The smaller candidate's digest is `8f68893c685c3ddff2aa3fffce2aa60a30bb2da65ca488b61fff134a4d1730e7`, Q4_K_M.

The 4B candidate is suitable for **further reviewed interpretation experiments**, not approved automatic application execution. The small model's earlier narrative classifications were unreliable. Keep deterministic matching first and uncertain tasks manual. No hosted model was selected or charged.

## Sources and remaining work

The OpenAI Docs skill informed the Responses schema, output cap, and usage normalization using the [Responses reference](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create) and [structured output guide](https://developers.openai.com/api/docs/guides/structured-outputs). The budget-hosted adapter follows [Gemini Generate Content](https://ai.google.dev/api/generate-content); the research price source remains [Google pricing](https://ai.google.dev/gemini-api/docs/pricing), not a hard-coded live billing promise. Local transport follows [Ollama chat](https://docs.ollama.com/api/chat), [model metadata](https://docs.ollama.com/api/tags), and [configuration](https://docs.ollama.com/faq). The [1.7B](https://huggingface.co/Qwen/Qwen3-1.7B) and [4B Instruct](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507) model cards identify the Apache-2.0 upstream models.

Still open: broader frozen model benchmarks; hosted live validation only if requested; authenticated local browser pairing and runtime health UX; inference budget integration with durable application runs; visual capability negotiation; AG-05 execution and AG-06–AG-10/AG-12–AG-13 product, evaluation, and release work. Do not mark those packages complete based on this inference smoke test.
