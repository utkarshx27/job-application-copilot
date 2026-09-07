# Job Application Copilot

[![CI](https://github.com/utkarshx27/job-application-copilot/actions/workflows/ci.yml/badge.svg)](https://github.com/utkarshx27/job-application-copilot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A local-first, user-controlled Chrome extension that helps complete job application forms from a verified candidate profile. It scans the visible form, explains deterministic matches, and fills only fields the user selects.

> [!IMPORTANT]
> The MVP is implemented and open for continued community development. On real application sites, the extension never clicks Next or Submit. Always review the completed form and submit it yourself.

## What it can do

### Profile and résumé

- Store a versioned candidate profile locally in `chrome.storage.local`.
- Import PDF and DOCX résumés locally without uploading the raw file to a server.
- Review document-derived facts, resolve conflicts, and explicitly verify them.
- Export and restore schema-validated JSON profile backups.
- Preserve user edits and refuse to overwrite existing or résumé-parsed page values.

### Form assistance

- Detect visible native controls, same-origin embedded forms, and open web-component roots.
- Exclude password, hidden, disabled, and unsupported sensitive controls.
- Map common identity, contact, address, links, work, education, and authorization fields.
- Show the mapping, confidence, reason, and fillability for every detected control.
- Highlight selected fields before filling them.
- Fill reviewed text, textarea, select, radio, and checkbox controls with framework-safe events.
- Rescan dynamic forms and preserve manual changes.
- Keep unfamiliar custom widgets and ambiguous fields manual.

### Answers and optional AI drafting

- Review unmatched questions and enter an answer without saving it.
- Optionally save reusable answers with application, company, country, role, or global scope.
- Expire saved answers according to the question’s risk policy.
- Keep work authorization, legal, consent, and voluntary-disclosure questions under stricter review.
- Optionally create grounded drafts for supported narrative questions using the OpenAI Responses API.
- Keep the API key in Chrome session storage only.
- Require separate **Use this draft** and **Fill reviewed custom answers** actions; AI text never fills automatically.

### Applications and sync

- Track applications locally with editable statuses, board/table views, and summary counts.
- Detect likely duplicates from requisition identity, normalized URLs, and job details.
- Import and export tracker CSV safely.
- Optionally synchronize the encrypted profile and tracker through the included self-hostable sync service.
- Support encrypted backups, session locking, device listing/revocation, and cloud-account deletion.

## Supported application systems

| Application system   | Detection and safe native-field fill | Résumé upload               | Notes                                                      |
| -------------------- | ------------------------------------ | --------------------------- | ---------------------------------------------------------- |
| Greenhouse           | Yes                                  | Reviewed upload             | Public read-only QA set available                          |
| Lever                | Yes                                  | Reviewed upload             | Public read-only QA set available                          |
| Ashby                | Yes                                  | Reviewed upload             | Custom widgets remain manual                               |
| SmartRecruiters      | Yes                                  | Reviewed when identifiable  | Supports same-origin embedded forms                        |
| Workday              | Yes                                  | Reviewed upload             | Multi-step state is observed; real navigation stays manual |
| iCIMS                | Yes                                  | Reviewed upload             | Unknown widgets remain manual                              |
| Oracle Taleo         | Yes                                  | Reviewed upload             | Unknown widgets remain manual                              |
| Workable             | Yes                                  | Reviewed upload             | Unknown widgets remain manual                              |
| BambooHR             | Yes                                  | Reviewed upload             | Unknown widgets remain manual                              |
| Jobvite              | Yes                                  | Reviewed upload             | Unknown widgets remain manual                              |
| Comeet               | Yes                                  | Reviewed upload             | Unknown widgets remain manual                              |
| Other employer forms | Generic deterministic matching       | Only when safely identified | Site-specific controls may require manual completion       |

LinkedIn and other job boards can be used to discover a role, but the extension does not automate activity on those websites. Open the employer or ATS application page before scanning.

## Install from source

### Requirements

- Node.js 22 or newer
- npm 11 or newer
- Chrome or another Chromium browser

Clone, install, verify, and build:

```bash
git clone https://github.com/utkarshx27/job-application-copilot.git
cd job-application-copilot
npm install
npx playwright install chromium
npm run verify
npm run build
```

Load the extension:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Select `apps/extension/dist`.
5. Pin **Job Application Copilot** if desired.

After pulling new code, run `npm run build`, reload the extension on `chrome://extensions`, and refresh any open application page.

## How to use it

### 1. Create and verify your profile

1. Open the extension side panel and select **Profile**.
2. Import a PDF/DOCX résumé or enter your details manually.
3. Review every imported fact and resolve any conflicts.
4. Select **Save and verify profile**.
5. Export a JSON backup if desired and store it securely; profile exports contain personal data and are not encrypted.

### 2. Scan an application

1. Open the employer or ATS application form in the active browser tab.
2. Open the extension side panel and select **Observe**.
3. Select **Scan and match visible form**.
4. On the first scan for a website, approve Chrome’s site-scoped permission request.
5. Review the detected ATS, job metadata, field mappings, confidence, and blocking reasons.

The extension requests access only for the active website. It does not request permanent content access to every site at once.

### 3. Review and fill

1. Leave selected only the fields you want the extension to fill.
2. Optionally select **Highlight selected** and inspect the highlighted controls on the page.
3. Select **Fill selected fields**.
4. Complete manual custom widgets, ambiguous uploads, sensitive questions, and unsupported fields yourself.
5. Rescan after revealing a new section or moving to another step.
6. Review the entire application and submit it manually.

The extension will not overwrite fields that already contain user-entered, account-imported, or résumé-parsed values.

### 4. Review custom questions

For an unmatched text question, enter a reviewed answer in the side panel. Saving is off by default. If you choose to save it, select the narrowest appropriate scope and review the suggestion again on future applications.

Role-based comboboxes, listboxes, and other custom ATS controls are shown for awareness but remain manual because safely operating arbitrary widgets requires adapter-specific behavior.

### 5. Upload a résumé

When an upload field is identified as a résumé control:

1. Select the exact PDF or DOCX file in the side panel.
2. Review its name and approval details.
3. Use the dedicated upload action.
4. Confirm on the application page that the ATS retained the correct file.

Ambiguous controls labelled only “Choose a file” are intentionally not guessed.

### 6. Use optional grounded AI drafts

1. In **Observe**, enter an OpenAI model available to your account and a valid API key.
2. Select **Enable for this session** and approve access to `api.openai.com`.
3. For an eligible narrative field, select **Draft with grounded AI**.
4. Inspect the draft and its evidence.
5. Select **Use this draft in review**, edit it if needed, and then select **Fill reviewed custom answers**.

Never commit or share an API key. The extension keeps it in `chrome.storage.session`, excludes it from profile backups and audit records, and clears it with the browser session.

### 7. Track applications

Open **Applications** to view the local board or table, update statuses, inspect duplicate warnings, and import/export CSV. Tracker exports contain application history and should be stored securely.

### 8. Use optional encrypted sync

Start the included local sync service in a separate terminal:

```bash
npm run dev --workspace @copilot/sync-server
```

Open **Sync**, use `http://127.0.0.1:8787`, create or sign into an account, and unlock the session. Local-only mode remains the default. The bundled JSON-backed service is intended for controlled/self-hosted development; complete the production-hardening requirements in the [sync architecture record](./docs/architecture/phase-10-optional-cloud-sync.md) before exposing it publicly.

## Troubleshooting

- **No inspectable active tab:** make the application page the active tab, close/reopen the side panel, and scan again.
- **Chrome denied page access:** reload the current extension build, refresh the application page, scan again, and approve access for that hostname.
- **Zero fields:** wait for the form to finish rendering and rescan. Cross-origin frames, closed component roots, and unsupported custom widgets may remain manual.
- **A mapped field is not fillable:** add and verify the corresponding profile value, or complete the control manually if it is a custom widget.
- **An existing field was skipped:** the copilot protects values already entered by you or populated by the ATS.
- **Changes are not visible:** run `npm run build`, reload the unpacked extension, refresh the application tab, and reopen the side panel.

## Development

Start an automatic extension rebuild:

```bash
npm run dev --workspace @copilot/extension
```

Run the controlled Test ATS in another terminal:

```bash
npm run serve --workspace @copilot/test-ats
```

The Test ATS includes controlled Greenhouse, Lever, Ashby, SmartRecruiters, Workday, iCIMS, Taleo, Workable, BambooHR, Jobvite, and Comeet fixtures. One-shot navigation and submission experiments are restricted to the exact local Workday fixture and are never enabled on real ATS pages.

### Verification

```bash
npm run format:check  # Formatting
npm run lint          # Static analysis
npm run typecheck     # TypeScript project references
npm test              # Unit and schema tests
npm run test:e2e      # Unpacked-extension Chromium tests
npm run build         # Production builds
npm run verify        # Complete contributor and CI gate
```

The browser-test build receives access only to `http://127.0.0.1/*`. That permission is generated in `apps/extension/dist-e2e` and is not included as a required production host permission.

Public ATS checks must remain read-only and stop before submission. See the [Greenhouse/Lever QA workflow](./qa/ats/README.md) and [Workday QA workflow](./qa/workday/README.md).

## Repository structure

```text
apps/
  extension/                 Chrome extension and side panel
  sync-server/               Optional encrypted sync service
  test-ats/                  Controlled synthetic application site
packages/
  candidate-schema/          Candidate truth model
  profile-core/              Local versioned profile vault
  form-schema/               Form snapshot and fill contracts
  form-engine/               Deterministic matching and fill planning
  question-ontology/         Canonical questions and risk policies
  saved-response-engine/     Scoped reusable answers
  ai-gateway/                Provider-neutral structured AI tasks
  grounded-generation/       Evidence selection and draft validation
  ats-*/                     ATS adapters and shared parsing
  application-state/         Tracker and duplicate handling
  sync-core/                 Client-side encryption and sync protocol
  navigation-core/           Controlled Test ATS navigation state
  submission-core/           Controlled Test ATS submission state
fixtures/                    Synthetic and sanitized fixtures
evals/end-to-end/            Chromium extension tests
qa/                          Read-only public validation workflows
docs/architecture/           Historical design and implementation records
```

The original implementation blueprint is retained as a technical reference. The MVP milestone list is complete; ongoing work is tracked through the [living development backlog](./docs/DEVELOPMENT.md), issues, and pull requests.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md), follow the [Code of Conduct](./CODE_OF_CONDUCT.md), and run `npm run verify` before opening a pull request.

The [application-agent implementation plan](./docs/agent/README.md) describes the next product direction: simpler onboarding, job discovery, company evidence, assisted multi-step applications, and learning from corrections. Its first implementation is a separate [read-only local agent lab](./docs/agent/AGENT_LAB.md) with durable run state, pause/resume, recovery, and duplicate-command protection. The broader agent capabilities remain planned, not part of the current release. Contributor work packages and acceptance criteria stay open in the plan.

Useful contribution areas include:

- Maintaining and expanding ATS adapters with sanitized fixtures.
- Improving accessibility and internationalization.
- Adding conservative profile fields and schema migrations.
- Improving custom-widget support without arbitrary page automation.
- Extending privacy, prompt-injection, and wrong-field regression tests.
- Hardening the optional sync deployment.
- Improving documentation and developer experience.

Do not commit real résumés, candidate data, authentication/session material, API keys, or unsanitized employer pages.

## Safety and privacy

- Real application navigation and submission are always manual.
- No CAPTCHA, bot-detection, rate-limit, or access-control bypass is implemented.
- Passwords, government IDs, banking data, and payment fields are outside the fill protocol.
- Résumés are parsed locally, limited to 5 MB, and not retained as raw files.
- Public QA capture never types, clicks, uploads, submits, or retains browser sessions.
- Question classification receives no candidate profile.
- AI output cannot issue browser commands and never fills automatically.
- Cloud sync is optional and client-side encrypted; readable profile/tracker records and the passphrase are not sent to the server.

See [SECURITY.md](./SECURITY.md) for private vulnerability reporting and security-sensitive areas.

## Disclaimer

This project is not affiliated with Greenhouse, Lever, Ashby, SmartRecruiters, Workday, iCIMS, Oracle Taleo, Workable, BambooHR, Jobvite, Comeet, LinkedIn, OpenAI, or any other ATS, job platform, or AI provider. Users and contributors are responsible for complying with applicable site terms, laws, employer policies, and API terms.

## License

Licensed under the [MIT License](./LICENSE).
