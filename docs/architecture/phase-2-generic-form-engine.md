# Phase 2 — Generic Form Engine

Phase 2 turns Observe Mode into an explicit scan → review → highlight/fill workflow. It does not click Next, upload files, or submit applications.

## Semantic mapping

The generic engine classifies fields into canonical questions using deterministic evidence:

- **R0:** exact browser semantics such as `autocomplete`, stable machine names, and IDs.
- **R1:** normalized accessible labels, ARIA text, placeholders, and fieldset legends.
- **R2/Unmapped:** ambiguous or unmatched fields; these are never selected automatically.

Every mapping carries its canonical question, confidence, evidence tier, fillability, and any blocking reason. The controlled R0/R1 semantic matrix currently measures 17 correct predictions from 17 predictions: **100% precision**, above the original 99.5% exit threshold.

## Review and trust boundary

```text
Untrusted application page
  → accessible raw field snapshot
  → deterministic service-worker mapping
  → side-panel user selection
  → service-worker revalidation against cached analysis
  → typed content-script fill plan
```

The panel sends only an analysis ID and selected field IDs. It cannot provide fill values. The service worker reconstructs approved operations from the verified local profile and rejects stale or non-fillable selections.

## Control driver

The fill driver uses native prototype setters followed by bubbling, composed `input` and `change` events. This updates vanilla controls and controlled React/Vue state without arbitrary script execution.

Supported controls:

- text-like inputs, including email, telephone, URL, date, and number;
- textarea;
- single and multi-select values when an enabled option matches;
- radio and checkbox state.

File inputs, disabled/read-only fields, missing options, unsupported controls, and values without verified profile evidence are skipped.

## User-edit protection

The content script tracks input/change events separately from its own guarded events. Once the user changes a field, it is marked as user-edited, excluded from the next default selection, and protected from a stale fill plan. A fresh scan exposes the protection reason in the side panel.

## Dynamic and framework behavior

- Filling the sponsorship radio in the vanilla Test ATS triggers its change handler and reveals the conditional visa field.
- A rescan discovers the newly visible field.
- Real React controlled inputs update component state.
- Real Vue controlled inputs update reactive state.
- Same-origin embedded documents and open web-component roots are included in scanning, highlighting, user-edit protection, and reviewed filling.
- Internal listboxes controlled by a parent combobox are not duplicated as separate application fields.
- Required, select, radio, checkbox, textarea, hidden, password, and dynamic controls are covered across unit and Chromium tests.

## Verification

```bash
npm run verify
```

The gate runs formatting, lint, TypeScript, all unit/schema tests, production builds, the R0/R1 precision assertion, and unpacked-extension Chromium tests.

## Current limits

- No Next/Continue clicks.
- No uploads.
- No submission.
- No AI-based mapping.
- No filling for unknown facts or consent/open-text fields without verified reusable answers.
- Precision is measured on the committed controlled fixture matrix; broader live-site confidence comes from adapter-specific fixtures and read-only QA.
