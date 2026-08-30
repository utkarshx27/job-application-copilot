# Phase 4 — Saved responses and question ontology

Phase 4 adds safe reuse for repeated custom application questions. It does not generate answers, navigate, or submit forms. Every reused answer remains visible in the side panel and requires the user to press the reviewed-fill button.

## Package boundaries

- `question-ontology` owns canonical question IDs, ontology version 1, risk levels, aliases, keyword rules, local semantic comparison, freshness defaults, and reuse policy.
- `saved-response-engine` owns scope checks, matching order, expiry, suggestion policy, and creation of user-confirmed saved responses.
- `candidate-schema` owns the validated local answer-library record and its scope key.
- `profile-core` versions the profile whenever a taught answer is added or replaced.
- The extension background worker classifies untrusted page labels and persists only responses explicitly approved by the user.

## Matching and review flow

```text
Untrusted visible question
  → normalize locally
  → exact alias
  → deterministic keyword rule
  → bounded token-semantic comparison
  → risk and ambiguity policy
  → scope and freshness check
  → reviewable suggestion or manual review
```

AI is not used. A page cannot provide a canonical ID, scope, answer, or storage command. The background worker recomputes all of those decisions from the validated scan and the user's explicit scope choice.

The teach-once control defaults to **Do not save**. Depending on risk and detected context, the user may choose this application, this company, jobs in this country, similar roles, or similar questions everywhere. Missing context removes that scope from the UI and the worker rejects forged or incompatible scope requests.

## Freshness

Each saved response records its ontology version, creation and verification timestamps, and a hard expiry. Examples:

- notice period and start date: 30 days;
- compensation: 60 days;
- work authorization and location preferences: 90 days;
- company/role narratives: 180 days;
- referral source: 365 days.

An expired match returns no answer value. The side panel shows a stale-response prompt and requires the user to enter and optionally save a current answer.

## Consequential and sensitive questions

Current authorization, sponsorship required now, sponsorship required in the future, and visa type are separate canonical questions. Precise variants map deterministically. Missing timing, combined current/future wording, negative wording, and double negatives are sent to review with no reusable answer.

R4 questions—including gender, race/ethnicity, disability, veteran status, and criminal history—are classification-only. The engine never infers, suggests, or stores an answer for them. Citizenship and security-clearance questions require explicit facts and narrow scope; they are never inferred from names, locations, résumés, or job metadata.

## Verification

The controlled ontology suite contains 16 work-authorization variants: 10 precise variants map to the correct distinct canonical question and 6 unsafe variants route to review. The integrated form-engine suite repeats the safety boundary before autofill planning. The 200-form Phase 3 replay also passes after an audited correction moved 198 combined current/future sponsorship controls across 99 fixtures to manual review; the adjusted gate records 1,667/1,667 successful eligible fills and zero severe incidents. Saved-response tests cover company and country scope, word-order changes, company substitution, stale answers, consequential scope restrictions, and the R4 no-inference rule. The Chromium flow teaches a company-scoped answer, reloads a blank application, and verifies that the answer is suggested in the panel but not placed on the page until reviewed fill.

Run the complete release gate:

```bash
npm run check:phase4
```
