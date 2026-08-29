# Phase 3 — Greenhouse and Lever

Phase 3 adds adapter-specific Greenhouse and Lever behavior on top of the Phase 2 reviewed-fill engine. The controlled implementation is complete; the blueprint's live pre-submit sampling gate remains pending.

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
npm run check:phase3
```

## Remaining release gate

The controlled implementation does not satisfy the blueprint's real-world gate by itself. Before marking Phase 3 fully complete, record at least 100 distinct public Greenhouse forms and 100 Lever forms in pre-submit-only QA, demonstrate at least 98% supported-field fill success, and record zero severe wrong-field incidents. Never submit applications during live QA.
