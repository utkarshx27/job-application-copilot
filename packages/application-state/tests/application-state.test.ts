import { describe, expect, it } from "vitest";

import { ApplicationPageAnalysisSchema } from "@copilot/job-schema";

import {
  createEmptyTracker,
  recordApplying,
  recordConfirmation,
  recordResumeUpload,
  recordWorkdayWorkflow,
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
