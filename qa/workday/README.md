# Workday pre-submit validation

The controlled Phase 7 implementation is automated. The roadmap's separate real-world gate requires at least 250 Workday application flows across multiple tenants and regions. It is not satisfied by repeatedly scanning one company or by counting job-description pages that never enter the application wizard.

## What automation verifies

`npm run check:phase7` verifies the sanitized multi-step fixture, including tenant detection, field mapping, parsed-value protection, dynamic questions, refresh recovery, authentication explanations, confirmation tracking, and the absence of Next/Submit commands.

## What a person must verify on public Workday flows

For each distinct application, stop before submission and record only sanitized observations:

1. Tenant/site and requisition identity are correct.
2. The current page type and progress step are correct.
3. Visible native fields are represented; password and hidden fields are absent.
4. Résumé/account-parsed fields are marked prefilled without exposing their contents and cannot be selected for fill.
5. Work history, education, skills, and questionnaires are mapped or left manual correctly.
6. Custom prompt/combobox/listbox controls remain manual.
7. Authentication is completed only by the tester; credentials and session state are never captured.
8. The tester—not the extension—uses Back or Next once, then rescans.
9. Refresh restores the same locally tracked application and step without an automatic click.
10. Validation/session errors are explained, and no application is submitted.

## Privacy and safety rules

- Use a synthetic test identity only where the employer explicitly permits testing; otherwise perform read-only inspection and stop at authentication.
- Never commit URLs containing tokens, query strings, candidate IDs, email addresses, or tenant session identifiers.
- Never save cookies, local/session storage, passwords, CSRF data, raw HTML, screenshots containing candidate information, résumé contents, or entered answers.
- Never bypass CAPTCHA, bot detection, access controls, or employer policy.
- Never count a flow unless the ATS and required checks were manually confirmed.
- A confirmation page may be tested only in an employer-controlled sandbox or with an application the tester genuinely intended to submit. The project does not submit test applications to real employers.

## Release record

Keep the 250-flow evidence outside git until it is sanitized. The final aggregate record may contain counts by tenant/region/page type, mapping decisions, recovery/error outcomes, and zero-incident assertions. It must not contain candidate data or session material.

Phase 7 can be marked production-validated only when:

- at least 250 distinct pre-submit flows cover multiple tenants and regions;
- no navigation loop or repeated Next action occurs;
- refresh recovery is correct;
- every encountered error state is explained or explicitly classified unsupported;
- severe wrong-field incidents are zero.
