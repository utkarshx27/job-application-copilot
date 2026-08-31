import { describe, expect, it } from "vitest";

import { ApplicationPageAnalysisSchema } from "@copilot/job-schema";

import {
  canonicalIdentityForJob,
  createEmptyTracker,
  exportTrackerCsv,
  findDuplicateWarnings,
  importTrackerCsv,
  migrateApplicationTracker,
  recordApplying,
  recordConfirmation,
  recordResumeUpload,
  recordWorkdayWorkflow,
  updateApplicationStatus,
} from "../src/index";

const now = "2026-08-29T08:00:00.000Z";

const analysis = ApplicationPageAnalysisSchema.parse({
  analysisVersion: 1,
  analysisId: "analysis-1",
  applicationId: "application:greenhouse:abc",
  snapshot: {
    schemaVersion: 1,
    url: "https://boards.greenhouse.io/example/jobs/100",
    title: "Platform Engineer",
    capturedAt: now,
    fields: [],
  },
  mappings: [],
  ats: {
    adapter: "GREENHOUSE",
    adapterVersion: "1",
    confidence: 0.999,
    supported: true,
    evidence: ["host:boards.greenhouse.io"],
  },
  job: {
    schemaVersion: 1,
    id: "greenhouse:abc",
    ats: "GREENHOUSE",
    title: "Platform Engineer",
    company: "ExampleCo",
    description: "Build systems.",
    remotePolicy: "UNKNOWN",
    requiredSkills: [],
    preferredSkills: [],
    sourceUrl: "https://boards.greenhouse.io/example/jobs/100",
    applicationUrl: "https://boards.greenhouse.io/example/jobs/100",
    snapshotAt: now,
  },
  customQuestions: [],
  confirmation: { confirmed: false, evidence: [] },
});

