# Phase 9 — Additional ATS adapters

Phase 9 adds deterministic support for iCIMS, Oracle Taleo, Workable, BambooHR, Jobvite, and Comeet. Each adapter uses the same bounded contract as Greenhouse, Lever, Ashby, and SmartRecruiters: detect the ATS, extract a normalized job, classify stable machine fields, detect confirmation evidence, and expose custom controls for manual review. No adapter can navigate or submit.

## Verified platform conventions

The implementations are grounded in current first-party platform material:

- Oracle documents Taleo career-section job detail and application URLs under `*.taleo.net/careersection/...` with the requisition in the `job` query parameter: [Taleo Career Section URLs](https://docs.oracle.com/en/cloud/saas/taleo-enterprise/otcug/c-careersectionurl.html).
- Workable documents hosted career pages under `apply.workable.com/<subdomain>` and supports custom career sites: [Workable careers page](https://help.workable.com/hc/en-us/articles/360052322194-Managing-the-Careers-page-site-builder).
- BambooHR documents the standard candidate fields used by its applicant tracking API, including first/last name, email, phone, job ID, résumé, cover letter, LinkedIn, website, salary, education, and references: [BambooHR candidate application](https://documentation.bamboohr.com/reference/create-candidate).
- Comeet documents hosted position URLs, position UIDs, workplace type, location, employment type, and company name: [Comeet position model](https://developers.comeet.com/reference/careers-position-model).
- Jobvite’s hosted career pages use `jobs.jobvite.com/<company>/job/<job-id>` and expose public job details: [Jobvite hosted job example](https://jobs.jobvite.com/highpoint-global/job/oJ8ebfw0).
- iCIMS provides hosted career portals and job routes under iCIMS career domains: [iCIMS careers](https://careers.icims.com/).

Because customers can brand, proxy, or embed ATS pages, a hostname alone is not required. Each adapter also accepts bounded platform DOM signatures or the controlled `copilot-ats` fixture marker. Generic pages without reliable evidence continue through the generic scanner.

## Shared adapter contract

`ats-core` now exposes a standard adapter factory for the common safe behavior:

- hostname, metadata, and DOM-signature detection;
- JSON-LD-first job extraction with bounded DOM fallbacks;
- canonical external requisition extraction from JSON-LD, metadata, platform routes, or `data-job-id`;
- normalized title, company, description, location, employment type, and remote policy;
- confirmation detection only inside explicit confirmation containers;
- R0 mapping only from allowlisted machine identifiers.

The six packages provide their platform ID, host patterns, stable DOM selectors, requisition route parser, and bounded content selectors. This keeps the behavior consistent while allowing each platform to evolve independently.

## Safe field scope

The shared Phase 9 rules recognize stable identifiers for:

- given, family, and full name;
- email and phone;
- LinkedIn and portfolio URL;
- résumé and cover letter;
- current employer and title;
- first education institution and degree.

Labels alone never trigger an adapter R0 rule. Unknown questions, salary expectations, references, consent, disclosures, and custom combobox/listbox controls remain unmapped or manual-only. The existing form engine still requires explicit selection before fill, a separate approval before résumé upload, and a fresh scan after dynamic changes.

## Controlled validation

Each adapter has a sanitized metadata fixture and unit tests covering detection, normalized extraction, requisition identity, field mapping, and confirmation evidence. The Test ATS renders a platform-specific controlled page for all six adapters. Chromium tests verify:

- correct adapter and job detection;
- reviewed fill of name, email, phone, and LinkedIn fields;
- custom comboboxes remain empty and manual-only;
- one explicitly approved résumé reaches only the detected file input;
- no navigation or submission occurs.

Run the complete Phase 9 gate:

```bash
npm run check:phase9
```

The gate does not claim broad public-site production validation. Branded/custom-domain pages and platform releases should be added as sanitized fixtures before widening selectors.
