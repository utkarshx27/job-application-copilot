import { ApplicationPageAnalysisSchema } from "@copilot/job-schema";
import { describe, expect, it } from "vitest";

import {
  controlledSubmitPlan,
  createSubmissionStore,
  prepareSubmissionIntent,
  setApplicationSubmission,
  setSubmissionEnabled,
  submissionReadiness,
  transitionSubmissionIntent,
} from "../src/index";

const now = "2026-09-01T10:00:00.000Z";
const analysis = ApplicationPageAnalysisSchema.parse({
  analysisVersion: 1,
  analysisId: "analysis-review",
  applicationId: "application:workday:test",
  snapshot: {
    schemaVersion: 1,
    url: "http://127.0.0.1:4173/workday.html",
    title: "Controlled Workday review",
    capturedAt: now,
    fields: [
      {
        fieldId: "review-attestation",
        controlKind: "checkbox",
        accessibleName: "I reviewed the application",
        labelText: "I reviewed the application",
        ariaLabel: "",
        placeholder: "",
        name: "reviewAttestation",
        domId: "review-attestation",
        required: true,
        disabled: false,
        readOnly: false,
        autocomplete: "",
        valueState: "USER_EDITED",
        groupLabel: "",
        optionValue: "",
        checked: true,
        userEdited: true,
        options: [],
      },
    ],
  },
  mappings: [],
  ats: {
    adapter: "WORKDAY",
    adapterVersion: "1",
    confidence: 0.999,
    supported: true,
    evidence: ["controlled"],
  },
  job: null,
  customQuestions: [],
  confirmation: { confirmed: false, evidence: [] },
  workflow: {
    schemaVersion: 1,
    tenant: "test",
    site: "fixture",
    pageType: "REVIEW",
    pageKey: "test:fixture:REVIEW:Review",
    fingerprint: "workday:abcdef12",
    heading: "Review",
    stepLabel: "Review",
    stepIndex: 4,
    stepCount: 4,
    visibleSections: ["Review Your Application"],
    authBoundary: "NONE",
    prefilledFieldCount: 1,
    userEditVersion: 1,
    resumeReconciliationRequired: false,
    navigation: {
      mode: "CONTROLLED_TEST_ONLY",
      backVisible: true,
      nextVisible: false,
      submitVisible: true,
      nextConfidence: 0,
      nextEvidence: [],
      submitConfidence: 0.999,
      submitEvidence: ["automation-id:submit", "controlled-submit-marker"],
    },
    errorState: null,
  },
  workflowProgress: {
    schemaVersion: 1,
    recoveryKey: "test:fixture",
    currentPageKey: "test:fixture:REVIEW:Review",
    currentPageType: "REVIEW",
    currentStepIndex: 4,
    stepCount: 4,
    observedPageKeys: [
      "test:fixture:MY_INFORMATION:My Information",
      "test:fixture:MY_EXPERIENCE:My Experience",
      "test:fixture:APPLICATION_QUESTIONS:Application Questions",
      "test:fixture:REVIEW:Review",
    ],
    observationCount: 4,
    recovered: true,
    revisitDetected: false,
    lastFingerprint: "workday:abcdef12",
    lastObservedAt: now,
  },
});

function enabledStore() {
  return setApplicationSubmission(
    setSubmissionEnabled(createSubmissionStore(), true),
    "application:workday:test",
    true,
  );
}

describe("controlled Test ATS submission", () => {
  it("defaults off and requires global and per-application opt-in", () => {
    expect(submissionReadiness({ analysis, store: createSubmissionStore() }).ready).toBe(false);
    expect(submissionReadiness({ analysis, store: enabledStore() }).ready).toBe(true);
  });

  it("requires explicit final consent before persisting an intent", () => {
    expect(() => prepareSubmissionIntent(enabledStore(), analysis, 4, false, now)).toThrow(
      "Explicit final submission consent",
    );
    expect(prepareSubmissionIntent(enabledStore(), analysis, 4, true, now).intent).toMatchObject({
      state: "PREPARED",
      targetToken: "WORKDAY_TEST_ATS_SUBMIT",
    });
  });

  it("persists dispatch before producing the only page command", () => {
    const prepared = prepareSubmissionIntent(enabledStore(), analysis, 4, true, now);
    expect(() => controlledSubmitPlan(prepared.intent)).toThrow("submit-dispatched");
    const dispatched = transitionSubmissionIntent(
      prepared.store,
      prepared.intent.id,
      "SUBMIT_DISPATCHED",
      { now: "2026-09-01T10:00:01.000Z" },
    );
    expect(controlledSubmitPlan(dispatched.intent)).toMatchObject({
      targetToken: "WORKDAY_TEST_ATS_SUBMIT",
      sourceFingerprint: "workday:abcdef12",
    });
    expect(submissionReadiness({ analysis, store: dispatched.store }).ready).toBe(false);
  });

  it("records confirmation and abort counts without field labels or answers", () => {
    const prepared = prepareSubmissionIntent(enabledStore(), analysis, 4, true, now);
    const aborted = transitionSubmissionIntent(prepared.store, prepared.intent.id, "ABORTED", {
      message: "Canceled during countdown.",
    });
    expect(aborted.store.metrics.userAborts).toBe(1);
    expect(JSON.stringify(aborted.store)).not.toContain("I reviewed the application");
  });

  it("allows a fresh approval after a pre-dispatch validation failure", () => {
    const prepared = prepareSubmissionIntent(enabledStore(), analysis, 4, true, now);
    const failed = transitionSubmissionIntent(prepared.store, prepared.intent.id, "FAILED", {
      failureCode: "VALIDATION_ERROR",
      message: "The review page changed before dispatch.",
    });

    expect(submissionReadiness({ analysis, store: failed.store }).ready).toBe(true);
    expect(failed.store.metrics).toMatchObject({ dispatched: 0, validationFailures: 1 });
  });
});
