# Career setup and portal harness (AG-02 / AG-03)

Implemented against baseline `2849535`. AG-02 supplies the default setup screen; AG-03 supplies a resettable local test environment and a browser test driver. The next runtime work packages are AG-04 model routing and AG-05 application execution.

## Use the simpler setup

Build and reload the extension with `npm run build`, then open **Profile**:

1. Import a PDF/DOCX résumé or enter your contact details. Optional background notes can include goals, history, and preferences.
2. Review the extracted details. **Edit full profile** contains the original detailed editor, conflict controls, and JSON backups. Return with **Back to simple setup**.
3. Add target roles, preferred locations, and work arrangements. Current location, experience in months, and notice in days are separate fields. Blank optional numbers mean unknown, while zero means zero.
4. Optionally add current/expected compensation and exclusions. Compensation is stored as amount + three-letter currency + hour/month/year period. No exchange-rate conversion or salary inference occurs.
5. Confirm the setup and select **Save my setup**. The readiness summary identifies remaining work and offers **Review an application form** when setup is ready.

Notes are stored as `CONTEXT_ONLY`. Only explicit `Name:`, `Email:`, `Phone:`, `LinkedIn:`, `GitHub:`, and `Portfolio:` lines can supply contact suggestions. Imported values retain a source reference and remain pending user review; conflicts use the existing vault workflow. “I want to work with Rust” never supplies a Rust skill or work-history record. Unstructured experience extraction is future model-router work.

Compact setup confirms only the displayed contact details and preferences. It does not verify unseen imported work history, skills, or authorization facts. Review imported records separately. Readiness describes profile setup, not eligibility for every job or an application-submission guarantee.

The side panel is split into `onboarding.tsx`, `profile-editor.tsx`, `observe-panel.tsx`, `applications-panel.tsx`, `sync-panel.tsx`, and shared messaging. Profile/sync panel requests are serialized; setup saves reject a stale profile revision.

## Migration, backups, and sync

- Existing version 1 profiles and backups remain readable. Merely opening a profile does not upgrade it.
- Saving career setup creates candidate schema 2, vault schema 2, and backup format 2. Importing narrative suggestions requires vault/backup 2 for the new source kind. Earlier snapshots and sources remain in history.
- Failed validation, unsupported versions, conflicts, and stale setup saves do not replace the stored vault. A format-1 wrapper containing format-2 data is rejected.
- The new build round-trips preferences and notes in JSON backups and encrypted sync. Raw notes are personal profile data and follow the same storage/export/sync rules as the rest of the vault.
- Update every device before syncing version 2. Old clients reject that vault instead of silently stripping its new fields. A new client also refuses to let a newer legacy snapshot overwrite career setup; review and save the version 2 profile before syncing again.
- For rollback to an older extension, export a version 1 backup **before** upgrading. Restore that backup in the older build. Keep your version 2 backup for a later upgrade; the old build cannot read it. There is no automatic lossy downgrade converter.
- Backup/export and detailed authorizations remain under **Edit full profile**. Unsaved setup edits are not a backup; save before closing or switching views.

## Run the portal gallery

From the repository root:

```powershell
npm run build --workspace @copilot/test-ats
npm run serve --workspace @copilot/test-ats
```

Open **http://127.0.0.1:4173/portal.html**. The gallery contains searchable synthetic jobs and company evidence plus 29 scenarios. Select a demo to try its form manually. Use synthetic details and documents. The existing research extension also has **Explore portal demos** in its lab.

The server uses ports 4173 (public demo) and 4174 (private test runner). Stop/restart it to reset manual demo state. Automated tests reset it through the private runner API with a seed. Fixtures support original synthetic content; they do not copy proprietary pages or submit to real employers.

## Coverage and fallback behavior

