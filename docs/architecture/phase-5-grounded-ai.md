# Phase 5 — Grounded AI drafting

Phase 5 adds optional drafting for a small allowlist of open-text narrative questions. It does not replace deterministic mapping, infer sensitive facts, operate the browser, navigate, or submit. A generated answer remains panel-only until the user chooses **Use this draft in review** and then separately chooses **Fill reviewed custom answers**.

## Package boundaries

- `ai-gateway` owns provider-neutral task and output schemas, prompt versioning, timeouts, bounded retries, structured-output validation, redacted audit metadata, and provider adapters.
- `grounded-generation` owns allowed narrative categories, deterministic-first classification, evidence minimization, policy checks, claim verification, sensitive-output checks, and hard character limits.
- `question-ontology` owns the canonical narrative IDs and remains the first classifier.
- `browser-command-schema` allowlists session configuration and draft requests. Model output cannot create a browser command.
- The extension background worker reads the validated form analysis and profile, builds the minimized request, and returns a draft or refusal to the side panel.

## Routing and trust boundary

```text
Untrusted page question
  → local ontology and risk policy
  → manual refusal for R2/R3/R4 or prohibited wording
  → optional AI classification only after deterministic failure
  → select verified PUBLIC/PROFESSIONAL candidate facts
  → add bounded detected-job evidence
  → schema-constrained generation with evidence IDs and atomic claims
  → local claim, PII, unsupported-token, and character-limit checks
  → reviewable panel draft or refusal
  → explicit use-draft action
  → explicit reviewed-fill action
```

The classification task receives only the question and control kind; it receives no candidate profile. Generation receives a bounded job context and at most 24 selected evidence items. Candidate evidence is restricted to user-verified, document-verified, or derived facts with public or professional sensitivity. Email-like values and sensitive facts are excluded.

Page and job text are treated as untrusted data. The system prompt rejects embedded commands, and a local preflight blocks credential, identity-document, security-disablement, and sensitive/consequential wording before any provider call.

## Provider and credential handling

The production adapter calls the OpenAI Responses API with strict JSON-schema output, no tools, and `store: false`. Its API key and model are kept in `chrome.storage.session`. The status response contains only whether AI is configured, the provider, and the model; the key is never returned to the side panel after configuration and is never included in profile storage, JSON backups, page fields, prompts, or audit records.

The adapter boundary is provider-neutral. A deterministic fixture provider exercises the same schemas and review flow without a network call or API key. Adding another production provider requires an adapter that returns the same validated task outputs; it does not change browser authority.

## Output verification and failure behavior

Every generated draft must:

- use an allowed narrative canonical question;
- cite only evidence IDs supplied in its request;
- declare atomic claims and their supporting evidence;
- report no unsupported claims;
- stay within the exact visible-control character limit, or the 1,000-character conservative default;
- contain no email, phone, credential, sensitive-question, or command-like content;
- introduce no numeric or capitalized factual tokens absent from the question and evidence.

Any violation returns a typed refusal and no draft text. Provider timeout, malformed structured output, missing evidence, uncertain classification, and missing job context also fail closed. Deterministic standard-field filling remains available when AI is absent or fails.

## User flow

1. In **Observe**, optionally enter an OpenAI model and API key and enable them for the browser session.
2. Scan a supported application page.
3. For an eligible narrative question with no fresh saved response, choose **Draft with grounded AI**.
4. Review the text, character count, and cited evidence IDs.
5. Choose **Use this draft in review**, then edit if needed.
6. Choose **Fill reviewed custom answers** to place reviewed text into the form.

Clearing the session settings removes the provider configuration and in-panel drafts. The extension never clicks Next or Submit.

## Verification

The Phase 5 release blocker suite covers provider-independent structured outputs, task mismatch, malformed output, the no-tools and `store: false` request settings, evidence minimization, profile-free classification, prompt injection, sensitive wording, unknown evidence, unsupported claims, invented metrics, PII, and over-limit answers. Browser-command tests prove extra action fields are stripped and key material cannot appear in a parsed status response.

The Chromium flow uses the deterministic fixture provider and proves three distinct states: generation leaves the application blank, choosing the draft still leaves it blank, and only the existing reviewed-fill action changes the page. The existing Greenhouse, Lever, résumé, saved-response, user-edit, React, Vue, and submission-prohibition scenarios continue to pass. The enforced 200-form Phase 3 replay remains the ATS regression gate.

Run the complete release gate:

```bash
npm run verify
npm run ats:qa:replay -- --enforce
```
