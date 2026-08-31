import { ApplicationPageAnalysisSchema } from "@copilot/job-schema";
import { describe, expect, it } from "vitest";

import {
  controlledNextPlan,
  createAutoNextStore,
  navigationReadiness,
  prepareNavigationIntent,
  setApplicationAutoNext,
  setAutoNextEnabled,
  transitionNavigationIntent,
} from "../src/index";

const now = "2026-09-01T08:00:00.000Z";
const analysis = ApplicationPageAnalysisSchema.parse({
  analysisVersion: 1,
  analysisId: "analysis-1",
  applicationId: "application:workday:test",
  snapshot: {
    schemaVersion: 1,
    url: "http://127.0.0.1:4173/workday.html",
    title: "Controlled Workday",
    capturedAt: now,
    fields: [
      {
        fieldId: "first",
        controlKind: "text",
        accessibleName: "First name",
        labelText: "First name",
        ariaLabel: "",
        placeholder: "",
        name: "first",
        domId: "first",
        required: true,
        disabled: false,
        readOnly: false,
        autocomplete: "",
        valueState: "COPILOT_FILLED",
        groupLabel: "",
        optionValue: "",
        checked: false,
        userEdited: false,
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
    pageType: "MY_INFORMATION",
    pageKey: "test:fixture:MY_INFORMATION:My Information",
    fingerprint: "workday:1234abcd",
    heading: "My Information",
    visibleSections: ["Contact Information"],
    authBoundary: "NONE",
    prefilledFieldCount: 0,
    userEditVersion: 0,
    resumeReconciliationRequired: false,
    navigation: {
      mode: "CONTROLLED_TEST_ONLY",
      backVisible: false,
      nextVisible: true,
      submitVisible: false,
      nextConfidence: 0.999,
      nextEvidence: ["automation-id:bottom-navigation-next-button"],
    },
    errorState: null,
  },
});

function enabledStore() {
  return setApplicationAutoNext(
    setAutoNextEnabled(createAutoNextStore(), true),
    "application:workday:test",
    true,
  );
}

describe("controlled auto-next", () => {
  it("defaults off and requires both feature and application opt-in", () => {
    expect(navigationReadiness({ analysis, store: createAutoNextStore() }).ready).toBe(false);
    expect(navigationReadiness({ analysis, store: enabledStore() }).ready).toBe(true);
  });

  it("persists dispatch before producing the page command and blocks duplicate fingerprints", () => {
    const prepared = prepareNavigationIntent(enabledStore(), analysis, 7, now);
    expect(() => controlledNextPlan(prepared.intent)).toThrow("click-dispatched");
    const dispatched = transitionNavigationIntent(
      prepared.store,
      prepared.intent.id,
      "CLICK_DISPATCHED",
      { now: "2026-09-01T08:00:01.000Z" },
    );
    expect(controlledNextPlan(dispatched.intent)).toMatchObject({
      targetToken: "WORKDAY_BOTTOM_NAVIGATION_NEXT",
      sourceFingerprint: "workday:1234abcd",
    });
    expect(navigationReadiness({ analysis, store: dispatched.store }).ready).toBe(false);
  });

  it("records aborts and successful transitions without page values", () => {
    const prepared = prepareNavigationIntent(enabledStore(), analysis, 7, now);
    const aborted = transitionNavigationIntent(prepared.store, prepared.intent.id, "ABORTED", {
      now: "2026-09-01T08:00:01.000Z",
      message: "Canceled during countdown.",
    });
    expect(aborted.store.metrics.userAborts).toBe(1);
    expect(JSON.stringify(aborted.store)).not.toContain("First name");
  });
});