| Families / patterns     | Exercised behavior                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Greenhouse, Lever       | Native fields, staged application, retained document upload                                                                                                                                                  |
| Ashby, BambooHR         | Changed field names, accessible-label fallback, replacement controls                                                                                                                                         |
| SmartRecruiters, Comeet | Open shadow roots, delayed controls                                                                                                                                                                          |
| Workday, iCIMS          | Multi-step forms, same-origin frames and nested frames                                                                                                                                                       |
| Taleo, Workable         | Server validation, repeatable work-history rows and removal                                                                                                                                                  |
| Jobvite                 | Custom accessible comboboxes and value verification                                                                                                                                                          |
| LinkedIn, Indeed        | Modal application patterns; Indeed also uses custom choices                                                                                                                                                  |
| Naukri                  | Separate notice, experience, current pay, expected pay, currency, and period                                                                                                                                 |
| Wellfound               | Motivation and equity questions                                                                                                                                                                              |
| Glassdoor               | Synthetic company evidence, name collisions, missing/conflicting/stale/small-sample ratings                                                                                                                  |
| Generic                 | Delayed rendering, stale controls, login/access pauses, unknown answers, closed roots/tabs, blocked external handoff, expired session between steps, lost/mismatched/false confirmations, duplicate requests |

The **test driver** tries known native controls, accessible labels, open shadow roots, and permitted local frames. It handles custom comboboxes explicitly, verifies retained values, and re-observes after a bounded failure. Rendering waits and field retries have limits. Unanswerable questions, inaccessible controls, access screens, and validation errors produce pauses. They never trigger random clicks, invented answers, or repeated submissions.

These are tests of interaction patterns across 17 families, not proof of compatibility with every live portal. The extension's AG-01 controller still only reads its original Workday checkpoint. AG-05 must connect and independently verify the runtime executor. Vision/model fallback is planned with AG-04/AG-05; it is not silently substituted by this harness. Existing React/Vue and ATS regression fixtures continue to run alongside it.

## Independent outcomes and isolation

Public assets live in `apps/test-ats/dist`. The server and its synthetic answer key are built separately into `dist-server`, outside the static root. The public scenario projection omits private fault/outcome data and uses opaque IDs. The browser sees its application values and receipt identity; it cannot read the answer key or correctness labels.

The runner API is bound to loopback on a separate port, requires a random bearer token, rejects requests with an Origin header, and exposes no CORS access. Playwright generates the token in the Node process; it is never installed in the application page, browser headers, or driver. The runner supplies a synthetic candidate profile to the driver, while keeping expected outcomes separate. Do not add the runner origin/token to a browser or model tool.

The server validates required values, review state, consent, and retained upload ownership. Accepted applications are recorded once. Duplicate requests return 409. Confirmation-page text alone does not determine success: the runner compares the driver result with the server ledger to report correct/incorrect applications, false confirmation, identity mismatch, accepted-but-response-lost, blocked duplicate, or pause without submission. A counterfactual test swaps current and expected salary and checks that it is judged incorrect even though the page accepted it.

The lost-response fixture sends headers and only part of the body before disconnecting. This avoids treating Chrome's transparent retry after a pre-header socket close as an intentional agent retry. The ledger still protects against duplicate acceptance.

All fixture links resolve within the local demo. Application CSP restricts scripts, frames, connections, and form actions to the same origin. Static routes cannot serve server modules or runner files. Tests verify these boundaries. The ledger is held in memory and reset between scenarios; durable extension-worker recovery remains covered by the AG-01 tests.

## Verification and contributor workflow

Validated on 2026-09-07: `npm run verify` passed formatting, lint, type checking, 155 unit tests across 39 files, production builds, and all 60 browser tests. The browser suite includes 29 portal scenarios, two harness integrity/outcome checks, one compact-onboarding flow, and 28 existing regression tests. The research extension build also passed. These counts describe local regression coverage, not live portal success rates.

```powershell
npm run test:portals
npm run verify
```

`test:portals` runs the compact onboarding and portal scenarios. `verify` also runs formatting, lint, type checking, unit tests, builds, and the existing extension regression suite. Structured browser results are written to `test-results/e2e-results.json`; portal attachments include methods used, observed state, independently evaluated verdict, and ledger counts. These generated files are ignored by Git.

Add new synthetic scenarios in `apps/test-ats/server/portal-catalog.ts`, public rendering behavior in `apps/test-ats/src/portal.ts`, and independent expectations in `evals/end-to-end/portals.spec.ts`. The browser driver belongs in `portal-driver.ts`; outcome judgment belongs in `portal-outcome.ts`. Keep private oracle/fault data out of public imports. Add a realistic changed-control or interrupted-flow case when adding a new family, rather than only a renamed copy of a happy path.

This is a smoke suite for implementation, not the larger held-out benchmark or a live application success rate. Continue expanding coverage through the open work packages in [IMPLEMENTATION.md](./IMPLEMENTATION.md).
