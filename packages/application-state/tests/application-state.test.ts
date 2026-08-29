import { describe, expect, it } from "vitest";

import { ApplicationPageAnalysisSchema } from "@copilot/job-schema";

import {
  createEmptyTracker,
  recordApplying,
  recordConfirmation,
  recordResumeUpload,
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
});
