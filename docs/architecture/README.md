# Architecture records

These documents record how the current MVP was designed and implemented. Their numbered filenames are retained for stable links and historical context; they are not an active milestone plan.

For current installation, usage, features, and verification commands, use the repository [README](../../README.md). For new work, use the [living development backlog](../DEVELOPMENT.md) and GitHub issues.

The [application-agent architecture](../agent/ARCHITECTURE.md) describes the successor controller, discovery, company research, and correction-memory system. The [read-only agent foundation](../agent/AGENT_LAB.md) is now implemented experimentally; the [plan index](../agent/README.md) distinguishes that slice from future capabilities and the MVP records below.

## Records by component

- [Engineering foundation](./phase-0-foundation.md)
- [Local Truth Vault and profile](./phase-1-truth-vault.md)
- [Generic form engine](./phase-2-generic-form-engine.md)
- [Greenhouse and Lever adapters](./phase-3-greenhouse-lever.md)
- [Saved responses and question ontology](./phase-4-saved-responses-ontology.md)
- [Grounded AI drafting](./phase-5-grounded-ai.md)
- [Ashby and SmartRecruiters adapters](./phase-6-ashby-smartrecruiters.md)
- [Workday controlled implementation](./phase-7-workday.md)
- [Tracker and duplicate engine](./phase-8-tracker.md)
- [Additional ATS adapters](./phase-9-additional-ats.md)
- [Optional encrypted sync](./phase-10-optional-cloud-sync.md)
- [Controlled Test ATS navigation](./phase-11-controlled-auto-next.md)
- [Controlled Test ATS submission](./phase-12-controlled-submission.md)

Security and automation boundaries described in these records remain binding unless a reviewed change updates the implementation, tests, current README, and security policy together.
