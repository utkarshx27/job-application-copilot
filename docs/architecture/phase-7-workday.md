# Phase 7 — Workday controlled implementation

Phase 7 adds Workday as a first-class ATS while keeping its multi-page application wizard under direct user control. The extension observes the current page, offers reviewed fills for safe native controls, persists non-sensitive progress locally, and explains authentication, validation, and recovery states. It never clicks Back, Next, Sign In, or Submit.

## Verified product model

Workday's official recruiting documentation describes an application wizard that can include contact information, experience, application questions, voluntary disclosures, terms and conditions, and final review. It also documents optional or required Candidate Home accounts, résumé parsing into contact/work/education/language data, suggested skills, and tenant-configurable application sections:

- [Workday Career Sites and application form](https://doc.workday.com/workday-education/en-us/course-manuals/recruiting-for-administrators/career-sites.html)
- [Workday external applications and Candidate Home](https://doc.workday.com/workday-education/en-us/course-manuals/recruiting-for-administrators/prospects-and-candidates.html)
- [Workday job application templates](https://doc.workday.com/admin-guide/en-us/human-capital-management/recruiting/job-applications/ijz1499291475964.html)

The adapter recognizes the common hosted `myworkdayjobs.com` and `myworkdaysite.com` domains plus bounded Workday DOM signatures. All page content remains untrusted.

## Runtime boundaries

- `ats-workday` owns tenant/site detection, JSON-LD-first job extraction, machine-field rules, confirmation evidence, and the current workflow-page snapshot.
- `job-schema` allowlists `WORKDAY` and validates page type, auth boundary, visible sections, step index/count, navigation visibility, error state, and persisted progress.
- `application-state` stores only the recovery key, page keys, page type, step position, scan count, a DOM-structure fingerprint, and timestamps. It stores no field values, passwords, cookies, tokens, or raw HTML.
- The background worker re-inspects the live page and recomputes mappings for every scan. A previous analysis cannot be reused after an SPA step change.
- The Phase 7 browser command schema had no Next or Submit command. Phase 11 later added a fixed-token Next plan and Phase 12 added a separate fixed-token Submit plan for the exact local Test ATS fixture; real Workday navigation and Submit remain unavailable.

## Workday page model

The adapter reports `JOB`, `AUTH`, `INTRO`, `MY_INFORMATION`, `MY_EXPERIENCE`, `APPLICATION_QUESTIONS`, `VOLUNTARY_DISCLOSURES`, `TERMS`, `REVIEW`, `CONFIRMATION`, or `UNKNOWN`.

For each scan it records:

- tenant and external career site;
- a stable page key and structure-only fingerprint;
- visible progress label and step count when exposed;
- visible section headings;
- authentication boundary;
- count of populated native controls, never their contents;
- observed Back/Next/Submit availability;
- bounded validation or expired-session error text.

Progress is recovered from `chrome.storage.local` after a refresh or service-worker restart. Returning to an earlier observed page produces a warning, not an automatic corrective action. Repeated scans do not create navigation events, so infinite click loops and repeated Next actions are impossible in this implementation.

## Résumé reconciliation and fields

The scanner now classifies each visible control as empty, prefilled, previously copilot-filled, or user-edited. It never captures the value itself. Both the analysis engine and content driver reject attempts to overwrite a prefilled control. This handles Workday résumé/account parsing without treating parsed values as verified candidate truth.

Workday R0 rules are limited to stable machine identifiers for:

- first/last name, email, phone, country, and résumé;
- the first work-history record's employer, title, location, dates, current state, and description;
- the first education record's institution, degree, field of study, and dates;
- skills.

Only index 0/1 first-record identifiers are mapped. Additional repeated records remain manual rather than being incorrectly filled from the first profile record. Native controls can receive reviewed operations. Workday prompt/combobox/listbox skill components remain visible but manual-only.

Questionnaires use the existing explicit custom-answer review. When a user selection reveals a follow-up question, the user rescans and receives a fresh analysis. Sensitive, ambiguous, voluntary-disclosure, consent, and authentication controls remain manual.

## Controlled gate and remaining public validation

The sanitized fixture and Chromium flow cover:

- tenant/site and requisition detection;
- contact fields and approved résumé upload;
- parsed email/employer protection;
- work history, education, and skills semantics;
- dynamic application questions;
- manual-only custom widgets and navigation;
- SPA step changes, refresh recovery, revisited-page warnings, auth boundaries, and confirmation tracking;
- explained expired-session and validation states.

Run the controlled release gate and the unchanged Greenhouse/Lever regression:

```bash
npm run check:phase7
npm run ats:qa:replay -- --enforce
```

This does not claim the roadmap's 250-form production gate. That gate requires pre-submit review across multiple Workday tenants and regions using the privacy rules in [`qa/workday/README.md`](../../qa/workday/README.md). Until it is complete, Phase 7 is a controlled implementation rather than a production-validated Workday release.
