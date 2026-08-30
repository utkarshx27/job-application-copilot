# Greenhouse and Lever pre-submit QA

This directory contains the instructions and input template for the Phase 3 public-form gate. Public capture is deliberately read-only: it uses a fresh browser context, never clicks or types, blocks every non-GET/HEAD request, and stores no cookies, local storage, session storage, text-field values, uploads, or raw page HTML.

## 1. Discover current public URLs

Generate a local 100+100 list from the official public Greenhouse and Lever postings APIs:

```bash
npm run ats:qa:discover
```

The defaults use the active Figma Greenhouse board and Palantir Lever site. Override them with `--greenhouse-board`, `--lever-site`, or `--per-adapter` when needed. Discovery performs GET requests only and writes `urls.local.json`, which remains gitignored.

To provide a hand-curated list instead, copy `urls.example.json` to `urls.local.json`. Add up to 250 HTTPS application URLs as strings or objects:

```json
[
  { "url": "https://boards.greenhouse.io/company/jobs/123", "adapter": "GREENHOUSE" },
  { "url": "https://jobs.lever.co/company/job-id", "adapter": "LEVER" }
]
```

The `adapter` is the ATS provider, not the employer name. Its only accepted values in Phase 3 are `GREENHOUSE` and `LEVER`; company names such as `ACCENTURE` are invalid. The adapter may be omitted for standard `greenhouse.io` and `lever.co` hosts. Set it explicitly only when a custom employer domain is genuinely backed by Greenhouse or Lever. Ashby and Workday URLs belong to later phases. Use distinct application pages and respect each site's terms and access policies.

## 2. Capture sanitized metadata

```bash
npm run ats:qa:capture -- --input qa/ats/urls.local.json
```

To retry or capture only one adapter, add `--adapter GREENHOUSE` or `--adapter LEVER`.

The default output is `.tmp/ats-qa/captures`, with a sanitized success/failure summary at `.tmp/ats-qa/capture-summary.json`. One inaccessible or malformed page is reported without discarding successful captures. A fixture contains field labels, accessible names, control kinds, required/disabled state, machine names/IDs, and select/radio option metadata. It does not contain entered text, selected state, cookies, browser storage, query strings, fragments, job titles, or raw HTML. Email addresses, phone-like strings, and URLs found in metadata are redacted.

## 3. Create review files and replay locally

```bash
npm run ats:qa:init-review
npm run ats:qa:replay
```

The replay uses the deterministic adapter and form engine with a synthetic candidate named `Priya Example`. It writes:

- `.tmp/ats-qa/reviews/*.review.json` — human ground-truth templates;
- `.tmp/ats-qa/report/report.md` — deduplicated manual review batches and gate summary;
- `.tmp/ats-qa/report/report.json` — machine-readable metrics, raw queue items, and batch membership.
- `.tmp/ats-qa/report/page-checklist.md` — each local public URL paired with its sanitized fixture and the four page-level checks.

Edit each review file, then rerun `npm run ats:qa:replay`. Generated predictions are never accepted as their own ground truth.

To import a reviewed batch report and page checklist, with exact ID/count validation:

```bash
npm run ats:qa:import-reviewed -- --report-reviewed path/to/report-reviewed.md --page-checklist-reviewed path/to/page-checklist-reviewed.md --reviewer reviewer-name
npm run ats:qa:replay
```

Use `npm run ats:qa:init-review -- --force` only before manual review when captures changed; it deliberately replaces existing review decisions.

## Exactly what is manual

For every URL, a person must verify four page-level facts:

1. The page really is the declared Greenhouse or Lever application.
2. Every visible application control is represented in the fixture, including custom widgets and controls inside iframes.
3. The fixture contains no personal or session data.
4. The capture did not click, type, upload, or submit anything.

For field review, the report groups controls only when the ATS, normalized label, control kind,
required state, prediction, confidence, tier, priority, and reasons match exactly. Review each
batch once and apply its answer to every occurrence only when the meaning really is identical.
If a batch is ambiguous, inspect its fixture IDs in `report.json` and review those controls
separately.

- **P0:** potentially severe. These are fields the extension could autofill, file/radio/checkbox controls, or required unmapped fields.
- **P1:** uncertain, blocked, or unmapped fields.
- **P2:** routine high-confidence mappings that still need human ground truth once so accuracy is not circular.

You do **not** manually enter synthetic data into 200 public forms. You do **not** upload a résumé or press Submit. Local replay measures whether the reviewed expected field would receive the correct synthetic operation. Any wrong non-null prediction on a field marked `SEVERE` is counted as a severe wrong-field incident.

Set a review to `REVIEWED` only after all field decisions are complete and all four page checks are `PASS`. The release gate requires 100 distinct Greenhouse fixtures, 100 distinct Lever fixtures, all reviews complete, at least 98% supported-field fill success, and zero severe wrong-field incidents.

After a person has completed all four checks for every captured page, record that explicit signoff with:

```bash
npm run ats:qa:signoff-pages -- --confirm-all --reviewer reviewer-name
npm run ats:qa:replay -- --enforce
```

The signoff command refuses to run without the explicit flag, a reviewer name, one review per fixture, and complete field decisions. It records the timestamp and evidence summary in `.tmp/ats-qa/report/page-signoff-summary.json`. Do not run it as a substitute for the manual checks.

For CI or a final release audit, enforce the gate with:

```bash
npm run ats:qa:replay -- --captures path/to/captures --reviews path/to/reviews --report path/to/report --enforce
```

The command exits nonzero when the gate is not satisfied.

## Phase 3 completion record

The final 2026-08-30 release run covered 100 Greenhouse and 100 Lever forms. A person confirmed all four page checks for every fixture, and enforced replay passed with 200/200 fully reviewed forms, 8,079/8,079 correct reviewed mappings, 1,766/1,766 successful eligible autofills, and zero severe wrong-field incidents.

## Controlled dry run

To exercise the workflow without contacting public sites:

```bash
npm run ats:qa:seed-controlled
npm run ats:qa:init-review -- --captures .tmp/ats-qa-controlled/captures --reviews .tmp/ats-qa-controlled/reviews
npm run ats:qa:replay -- --captures .tmp/ats-qa-controlled/captures --reviews .tmp/ats-qa-controlled/reviews --report .tmp/ats-qa-controlled/report
```