describe("application tracker", () => {
  it("records applying, approved resume metadata, and verified confirmation", () => {
    let tracker = recordApplying(createEmptyTracker(now), analysis, 3, now);
    expect(tracker.applications[0]).toMatchObject({ status: "APPLYING", profileVersion: 3 });
    tracker = recordResumeUpload(
      tracker,
      analysis.applicationId!,
      "resume.pdf",
      "a".repeat(64),
      now,
    );
    expect(tracker.applications[0]?.resumeFileName).toBe("resume.pdf");
    tracker = recordConfirmation(
      tracker,
      analysis.applicationId!,
      { confirmed: true, heading: "Application received", evidence: ["fixture"] },
      now,
    );
    expect(tracker.applications[0]).toMatchObject({ status: "APPLIED", appliedAt: now });
  });

  it("uses a canonical identity and appends only changed immutable snapshots", () => {
    const first = recordApplying(createEmptyTracker(now), analysis, 3, now);
    expect(first).toMatchObject({ trackerVersion: 2 });
    expect(first.applications[0]?.canonicalIdentity).toMatchObject({
      strategy: "APPLICATION_URL",
      normalizedCompany: "exampleco",
      normalizedTitle: "platform engineer",
    });
    expect(first.applications[0]?.snapshots).toHaveLength(1);

    const unchanged = recordApplying(first, analysis, 3, "2026-08-29T08:01:00.000Z");
    expect(unchanged.applications[0]?.snapshots).toHaveLength(1);

    const changedAnalysis = ApplicationPageAnalysisSchema.parse({
      ...analysis,
      job: { ...analysis.job!, description: "Build safer distributed systems." },
    });
    const changed = recordApplying(unchanged, changedAnalysis, 3, "2026-08-29T08:02:00.000Z");
    expect(changed.applications[0]?.snapshots).toHaveLength(2);
    expect(changed.applications[0]?.snapshots[0]?.job.description).toBe("Build systems.");
    expect(changed.applications[0]?.snapshots[1]?.changedFields).toEqual(["description"]);
  });

  it("migrates version 1 records without losing application history", () => {
    const current = recordApplying(createEmptyTracker(now), analysis, 3, now);
    const record = current.applications[0]!;
    const { canonicalIdentity: _identity, snapshots: _snapshots, ...legacyRecord } = record;
    expect(_identity.key).toMatch(/^job:/);
    expect(_snapshots).toHaveLength(1);
    const migrated = migrateApplicationTracker({
      trackerVersion: 1,
      updatedAt: now,
      applications: [legacyRecord],
    });
    expect(migrated).toMatchObject({ trackerVersion: 2, updatedAt: now });
    expect(migrated.applications[0]).toMatchObject({
      id: analysis.applicationId,
      status: "APPLYING",
    });
    expect(migrated.applications[0]?.snapshots).toHaveLength(1);
  });

  it("meets the controlled duplicate precision target without blocking distinct jobs", () => {
    const requisitionAnalysis = ApplicationPageAnalysisSchema.parse({
      ...analysis,
      job: { ...analysis.job!, externalRequisitionId: "REQ-100" },
    });
    const tracked = recordApplying(createEmptyTracker(now), requisitionAnalysis, 3, now);
    const cases = [
      {
        expected: true,
        applicationId: analysis.applicationId!,
        job: requisitionAnalysis.job!,
      },
      {
        expected: true,
        applicationId: "application:same-requisition",
        job: {
          ...requisitionAnalysis.job!,
          id: "same-requisition",
          title: "Platform Engineer II",
          applicationUrl: "https://boards.greenhouse.io/example/jobs/alternate",
        },
      },
      {
        expected: true,
        applicationId: "application:query-variant",
        job: {
          ...analysis.job!,
          id: "query-variant",
          applicationUrl: `${analysis.job!.applicationUrl}?source=board`,
        },
      },
      {
        expected: true,
        applicationId: "application:matching-details",
        job: {
          ...analysis.job!,
          id: "matching-details",
          applicationUrl: "https://jobs.example.com/other-role",
        },
      },
      {
        expected: false,
        applicationId: "application:different-title",
        job: {
          ...analysis.job!,
          id: "different-title",
          title: "Security Engineer",
          applicationUrl: "https://jobs.example.com/security",
        },
      },
      {
        expected: false,
        applicationId: "application:different-company",
        job: {
          ...analysis.job!,
          id: "different-company",
          company: "Another Co",
          applicationUrl: "https://jobs.example.com/platform",
        },
      },
    ];
    const predictions = cases.map((item) => ({
      expected: item.expected,
      predicted: findDuplicateWarnings(tracked, item.applicationId, item.job).length > 0,
    }));
    const truePositives = predictions.filter((item) => item.expected && item.predicted).length;
    const falsePositives = predictions.filter((item) => !item.expected && item.predicted).length;
    expect(truePositives / (truePositives + falsePositives)).toBe(1);
    expect(predictions.every((item) => item.expected === item.predicted)).toBe(true);
  });

  it("supports local status changes and validated CSV round trips", () => {
    let tracker = recordApplying(createEmptyTracker(now), analysis, 3, now);
    tracker = updateApplicationStatus(
      tracker,
      analysis.applicationId!,
      "INTERVIEW",
      "2026-08-30T08:00:00.000Z",
    );
    expect(tracker.applications[0]?.status).toBe("INTERVIEW");
    const exported = exportTrackerCsv(tracker);
    expect(exported).toMatchObject({ formatVersion: 1, exported: 1 });
    const imported = importTrackerCsv(
      createEmptyTracker(now),
      exported.csv,
      "2026-08-30T09:00:00.000Z",
    );
    expect(imported).toMatchObject({ imported: 1, updated: 0, skipped: 0, warnings: [] });
    expect(imported.tracker.applications[0]).toMatchObject({
      id: analysis.applicationId,
      status: "INTERVIEW",
      ats: "GREENHOUSE",
    });
  });

  it("uses ATS requisitions when available and neutralizes spreadsheet formulas", () => {
    const job = { ...analysis.job!, externalRequisitionId: "REQ-100", company: "=FORMULA()" };
    expect(canonicalIdentityForJob(job)).toMatchObject({ strategy: "ATS_REQUISITION" });
    const formulaAnalysis = ApplicationPageAnalysisSchema.parse({ ...analysis, job });
    const csv = exportTrackerCsv(
      recordApplying(createEmptyTracker(now), formulaAnalysis, 3, now),
    ).csv;
    expect(csv).toContain('"\'=FORMULA()"');
  });

  it("persists Workday progress and recovers without issuing navigation commands", () => {
    const workdayAnalysis = ApplicationPageAnalysisSchema.parse({
      ...analysis,
      applicationId: "application:workday:abc",
      ats: { ...analysis.ats, adapter: "WORKDAY" },
      job: { ...analysis.job!, id: "workday:abc", ats: "WORKDAY" },
      workflow: {
        schemaVersion: 1,
        tenant: "example",
        site: "External",
        pageType: "MY_INFORMATION",
        pageKey: "example:External:MY_INFORMATION",
        fingerprint: "workday:1234abcd",
        heading: "My Information",
        stepLabel: "My Information",
        stepIndex: 1,
        stepCount: 4,
        visibleSections: ["Contact Information"],
        authBoundary: "NONE",
        prefilledFieldCount: 1,
        resumeReconciliationRequired: true,
        navigation: {
          mode: "MANUAL_ONLY",
          backVisible: false,
          nextVisible: true,
          submitVisible: false,
        },
        errorState: null,
      },
    });
    let tracker = recordApplying(createEmptyTracker(now), workdayAnalysis, 3, now);
    tracker = recordWorkdayWorkflow(
      tracker,
      workdayAnalysis.applicationId!,
      workdayAnalysis.workflow!,
      now,
    );
    expect(tracker.applications[0]?.workflowProgress).toMatchObject({
      currentPageType: "MY_INFORMATION",
      observationCount: 1,
      recovered: false,
    });

    tracker = recordWorkdayWorkflow(
      tracker,
      workdayAnalysis.applicationId!,
      workdayAnalysis.workflow!,
      "2026-08-29T08:01:00.000Z",
    );
    expect(tracker.applications[0]?.workflowProgress).toMatchObject({
      observationCount: 2,
      recovered: true,
      observedPageKeys: ["example:External:MY_INFORMATION"],
    });
  });
});
