# Phase 3 — Greenhouse and Lever

Phase 3 adds adapter-specific Greenhouse and Lever behavior on top of the Phase 2 reviewed-fill engine. The controlled implementation and live 100+100 capture, mapping review, and page-level signoff are complete as of 2026-08-30.

## Adapter boundary

The implementation is split into typed packages:

- `job-schema` owns normalized jobs, ATS reports, custom-question review, upload approvals, confirmation evidence, and tracker records.
- `ats-core` owns adapter interfaces, bounded JSON-LD parsing, stable job identity, and generic degradation.
- `ats-greenhouse` and `ats-lever` own host/DOM detection, job extraction, ATS field rules, and confirmation signatures.
- `application-state` owns local tracker transitions.

Selectors and page evidence remain untrusted data. The adapters can classify and extract, but cannot submit forms or access arbitrary files.

## User flow

```text
Open Greenhouse/Lever application
  → detect ATS and extract a normalized job snapshot
  → create/update local APPLYING tracker record
  → map verified profile facts
  → review and fill safe fields
  → answer unmatched custom questions explicitly
  → select and approve one résumé file
  → hash-verified, short-lived upload authorization
  → user submits manually
  → scan confirmation page
  → update matching tracker record to APPLIED
```

## Résumé upload safety

The extension does not retain raw résumé files. The user selects the exact PDF or DOCX for the current application and then presses a separate approval button. The service worker verifies that the cached analysis contains a résumé file control and issues a two-minute, field-specific plan. The content script verifies the SHA-256 digest before assigning the file and dispatching input/change events.

The approved payload is limited to PDF/DOCX and 5 MB at the UI boundary. No arbitrary filesystem command or page-selected path exists in the browser protocol.

## Custom questions

Unmatched visible controls are placed in a review queue. Text and native select answers can be entered explicitly in the side panel and filled through a typed plan. Radio, checkbox, and unsupported custom components remain manual. Saved-response matching and AI drafting belong to Phases 4 and 5.

## Confirmation and tracker

Scanning a detected ATS job stores a local immutable job snapshot inside an `APPLYING` record. A matching confirmation page must expose both an adapter signature and explicit confirmation language. Only then does the state transition to `APPLIED`; the extension never presses final Submit.

## Controlled verification

The committed Test ATS includes:

- Greenhouse- and Lever-like application pages;
- normalized job metadata and requisition IDs;
- standard profile fields and unmatched custom questions;
- PDF/DOCX file controls;
- fake confirmation pages;
- sanitized adapter fixtures;
- unit/schema tests and unpacked-extension Chromium flows.

Run:

```bash
npm run verify
```

## Completed release gate

The read-only run captured 100 distinct public Greenhouse forms and 100 Lever forms. Human ground truth covered all 201 unique mapping batches and all 8,079 field occurrences. On 2026-08-30, the user confirmed all four page-level checks for all 200 fixtures: correct ATS, complete visible-control capture, no personal/session data, and no form interaction. After Phase 4 separated current from future sponsorship, 198 combined-timing controls across 99 fixtures were corrected from current sponsorship to manual review. The adjusted enforced replay passes with 200/200 fully reviewed forms, 100% mapping accuracy, 100% supported-field fill success (1,667/1,667 eligible fields), and zero severe wrong-field incidents. Never submit applications during live QA.

The repository now includes a read-only capture and local replay pipeline for this gate. It accepts a local list of public HTTPS URLs, runs each in a fresh non-persistent Chromium context, blocks non-GET/HEAD requests, and extracts only bounded field metadata. Sanitization removes query strings, fragments, page titles, selected state, user-edited state, email addresses, phone-like strings, and URLs embedded in metadata. Cookies, storage, raw HTML, text-field values, files, and screenshots are never read into fixtures.

Predictions and human truth are kept in separate files. Replay uses a comprehensive synthetic candidate profile, reports mapping accuracy and supported-field fill success, counts severe wrong-field incidents, and refuses to pass the gate until every page and field review is complete. The detailed workflow and exact human checks are in [`qa/ats/README.md`](../../qa/ats/README.md).
