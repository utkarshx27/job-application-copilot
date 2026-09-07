# Application agent implementation plan

Status: **Implementation started: AG-01 durable foundation and a read-only local agent lab. AG-02–AG-13 remain planned.** The complete end-to-end agent is not available yet. See [lab usage and implementation evidence](./AGENT_LAB.md).

Prepared: 2026-09-06. Repository baseline: `351a034`.

## Product objective

Build an assistant that lets a person upload a resume, describe their background and preferences, discover relevant jobs, evaluate employers, and start a supported application with one clear action. The assistant handles known fields and multiple steps, asks for missing information, learns from reviewed corrections, and records a verified outcome.

The primary measure is how much correct work the user completes with less effort. A larger list of detected ATS names is not an adequate success measure.

## Read these documents in order

| Document                                                | What it decides                                                                                           |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [Architecture](./ARCHITECTURE.md)                       | Browser access, controller, models, storage, actions, recovery, and integration with existing packages    |
| [Discovery and platform integration](./PLATFORMS.md)    | LinkedIn, Naukri, Wellfound, employer ATS, company research, and capability-specific support              |
| [Implementation work packages](./IMPLEMENTATION.md)     | Dependency order, files/packages, deliverables, acceptance criteria, and contributor handoffs             |
| [Learning and evaluation](./LEARNING_AND_EVALUATION.md) | Correction memory, workflow skills, optional offline reinforcement learning, and measurable release gates |
| [Research and model decisions](./RESEARCH.md)           | Primary papers, current model candidates, pricing assumptions, and adopted versus deferred techniques     |

These are living work packages, not a reopening of the completed numbered MVP phases. Track implementation and ownership in GitHub issues; update these documents when evidence changes a decision.

## Intended user experience

1. **My profile:** upload a resume, optionally describe experience in free text, and review a compact summary. Confirm location, target roles, work arrangement, compensation currency/period, notice period, exclusions, and any missing facts. Separate wishes from experience claims.
2. **Find jobs:** start a bounded search with chosen sources. Show a shortlist with freshness, salary availability, fit reasons, and exclusions. Pasted job descriptions and URLs also work.
3. **Review a job:** show the actual employer and role, duplicate status, resume version, job-fit reasons, employer evidence, and the available application capability.
4. **Apply:** one per-job action authorizes the supported workflow using reviewed facts. The default initial release prepares the application; a separately released submission capability can complete approved flows. Unknown questions appear together when possible, not as a stream of field-level dialogs.
5. **See progress:** use plain states such as Preparing, Needs your answer, Ready for review, Submitted, or Could not verify. Show Pause, Resume, Take over, and Cancel. Put confidence codes and field traces under Details.
6. **Improve the next application:** offer to remember a correction with an appropriate scope. Keep an editable memory page and explain when a remembered answer was used.

One-click completion is conditional: all required answers must be known, the connector must support the flow, and no new declaration or access challenge may arise. Browser operation requires Chrome and the machine to remain running; it is not a cloud job that continues after shutdown.

## What exists and what must be built

The current extension already provides local profiles, document parsing, deterministic matching, reviewed answers, grounded drafts, ATS adapters, upload assistance, a tracker, duplicate handling, and optional encrypted sync.

The experimental foundation now has typed run state, transactional persistence, leases, checkpoint recovery, and a local read-only controller. Missing capabilities include a simple onboarding flow, discovery connectors, explainable job ranking, company evidence, a browser-mutating application controller, generalized custom-control interaction, local/non-OpenAI providers, correction memory, and a benchmark for end-to-end application correctness.

The present code explicitly blocks LinkedIn automation and limits automatic Next/Submit to an exact local Workday fixture. Its model tasks cannot control the browser. This proposal does not change those guarantees. See [current security policy](../../SECURITY.md) and [architecture records](../architecture/README.md).

## Research and release scope

- Implement the complete automated workflow first on resettable local emulations with synthetic accounts, jobs, companies, and application data.
- Assess live public pages and user-authorized sessions by capability, with recorded research scope and conservative access budgets. A public fetch result is not proof of an integration or permission to submit applications.
- The maintainer reports research permission from platforms. Supporting scope has not been independently verified here; do not describe the project as officially partnered or approved. Track any evidence privately, without credentials in this repository.
- Live automated navigation/submission requires a reviewed connector release and corresponding code, permission, documentation, and test changes. A research configuration file alone cannot unlock it.
- Security-control bypass, stealth identity changes, CAPTCHA solving, proxy rotation to defeat restrictions, and account-restriction evasion are outside this implementation plan. A challenge becomes a diagnosed pause and a research finding.

The research product can remain useful while individual live connectors are unavailable: offer permitted sources, pasted descriptions, employer application links, and local demonstrations with an honest support matrix.

## First end-to-end delivery

The first delivery should demonstrate this complete path:

> Import a synthetic resume, confirm preferences, discover seeded jobs, inspect fit and company evidence, choose a job, complete a multi-step local application, verify exactly one accepted submission, and reuse a reviewed correction on a second application.

It must also demonstrate a missing-answer pause, a changed question, an interrupted browser worker, and an uncertain submission result. A success-only demo is insufficient.

The first implementation delivers the **AG-01 foundation** in [IMPLEMENTATION.md](./IMPLEMENTATION.md). Continue with **AG-02 onboarding** and **AG-03 emulations**. The first useful end-to-end product slice ends at **AG-09**; live connector assessment, local model packaging, and offline training have their own dependencies.

## Decisions and open measurements

| Decision         | Initial choice                                                | Revisit when                                                      |
| ---------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| Existing project | Evolve current TypeScript extension and packages              | A measured runtime constraint requires a companion                |
| Browser control  | DOM-based controller; opt-in vision fallback                  | Held-out custom-control tasks demonstrate a gap                   |
| Job sources      | Capability-based connectors plus manual import                | Access and quality are established per source                     |
| Inference        | Deterministic first, small-model fallback, bounded escalation | Task-specific accuracy/cost measurements justify a change         |
| Learning         | Reviewed corrections and validated workflow memory            | Offline experiments show a benefit from updating weights          |
| Runtime          | One durable controller with bounded workers                   | Profiling demonstrates a need for distributed infrastructure      |
| Submission       | Local emulation first; separately gated live capability       | Connector-specific evidence and release review pass               |
| Public pricing   | No per-application cost promise                               | Complete-run token, search, retry, and hosting costs are measured |

Hardware, acceptable monthly spend, live research scope, and initial production connector remain open product inputs. They do not block the local vertical slice. Do not invent those values or purchase services while implementing the plan.
