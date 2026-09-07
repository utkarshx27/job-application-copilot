# Discovery, company research, and platform integration

Status: local portal emulations and a fallback test driver are implemented in AG-03; live connectors remain proposed. See the [coverage and usage guide](./SETUP_AND_PORTALS.md) and [repository README](../../README.md).

## Separate sources from application destinations

A LinkedIn or Naukri listing may send the applicant to an employer ATS. A discovery connector, a company-evidence provider, and an application driver are separate components with separate permissions and support tests.

Extend `NormalizedJobSchema` without relabeling a job board as an ATS. Add source records in `discovery-core`, retain the destination adapter ID, and associate multiple source records with a canonical job. Preserve provenance and redirect history while stripping tracking/session parameters from exported URLs. Do not remove parameters that identify a requisition or tenant.

Each connector reports these capabilities independently:

- discover public jobs;
- read a selected job;
- inspect an authorized account session;
- prepare a form;
- navigate supported steps;
- submit with job-specific consent;
- read confirmation;
- fetch company evidence.

A capability has `UNASSESSED`, `EMULATED`, `RESEARCH_VALIDATED`, `RELEASED`, or `UNAVAILABLE` status, plus version, target origins/routes, authentication requirement, evidence date, and stop reasons. A working public page is not a blanket Supported badge.

## Initial source matrix

| Source        | Initial prototype                                                 | Live work to assess                                                                                                                | Limits to expose                                                                          |
| ------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| LinkedIn      | Synthetic search and Easy Apply-style modal flow                  | Selected public listing access and external ATS handoff; any account workflow requires separately reviewed scope and policy change | Current repository blocks LinkedIn automation; an emulation cannot turn it on             |
| Naukri        | Synthetic search, screening questions, profile/application dialog | Normal browser rendering, selected listing extraction, account boundary, answer semantics                                          | Previous web fetch failed without a diagnosed cause; no live connector validated          |
| Wellfound     | Synthetic startup listings and application flow                   | Selected listing extraction, account-required steps, salary/equity semantics                                                       | Public search content was readable in a limited tool check; application behavior untested |
| Employer ATS  | Reuse existing synthetic Greenhouse/Lever/etc. fixtures           | Prefer supported public feeds/APIs and independently assess application routes                                                     | Existing detection/native fill does not certify automatic step completion                 |
| Glassdoor     | Synthetic review summaries with source metadata                   | Authorized company lookup and available rating data                                                                                | No live extraction validated; missing data must remain unknown                            |
| Manual import | Paste description or selected URL                                 | User-provided job/evidence import                                                                                                  | A URL alone may not supply a readable description                                         |

Local emulations reproduce interaction patterns with original synthetic content. They do not clone proprietary pages, use real accounts, or submit to real employers.

## Access assessment and diagnostics

Use a bounded assessment for each connector before implementing scheduled discovery:

1. Record the target URL class, research scope reference, account context, allowed operations, and expiry. Keep permission documents private; the public manifest contains only a reference and capability status.
2. Try ordinary public HTTP access when appropriate. Record status, content type, redirect origin, timestamp, and whether meaningful job data is present.
3. If the result is an empty JavaScript shell or incomplete content, inspect it in a normal browser session. Use DOM/accessibility extraction before considering vision.
4. Distinguish `RENDERING_PENDING`, `LOGIN_REQUIRED`, `CHALLENGE_PRESENT`, `ACCESS_DENIED`, `RATE_LIMITED`, `JOB_EXPIRED`, `UNSUPPORTED_LAYOUT`, and `FETCH_ERROR`.
5. Stop on access denial or a challenge. Return evidence to the research team; do not label an unknown fetch failure as a proven security block.
6. Save only sanitized metadata or synthetic reproductions for public fixtures. Preserve private traces only with explicit research retention settings.

