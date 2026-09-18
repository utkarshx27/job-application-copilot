# AG-09 five-user study kit

Status: prepared, **not conducted**. Recruit at least five people who have not used this extension. Five automated runs or one maintainer's tests are not five users.

## Facilitator setup

Use a separate Chrome test profile per participant, the research extension, local Test ATS and synthetic details from [the preparation guide](./JOB_PREPARATION.md). Give participants the README and setup link; observe setup before helping. Record assistance and failures. Ask permission for anonymous notes. Recording is optional and requires separate consent; it is unnecessary for this study. Do not collect real résumés, personal accounts, names, cookies, session identifiers or API keys.

## Tasks

1. Install/load the research extension and open it.
2. Import or enter the supplied synthetic profile, verify it and review preferences.
3. Search demo jobs and explain the fit and employer evidence, including an unavailable rating.
4. Prepare job-7-8 through review with the synthetic résumé. Explain whether it is already submitted.
5. Pause/take over or resolve Annual earnings on job-7-9. Save its meaning if desired.
6. Approve one local submission, find the tracker receipt, and explain an unknown outcome.
7. Try job-7-13 to inspect correction reuse. Find memory deletion and private-data clearing.

For every task, record success, abandonment, elapsed seconds, assistance count and the participant's explanation. Ask what they expected, which label was unclear, and what they would change first. Avoid leading questions.

## Anonymous observation sheet

Copy for P01 through P05:

- Participant ID:
- Build/source commit and Chrome version:
- Prior experience loading unpacked extensions (none/some):
- Consent to anonymous notes (yes/no):
- Task results 1–7, including time and assistance:
- Setup completed without help (yes/no):
- Completion or abandonment:
- Correctly distinguished Prepared / Submitted / Unknown (yes/no):
- Most confusing point:
- Most useful feature:
- Requested change:
- Sanitized run-metrics file, if voluntarily supplied:

## Review outcome

### Structured observations

Copy `qa/usability/ag09-observations.example.json` to an ignored local file such as `test-results/usability/observations.local.json`. Only set `realParticipantObservations` to true after collecting real observations with consent. For each P01–P05 participant, add:

```json
{
  "id": "P01",
  "consent": true,
  "newUser": true,
  "build": "actual tested commit or build hash",
  "chromeVersion": "actual version",
  "distinguishedPreparedSubmittedUnknown": false,
  "tasks": [{ "id": 1, "outcome": "not-attempted", "seconds": 0, "assistance": 0 }]
}
```

This is a schema illustration, not a completed observation. Record all seven tasks (IDs 1–7) with outcomes `completed`, `abandoned` or `not-attempted`; retain failures and abandonment in the denominator. Keep sanitized qualitative notes separately using the observation sheet above. Do not put names, contact details, account data, recordings or private files into Git.

Run `npm run agent:study:report -- --input test-results/usability/observations.local.json`. The report validates completeness and summarizes task success, assistance, timing and state understanding. It rejects fewer than five observations and never automatically approves a release. Participant authenticity and findings review remain human responsibilities. Do not recruit or contact people without their consent.

Report participant count, completion denominators including abandonment, setup failures, median/p90 task times, assistance counts and themes. Use the [findings and retest template](../../qa/usability/ag09-findings.example.md) to link focused issues with observed evidence and severity. Keep acceptance open until at least five new users participate and findings are reviewed. This small study is exploratory, not broad usability validation.
