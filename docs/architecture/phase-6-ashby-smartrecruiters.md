# Phase 6 — Ashby and SmartRecruiters adapters

Phase 6 adds first-class Ashby and SmartRecruiters application support through the same bounded adapter contract used by Greenhouse and Lever. The adapters inspect visible pages, normalize job metadata, classify stable system fields, identify confirmation pages, and leave all navigation and submission to the user.

## Verified platform conventions

Ashby's official public posting API documents hosted `jobs.ashbyhq.com` job and apply URLs. Its custom-careers documentation defines stable application paths such as `_systemfield_name`, `_systemfield_email`, and `_systemfield_resume`, plus typed custom fields including strings, long text, booleans, dates, selects, and social links:

- [Ashby public job posting API](https://developers.ashbyhq.com/docs/public-job-posting-api)
- [Ashby custom careers and application forms](https://developers.ashbyhq.com/docs/creating-a-custom-careers-page)

SmartRecruiters documents public posting IDs and job configuration through its Posting and Application APIs. Current hosted applications use `jobs.smartrecruiters.com`, including the `oneclick-ui/company/{company}/job/{postingId}` route:

- [SmartRecruiters Posting API](https://developers.smartrecruiters.com/docs/posting-api)
- [SmartRecruiters Application API](https://developers.smartrecruiters.com/docs/application-api)

These external pages remain untrusted. The extension does not call either platform's submission API.

## Package and runtime boundaries

- `ats-ashby` owns Ashby host/DOM detection, JSON-LD-first extraction, stable system-path rules, and confirmation evidence.
- `ats-smartrecruiters` owns SmartRecruiters host/DOM detection, route/requisition identity, JSON-LD-first extraction, stable machine-field rules, and confirmation evidence.
- `ats-core` exposes the shared four-adapter interface and selects only detections above the existing confidence threshold.
- `job-schema` allowlists `ASHBY` and `SMARTRECRUITERS` as runtime ATS identifiers.
- The extension router registers both adapters; the background worker still recomputes all mappings and reviewed plans from a fresh scan.

Job extraction prefers schema.org `JobPosting` JSON-LD and falls back to bounded ATS-specific selectors and metadata. A job snapshot contains title, company, description, location, employment type when available, stable external identity, source URL, application URL, and capture time.

## Field policy

Adapter-specific R0 rules are limited to stable machine identifiers:

- Ashby `_systemfield_*` identity, contact, résumé, links, current employment, and education paths.
- SmartRecruiters identity, contact, résumé, links, current employment, and education machine names.

All other controls fall through to the generic deterministic classifier. Ambiguous screening, consent, location-preference, and narrative questions remain in explicit review. Work-authorization timing and sensitive-question policies are unchanged.

## Rich custom controls

The scanner now discovers visible ARIA `combobox`, `listbox`, `checkbox`, and `radio` widgets in addition to native form controls. It captures accessible names, required/disabled state, checked state, and visible role options. An input carrying `role="combobox"` is classified as `other`, even though it is technically an HTML input.

Every role-based widget is manual-only. It appears in the review queue with an explanation, receives no fill operation, and is rejected again by the content-script driver if a forged plan attempts to target it. This avoids unsafe synthetic clicks and framework-state corruption.

## Dynamic forms

The controlled Ashby fixture reveals a narrative question after a workplace selection. The SmartRecruiters fixture reveals an experience question after a screening answer. In both cases the user changes the controlling page field, chooses **Scan and match visible form** again, and receives a new analysis containing the newly visible question. Existing analysis IDs become stale and cannot be reused.

## Confirmation and tracking

Each adapter requires a platform-specific confirmation container plus clear received/submitted wording. Optional reference IDs are captured only from the confirmation page. A verified confirmation moves the matching local application record from `APPLYING` to `APPLIED`; absence or ambiguity returns `confirmed: false`.

## Controlled canary gate

The committed sanitized canaries contain no applicant values or session data. Together they cover 8 expected mapping decisions across the two platforms with 100% correct-or-unmapped behavior. Chromium coverage proves:

- both ATS detections and normalized job snapshots;
- safe standard-field fills;
- role-based widgets remain untouched and manual;
- dynamic fields appear only after user interaction and rescan;
- explicit PDF/DOCX résumé approval targets only the detected upload control;
- confirmation evidence updates the local tracker;
- no Next or Submit action is available.

This controlled gate is a regression baseline, not permission to submit real applications. Public-page maintenance checks must remain read-only and pre-submit.

Run the Phase 6 release gate and the existing 200-form Greenhouse/Lever regression:

```bash
npm run check:phase6
npm run ats:qa:replay -- --enforce
```
