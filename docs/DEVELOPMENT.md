# Living development backlog

The MVP milestone plan is complete. This document stays open for maintainers and contributors to record ongoing improvements without creating another numbered implementation sequence.

GitHub issues and pull requests are the source of truth for assigned work. Before starting a large change, open an issue and link it from the relevant section below.

## Experimental application agent

The [application-agent plan](./agent/README.md) defines the successor experience, with [implementation work packages](./agent/IMPLEMENTATION.md), browser architecture, source integration, model research, and correction-learning evaluations. AG-01's durable foundation, AG-02's compact onboarding, and AG-03's local portal harness are implemented. Read [setup/migration and portal development](./agent/SETUP_AND_PORTALS.md); continue with AG-04 model routing and AG-05 execution. AG-04–AG-13 remain planned.

## Current priorities

### ATS compatibility

- Add sanitized regression fixtures for real layout changes.
- Improve adapter-owned handling for custom comboboxes and multi-part controls.
- Expand same-origin embedded-form coverage while keeping cross-origin boundaries explicit.
- Add a new ATS only with deterministic detection, sanitized fixtures, safe failure behavior, and browser tests.
- Maintain the Greenhouse/Lever read-only regression set and complete broader Workday pre-submit validation.

### Profile and matching

- Add conservatively modelled profile fields only with schema migrations and backup compatibility.
- Improve address, international phone, multilingual, and accessibility support.
- Calibrate mappings against human-reviewed fixtures and preserve the zero severe wrong-field goal.
- Keep unknown, ambiguous, and sensitive facts manual.

### User experience

- Improve explanations for unsupported controls and missing profile values.
- Add clearer onboarding and extension update guidance.
- Improve keyboard navigation, screen-reader output, narrow side-panel layouts, and localization.
- Make tracker filtering and import errors easier to understand.

### Security and privacy

- Minimize extension permissions and document every permission change.
- Add regression tests for origin validation, command parsing, prompt injection, and data leakage.
- Harden the optional sync service before any public deployment.
- Keep all real-site navigation and submission manual unless a separate security and release review explicitly changes that boundary.

### Developer experience

- Keep `npm run verify` reliable on Windows, macOS, Linux, and CI.
- Reduce fixture maintenance work without accepting generated predictions as ground truth.
- Improve architecture indexes, contributor examples, and issue templates.
- Publish reproducible release artifacts and checksums when versioned releases begin.

## Proposing work

An issue for a meaningful change should include:

- the user problem;
- the proposed scope and explicit non-goals;
- privacy, permission, and automation risks;
- synthetic or sanitized evidence;
- expected tests and manual verification;
- migration or compatibility impact.

Small documentation fixes, test additions, and isolated bug fixes can go directly to a focused pull request.

## Definition of done

A change is complete when:

- behavior and safety boundaries are explicit;
- runtime inputs remain schema validated;
- tests cover success and safe failure paths;
- fixtures contain no personal, session, or employer-confidential data;
- user-facing and contributor documentation is updated;
- `npm run verify` passes;
- the pull request explains manual checks that automated tests cannot prove.

## Never add

- CAPTCHA, bot-detection, rate-limit, or access-control bypasses;
- automated LinkedIn activity;
- arbitrary browser commands controlled by page text or model output;
- password, government-ID, banking, or payment autofill;
- unattended real-world application submission;
- inference or silent reuse of work authorization, legal, EEO, or similarly sensitive answers.

See [CONTRIBUTING.md](../CONTRIBUTING.md), [SECURITY.md](../SECURITY.md), and the [architecture record index](./architecture/README.md) before changing security-sensitive behavior.
