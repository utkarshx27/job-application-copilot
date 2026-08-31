# Phase 8 — Tracker and duplicate engine

Phase 8 turns the local application history into a usable tracker. It adds versioned canonical job identities, immutable job snapshots, evidence-backed duplicate warnings, validated CSV transfer, editable statuses, and accessible board/table views. It does not add cloud sync, navigation, or submission.

## Local data model

Tracker schema version 2 keeps every existing application record and adds:

- a canonical identity with a version, stable key, normalization evidence, ATS, requisition ID, and canonical application URL;
- an append-only sequence of job snapshots with fingerprints and changed-field names;
- the latest normalized job on the application record for fast display and filtering.

Stored version 1 trackers migrate locally on first read. Migration retains IDs, timestamps, status, résumé metadata, confirmation evidence, and Workday recovery state, then derives the new identity and initial snapshot. Invalid unknown data falls back to an empty tracker rather than being partially trusted.

Repeated scans with an unchanged job fingerprint do not create redundant snapshots. A changed job creates a new snapshot while preserving prior job content. Each application retains at most 50 snapshots and the tracker retains at most 5,000 applications.

## Duplicate decisions

The engine evaluates deterministic signals in descending confidence:

1. the same application record — 100%;
2. the same normalized requisition ID within the same ATS — 100%;
3. the same application URL after removing query strings, fragments, and trailing slashes — 99%;
4. the same normalized company, title, and location — 92%.

Every result names the existing application and includes bounded human-readable evidence. Phase 8 warnings never auto-merge, block a fill, navigate, or submit. Distinct title, company, or location combinations remain separate records. Description similarity, repost classification, and cross-location heuristics are intentionally deferred until they have a calibrated evaluation set.

The controlled precision matrix covers same-record, URL variants, matching job details, different titles, and different companies. It requires 100% precision and correct classification for every controlled case.

## Tracker experience

The Applications tab provides:

- total, applied, interview, and possible-duplicate counts;
- local status editing across the allowlisted application lifecycle;
- search plus ATS and status filters;
- a horizontally scrollable pipeline board and a compact table;
- duplicate badges, snapshot counts, last-updated dates, and application links;
- CSV export and validated CSV import.

CSV uses a fixed version 1 column contract. Every imported row is independently schema-validated; invalid rows are skipped and reported without replacing valid local records. Export quotes every value and prefixes spreadsheet-formula-leading cells to reduce formula-injection risk. CSV files can contain application history, so users should store them securely.

## Verification

Run the complete Phase 8 gate:

```bash
npm run check:phase8
```

The gate includes formatting, lint, type checking, unit/schema tests, production builds, and unpacked-extension Chromium tests. Chromium coverage scans a controlled Greenhouse page twice, verifies the duplicate warning, edits tracker status, switches to the table, downloads CSV, imports a validated row, and captures the tracker UI.
