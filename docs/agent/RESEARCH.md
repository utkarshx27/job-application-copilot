# Research review and model decisions

Evidence checked: **2026-09-06**. This is a focused primary-source review, not an exhaustive survey. Dates below refer to paper submissions/revisions or verified documentation, not search-engine crawl dates. Adoption recommendations are project design judgments. Published benchmark scores do not establish job-application reliability.

## Browser-agent and evaluation research

| Work and primary source                                                                                                                                           | Verified date                  | Relevant finding/design idea                                                              | Project decision and limit                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [WebArena: A Realistic Web Environment for Building Autonomous Agents](https://arxiv.org/abs/2307.13854), Shuyan Zhou et al.                                      | Initial submission 2023-07-25  | Reproducible interactive web tasks with functional outcome evaluation                     | Use resettable application environments and outcome assertions. General web-task results do not certify ATS behavior.                                         |
| [The BrowserGym Ecosystem for Web Agent Research](https://arxiv.org/abs/2412.05467), Thibault Le Sellier De Chezelles et al.                                      | 2024-12-06; revised 2025-02-28 | Common environment interfaces and AgentLab experiment management across web benchmarks    | Reuse its observation/action/evaluation separation; evaluate integration later. Keep Playwright as the existing test harness initially.                       |
| [Mind2Web 2: Evaluating Agentic Search with Agent-as-a-Judge](https://arxiv.org/abs/2506.21506), Boyu Gou et al.                                                  | 2025-06-26; revised 2025-07-03 | Long-horizon search and source-attribution assessment                                     | Evaluate job/company answers against explicit factual/source rubrics. A model judge is supplemental, especially for numerical ratings and candidate facts.    |
| [OSWorld 2.0: Benchmarking Computer Use Agents on Long-Horizon Real-World Tasks](https://arxiv.org/abs/2606.29537), Mengqi Yuan et al.                            | 2026-06-28; revised 2026-07-13 | Long workflows expose state-tracking, constraint, clarification and verification failures | Add interruption, hidden-state and multi-step tests. Its desktop/professional workload differs substantially from job forms; do not transplant success rates. |
| [AgentDojo: A Dynamic Environment to Evaluate Prompt Injection Attacks and Defenses for LLM Agents](https://arxiv.org/abs/2406.13352), Edoardo Debenedetti et al. | Initial submission 2024-06-19  | Agents encounter malicious instructions through external tool data                        | Treat retrieved listings, reviews and form text as untrusted. Test task success and forbidden effects separately.                                             |
| [BrowseSafe: Understanding and Preventing Prompt Injection Within AI Browser Agents](https://arxiv.org/abs/2511.20597), Kaiyuan Zhang et al.                      | 2025-11-25; revised 2026-08-12 | Browser-focused injection evaluation and layered defenses                                 | Combine constrained execution, provenance, scope checks and model-side defenses. A detector alone is not an authorization boundary.                           |

The recent OSWorld and BrowseSafe revisions are especially relevant to this proposal's durable controller and untrusted-page boundary. Their presence is not a reason to add every research framework as a dependency.

## Memory and learning research

| Work and primary source                                                                                                                        | Verified date                  | Relevant idea                                                                         | Adoption decision                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366), Noah Shinn et al.                           | 2023-03-20; revised 2023-10-10 | Textual feedback memory improves subsequent decisions without changing weights        | Implement reviewed correction records. Label this correction memory, not trained weights; generated reflections remain provisional.                     |
| [Agent Workflow Memory](https://arxiv.org/abs/2409.07429), Zora Zhiruo Wang et al.                                                             | Initial submission 2024-09-11  | Retrieve reusable workflows derived from trajectories                                 | Implement parameterized control skills with explicit applicability and verified postconditions. Stored recipes must not replay stale selectors.         |
| [WebRL: Training LLM Web Agents via Self-Evolving Online Curriculum Reinforcement Learning](https://arxiv.org/abs/2411.02337), Zehan Qi et al. | 2024-11-04; revised 2025-01-27 | Failure-driven curriculum and policy training for web tasks                           | Evaluate a synthetic offline curriculum only after memory baselines. Its online training setup does not authorize experimentation on live applications. |
| [ReasoningBank: Scaling Agent Self-Evolving with Reasoning Memory](https://arxiv.org/abs/2509.25140), Siru Ouyang et al.                       | 2025-09-29; revised 2026-03-16 | Compact lessons from successful and failed experience; memory-aware test-time scaling | Store outcome evidence separately from inferred lessons. Multiple alternative trajectories are useful in simulation, not repeated live submissions.     |
| [SkillRL: Evolving Agents via Recursive Skill-Augmented Reinforcement Learning](https://arxiv.org/abs/2602.08234), Peng Xia et al.             | Initial submission 2026-02-09  | General/task-specific skills combined with policy training                            | Optional AG-12 comparison after correction/workflow memory. Its task domains do not validate ATS submission behavior.                                   |

Author implementations: [Reflexion](https://github.com/noahshinn/reflexion), [Agent Workflow Memory](https://github.com/zorazrw/agent-workflow-memory), [ReasoningBank](https://github.com/google-research/reasoning-bank), [SkillRL](https://github.com/aiming-lab/SkillRL). Verify licenses, dependencies, data rights and pinned versions before reuse. Research code is not automatically production-ready.

## Model candidates to benchmark

No default model is selected by this plan. Retain the current provider, add one budget-hosted candidate, and profile local candidates on actual target hardware. Models must pass schema, grounding, correctness, latency and data-handling checks under the same fixture budgets.

| Candidate                           | Verified source                                                                                                                                                                  | Intended experiment                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Qwen3-4B-Instruct-2507              | [Official model card](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507); Apache 2.0                                                                                            | Small local text-only interpretation and ranking baseline                                                      |
| Qwen3.5-4B                          | [Official model card](https://huggingface.co/Qwen/Qwen3.5-4B); Apache 2.0, image/text                                                                                            | Local combined text/vision challenger from the 2026 family                                                     |
| Qwen3-VL-4B / 8B                    | [Official series](https://github.com/QwenLM/Qwen3-VL), [8B model card](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct), [Ollama variants](https://ollama.com/library/qwen3-vl) | Visual-grounding baselines; verify exact chosen weights/license before packaging                               |
| Gemini 3.1 Flash-Lite               | [Official pricing](https://ai.google.dev/gemini-api/docs/pricing), model ID `gemini-3.1-flash-lite`                                                                              | Budget hosted structured interpretation/drafting baseline                                                      |
| Gemini 3.5 Flash-Lite               | [Official pricing](https://ai.google.dev/gemini-api/docs/pricing), model ID `gemini-3.5-flash-lite`                                                                              | Newer hosted challenger; keep only if task performance justifies added cost                                    |
| Existing configured OpenAI provider | `packages/ai-gateway/src/index.ts` in this repository                                                                                                                            | Compatibility baseline using a user-selected available model; current code does not implement browser planning |

Open weights do not guarantee that inference is free, fast, private under every serving configuration, or suitable for every laptop. Record runtime/weight revisions, quantization, context, image resolution, peak RAM/VRAM, CPU/GPU offload, time to first token and complete-run latency. Do not select a model based only on download size.

Start local serving with one supported runtime: [Ollama](https://docs.ollama.com/faq), with [Qwen3.5 variants](https://ollama.com/library/qwen3.5). Consider vLLM for a separately managed GPU deployment using model-card serving guidance; it need not be installed by ordinary extension users. Local-only mode must prohibit unannounced remote fallback.

## Cost assumptions

Pricing snapshot, standard API usage, USD per million tokens, checked 2026-09-06:

| Hosted candidate      | Input                      | Output, including thinking where billed |
| --------------------- | -------------------------- | --------------------------------------- |
| Gemini 3.1 Flash-Lite | $0.25 for text/image/video | $1.50                                   |
| Gemini 3.5 Flash-Lite | $0.30                      | $2.50                                   |

Source: [Google's pricing page](https://ai.google.dev/gemini-api/docs/pricing). Recheck availability and rates before implementation/release; store the rate date in benchmark reports.

```text
model_cost = input_tokens / 1_000_000 * input_rate
           + output_tokens / 1_000_000 * output_rate

Illustrative workload: 20,000 input tokens + 3,000 output tokens
3.1 Flash-Lite: $0.0095
3.5 Flash-Lite: $0.0135
```

These are arithmetic examples, not measured application costs. A full run includes every call and retry, screenshot tokenization, search queries, and any cache/infrastructure charges. Calculate cost per successful application across all attempts. Use tokens reported by the provider; character counts alone are not reliable billing evidence.

The pricing page distinguishes free-tier product-improvement use from paid-tier use. Paid use is not a promise of zero retention. Use synthetic/public data for initial free-tier experiments and review provider data handling before sending private resumes or answers. This project should show its routing/data choices clearly.

Cost controls to implement: deterministic fields without model calls, bounded page summaries, reusable company research, scoped memory, maximum output, per-run reservations, capped retries, and visual escalation only when necessary. The target is fewer expensive decisions, not cheap repeated screenshots of the same stalled page.

## Browser and framework decisions

| Tool                        | Primary evidence                                                                                                                                                                                         | Decision                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Chrome extension controller | [Service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger) | Main runtime; durable storage and explicit selected-tab attachment where needed                                        |
| Native companion            | [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)                                                                                                | Optional local bridge with exact extension-origin allowlist; keep bounded messages                                     |
| Playwright                  | [BrowserType documentation](https://playwright.dev/docs/api/class-browsertype)                                                                                                                           | Existing deterministic browser tests and isolated research profiles; CDP has lower fidelity than its native connection |
| Stagehand                   | [Current v4 introduction](https://docs.stagehand.dev/v4/first-steps/introduction), [MIT repository](https://github.com/browserbase/stagehand)                                                            | Optional executor/observation spike; assess current API rather than assume an older Playwright wrapper                 |
| Browser Use                 | [Repository](https://github.com/browser-use/browser-use), [MIT license](https://github.com/browser-use/browser-use/blob/main/LICENSE)                                                                    | Optional Python comparison harness; account for runtime size, telemetry and action validation                          |

Chrome changed remote debugging of the default user data directory starting with Chrome 136. Do not design around exposing the user's everyday Chrome profile through a debug port; use the extension's authorized tab or a dedicated research profile. [Chrome remote-debugging change](https://developer.chrome.com/blog/remote-debugging-port).

A library's license does not establish permission to access a target website. A library's success claim does not establish compatibility with our profile and consent rules. Benchmark adoption behind a repository-owned executor contract.

## What to adopt now and defer

Adopt now: durable state, grounded action references, deterministic verification, small-model routing, correction retrieval, source citations, failure taxonomy, resettable environments and task-level metrics.

Prototype next: selective vision, retrieved control skills, local inference, and source-specific research connectors.

Defer until evidence justifies them: fine-tuning/RL, multiple speculative agent trajectories, distributed schedulers, mandatory GPU installations, cloud browser sessions, large vector databases and always-on model-driven crawling. New papers can be added here through a contribution that explains the implementation consequence and an evaluation plan.
