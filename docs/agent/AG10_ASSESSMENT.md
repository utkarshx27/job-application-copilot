# AG-10: offline connector assessment preparation

Status: **assessment tooling implemented; live assessment and pilot blocked**. AG-09 still needs a fresh held-out evaluation and the observed five-user study. No live connector, browser permission, network request, account access or submission capability is enabled by this tooling.

## Prepare private records

```powershell
npm run agent:connectors -- init
npm run agent:connectors -- report private/ag10/naukri.json
```

Initialization creates five independent templates for LinkedIn, Naukri, Wellfound, Glassdoor and employer ATS assessment. Existing files are never overwritten. Files stay in the git-ignored `private/ag10/` directory. Templates deliberately have null scope and review references: do not invent authorization or observations to obtain a clean report.

The report command writes enum/count/date-only output under ignored `test-results/ag10/`. Exit code 2 means missing/inactive scope or missing review evidence; 1 means invalid input. Successful validation still means **independent review required**, never permission to run. Review any generated artifact before publishing it. Raw source content, account IDs, target URLs and private evidence references are not exported.

## Record scope and evidence

The schema is in `packages/agent-core/src/connector-assessment.ts`. Use opaque references to permission documents, reviewers, approved account context and retained evidence; keep the actual documents private. Never place passwords, cookies, API keys, résumé contents or applicant answers in these records.

A scope records its start/expiry, exact HTTPS origins and paths, allowed capabilities/methods, account context, retention and stricter request limits. Project ceilings are one concurrent read, at least five seconds between reads and at most twenty pages per run; these ceilings do not grant platform permission. The offline target checker rejects credentials, query/fragment-bearing targets, lookalike origins and paths outside the exact scope. This helper is not runtime authorization or DNS/SSRF protection; it does not follow redirects. A future transport must validate every redirect and resolved address independently.

Assess each capability separately: discovery, selected-job read, account inspection, form preparation, step navigation, submission, confirmation and company evidence. Follow the [diagnostic sequence](./PLATFORMS.md#access-assessment-and-diagnostics). Record observation time, method, sample size, HTTP status if known, Retry-After if present and an evidence reference. Distinguish rendering, login, challenge, denial, rate limit, expired listing, unsupported layout, fetch error and out-of-scope redirect. Do not claim a security block from an unexplained fetch failure. Samples are summed observations, not necessarily unique pages.

Even successful observations are marked `OBSERVATIONS_REQUIRE_REVIEW`, not Supported or Released. Unknown/expired scope cannot pass the checklist. Imported records are untrusted assertions; the report never independently verifies permission, human attendance, benchmark correctness or referenced documents. No extension message accepts these records as action authority.

## Before a live pilot can be implemented or started

1. Review fresh held-out AG-09 results and five real new-user observations; resolve findings.
2. Supply connector-specific scope: named target paths, approved account context, permitted operations/methods, rate limits and expiry. Recheck current platform terms at that time.
3. Independently review threat model, compatibility evidence, policy changes and rollback behavior. Opaque review references alone cannot close these gates.
4. Implement a separately reviewed bounded read-only transport with cancellation, redirect/address checks, hard budgets, Retry-After handling and explicit stop-on-challenge/denial behavior. Do not add background retries or evasion.
5. Gather real sanitized evidence before claiming any live capability. A preparation pilot additionally needs user-selected job bindings, profile/file consent, no-overwrite handling and stop controls. Navigation/submission require their own review and named target validation. Never submit synthetic applications to unrelated employers.

Existing manual/import workflows remain available. LinkedIn policy and all local-only agent URL checks are unchanged. No live assessment was performed by creating these files. The pilot remains on hold; this delivery is not completion of AG-10.