Do not use robots.txt as proof of permission; consider it alongside actual source terms and the recorded scope. Existing platform restrictions remain relevant: [LinkedIn automated activity](https://www.linkedin.com/help/linkedin/answer/a1340567/automated-activity-on-linkedin?lang=en), [Wellfound terms](https://wellfound.com/terms), [Glassdoor terms](https://www.glassdoor.com/about/terms/). Recheck them at live connector implementation time. Naukri's current terms were not retrievable in this research pass.

Conservative prototype ceilings: one in-flight read per source, at least five seconds between automated reads, at most twenty detail pages in a user-started run, and no scheduled crawling by default. These are project ceilings, not platform-granted allowances; use the stricter recorded limit. Honor `Retry-After`, stop the run on a block, bound redirects, and prevent background retry loops. Cache reusable job/company data according to source rules and freshness needs.

## Discovery pipeline

1. Convert reviewed preferences into bounded source queries. Do not include a full resume or contact data in search queries.
2. Fetch/import listings through available capabilities, with pagination and cancellation limits.
3. Normalize title, company, location, remote policy, skill requirements, salary currency/period, posted date, source ID, and application destination.
4. Validate suspicious redirects and reject unsupported protocols and private-network destinations in remote fetchers. A user-selected local test origin is a separate explicit capability.
5. Deduplicate by source requisition identity and canonical destination; use fuzzy title/company matching only to flag uncertain duplicates.
6. Apply hard preferences first; classify unknown facts separately from incompatible facts. Do not exclude salary-unknown jobs unless the user explicitly chooses that rule.
7. Rank the surviving jobs and show reasons, uncertainty, freshness, and missing information.
8. Recheck job availability, account context, and duplicate state before applying.

Search and company research can run independently within their budgets. Filling and submission for the same application must be serialized.

## Explainable ranking

Start with transparent weighted criteria and deterministic exclusions. Use embeddings to recall semantically related roles, then a small model only for top-candidate interpretation. Add a learned reranker after collecting user judgments.

Proposed fit dimensions are skills/experience, role preference, location/work arrangement, compensation compatibility, and user exclusions. Store score components, applicable weights, evidence IDs, and `unknown` dimensions. Renormalize only known soft dimensions and separately display evidence coverage; never present a sparsely evidenced high score as equally certain.

User expectations in free text are preferences, not evidence of experience. Do not infer protected characteristics or invent eligibility. Distinguish current salary from expected salary, monthly from annual pay, total experience from skill-specific experience, and work authorization from sponsorship. Salary conversion requires an explicit exchange-rate source and date; otherwise compare like units or mark unavailable.

Ranking acceptance is measured with user-labeled relevance pairs and hard-filter accuracy, not an LLM's opinion of its own scores. User dismissal reasons may improve ranking preferences, but rejection by an employer is too ambiguous to treat as a form-filling error.

## Company evidence

Resolve the actual employer using name, domain, location, and listing identity. Treat staffing agencies, similarly named entities, subsidiaries, and brands explicitly. Ask or mark unresolved when entity matching is ambiguous.

Store source, retrieval date, rating scale, review count, geography/role relevance, and permitted short supporting evidence. Keep source rating separate from model-written summaries. Use multiple permitted sources when available; do not fabricate Glassdoor ratings from general web sentiment or treat inaccessible data as a low score.

The UI presents two separate cards: job fit and employer evidence. Explain stale, small-sample, conflicting, or unavailable data. A source-specific low review count reduces certainty, not automatically the company's score. Let users choose exclusions and reputation preferences rather than silently rejecting employers.

Cache company research by resolved entity and evidence freshness, so ten jobs at the same company do not trigger ten model/research runs. Store only what the source permits. Synthetic rating records must display a Demo label and must never be mixed into live research results.

## Local emulation suite

Extend `apps/test-ats` with original fixtures for:

- searchable listings with pagination, stale jobs, duplicates, and external ATS destinations;
- application modals with progress indicators and add/remove work-history rows;
- Naukri-style screening with notice period, experience, current/expected compensation, and unavailable answers;
- Wellfound-style motivation, startup preferences, salary/equity fields, and company-name collisions;
- company reviews with conflicting scores, small counts, missing ratings, and stale evidence;
- login/session-expiry and access-challenge screens that require a pause;
- delayed rendering, shadow roots, nested frames, custom comboboxes, responsive layouts, and retained uploads;
- submit accepted but response lost, duplicate clicks, worker restart, and mismatched confirmation identity.

Each fixture needs a resettable server-side state and an expected outcome that the model cannot edit. Visual resemblance is secondary to the interaction and failure behavior being tested.
