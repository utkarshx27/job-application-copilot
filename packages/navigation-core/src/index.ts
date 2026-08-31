import {
  ApplicationPageAnalysisSchema,
  WorkdayWorkflowPageSchema,
  type ApplicationPageAnalysis,
} from "@copilot/job-schema";
import { z } from "zod";

const ISODateTimeSchema = z.iso.datetime({ offset: true });
const MAX_INTENTS = 100;
const INTENT_LIFETIME_MS = 30_000;
export const AUTO_NEXT_CONFIDENCE = 0.995;

export const NavigationIntentStateSchema = z.enum([
  "PREPARED",
  "CLICK_DISPATCHED",
  "VERIFYING",
  "ADVANCED",
  "ABORTED",
  "MANUAL_REQUIRED",
  "FAILED",
]);

export const NavigationBlockCodeSchema = z.enum([
  "FEATURE_DISABLED",
  "APPLICATION_NOT_OPTED_IN",
  "UNSUPPORTED_ADAPTER",
  "UNCONTROLLED_HOST",
  "LOW_CONFIDENCE",
  "STALE_ANALYSIS",
  "AUTH_BOUNDARY",
  "VALIDATION_ERROR",
  "REQUIRED_FIELD_EMPTY",
  "HIGH_RISK_REVIEW",
  "MANUAL_CONTROL",
  "RESUME_RECONCILIATION",
  "HUMAN_GATE",
  "NEXT_UNAVAILABLE",
  "SUBMIT_VISIBLE",
  "REVISIT_DETECTED",
  "ALREADY_DISPATCHED",
  "INTENT_EXPIRED",
  "TRANSITION_TIMEOUT",
]);

export const NavigationReadinessSchema = z.object({
  ready: z.boolean(),
  confidence: z.number().min(0).max(1),
  checks: z.array(
    z.object({
      code: NavigationBlockCodeSchema,
      passed: z.boolean(),
      message: z.string().min(1).max(1_000),
    }),
  ),
});

export const NavigationIntentSchema = z.object({
  intentVersion: z.literal(1),
  id: z.string().min(1),
  applicationId: z.string().min(1),
  analysisId: z.string().min(1),
  adapter: z.literal("WORKDAY"),
  adapterVersion: z.string().min(1),
  tabId: z.number().int().nonnegative(),
  sourceUrl: z.url(),
  sourcePageKey: z.string().min(1),
  sourceFingerprint: z.string().regex(/^workday:[a-f0-9]{8}$/),
  sourceUserEditVersion: z.number().int().nonnegative(),
  targetToken: z.literal("WORKDAY_BOTTOM_NAVIGATION_NEXT"),
  state: NavigationIntentStateSchema,
  createdAt: ISODateTimeSchema,
  expiresAt: ISODateTimeSchema,
  clickDispatchedAt: ISODateTimeSchema.optional(),
  completedAt: ISODateTimeSchema.optional(),
  destinationPageKey: z.string().min(1).optional(),
  failureCode: NavigationBlockCodeSchema.optional(),
  message: z.string().min(1).max(1_000).optional(),
});

export const AutoNextStoreSchema = z.object({
  storeVersion: z.literal(1),
  enabled: z.boolean(),
  applicationOptIns: z.record(z.string(), z.boolean()),
  intents: z.array(NavigationIntentSchema).max(MAX_INTENTS),
  metrics: z.object({
    prepared: z.number().int().nonnegative(),
    advanced: z.number().int().nonnegative(),
    validationFailures: z.number().int().nonnegative(),
    navigationLoops: z.number().int().nonnegative(),
    userAborts: z.number().int().nonnegative(),
    transitionTimeouts: z.number().int().nonnegative(),
  }),
});

export const ControlledNextPlanSchema = NavigationIntentSchema.pick({
  id: true,
  applicationId: true,
  analysisId: true,
  adapter: true,
  adapterVersion: true,
  sourceUrl: true,
  sourcePageKey: true,
  sourceFingerprint: true,
  sourceUserEditVersion: true,
  targetToken: true,
  expiresAt: true,
}).extend({ intentId: z.string().min(1) });

export const ControlledNextClickResultSchema = z.object({
  intentId: z.string().min(1),
  clicked: z.literal(true),
  sourcePageKey: z.string().min(1),
  sourceFingerprint: z.string().regex(/^workday:[a-f0-9]{8}$/),
  observedPageKey: z.string().min(1),
  observedFingerprint: z.string().regex(/^workday:[a-f0-9]{8}$/),
});

export const AutoNextPanelStateSchema = z.object({
  enabled: z.boolean(),
  applicationOptedIn: z.boolean(),
  controlledEnvironment: z.boolean(),
  readiness: NavigationReadinessSchema,
  activeIntent: NavigationIntentSchema.optional(),
  latestIntent: NavigationIntentSchema.optional(),
});

export const AutoNextActionResultSchema = z.object({
  intent: NavigationIntentSchema,
  panelState: AutoNextPanelStateSchema,
});

export type NavigationBlockCode = z.infer<typeof NavigationBlockCodeSchema>;
export type NavigationReadiness = z.infer<typeof NavigationReadinessSchema>;
export type NavigationIntent = z.infer<typeof NavigationIntentSchema>;
export type AutoNextStore = z.infer<typeof AutoNextStoreSchema>;
export type ControlledNextPlan = z.infer<typeof ControlledNextPlanSchema>;
export type ControlledNextClickResult = z.infer<typeof ControlledNextClickResultSchema>;
export type AutoNextPanelState = z.infer<typeof AutoNextPanelStateSchema>;
export type AutoNextActionResult = z.infer<typeof AutoNextActionResultSchema>;

export function createAutoNextStore(): AutoNextStore {
  return {
    storeVersion: 1,
    enabled: false,
    applicationOptIns: {},
    intents: [],
    metrics: {
      prepared: 0,
      advanced: 0,
      validationFailures: 0,
      navigationLoops: 0,
      userAborts: 0,
      transitionTimeouts: 0,
    },
  };
}

export function isControlledAutoNextUrl(value: string): boolean {
  const url = new URL(value);
  return (
    url.protocol === "http:" &&
    url.hostname === "127.0.0.1" &&
    url.port === "4173" &&
    url.pathname === "/workday.html"
  );
}

function check(
  code: NavigationBlockCode,
  passed: boolean,
  message: string,
): NavigationReadiness["checks"][number] {
  return { code, passed, message };
}

function unresolvedRequiredFields(analysis: ApplicationPageAnalysis): string[] {
  return analysis.snapshot.fields
    .filter(
      (field) =>
        field.required &&
        !field.disabled &&
        field.valueState !== "PREFILLED" &&
        field.valueState !== "COPILOT_FILLED" &&
        field.valueState !== "USER_EDITED",
    )
    .map((field) => field.accessibleName || field.labelText || field.fieldId);
}

function highRiskQuestions(analysis: ApplicationPageAnalysis): string[] {
  return analysis.customQuestions
    .filter(
      (question) => question.savedResponse.risk === "R3" || question.savedResponse.risk === "R4",
    )
    .map((question) => question.label);
}

function manualQuestions(analysis: ApplicationPageAnalysis): string[] {
  return analysis.customQuestions
    .filter((question) => question.responseMode === "MANUAL")
    .map((question) => question.label);
}

export function navigationReadiness(input: {
  analysis: ApplicationPageAnalysis;
  store: AutoNextStore;
}): NavigationReadiness {
  const analysis = ApplicationPageAnalysisSchema.parse(input.analysis);
  const store = AutoNextStoreSchema.parse(input.store);
  const workflow = analysis.workflow;
  const required = unresolvedRequiredFields(analysis);
  const highRisk = highRiskQuestions(analysis);
  const manual = manualQuestions(analysis);
  const optedIn = analysis.applicationId
    ? store.applicationOptIns[analysis.applicationId] === true
    : false;
  const controlled = isControlledAutoNextUrl(analysis.snapshot.url);
  const activeOrDispatched = store.intents.find(
    (intent) =>
      intent.applicationId === analysis.applicationId &&
      intent.sourceFingerprint === workflow?.fingerprint &&
      ["PREPARED", "CLICK_DISPATCHED", "VERIFYING", "ADVANCED"].includes(intent.state),
  );
  const checks: NavigationReadiness["checks"] = [
    check("FEATURE_DISABLED", store.enabled, "The experimental auto-next flag is enabled."),
    check("APPLICATION_NOT_OPTED_IN", optedIn, "Auto-next is enabled for this application only."),
    check(
      "UNSUPPORTED_ADAPTER",
      analysis.ats.adapter === "WORKDAY" && Boolean(workflow),
      "The active page uses the controlled Workday workflow adapter.",
    ),
    check(
      "UNCONTROLLED_HOST",
      controlled && workflow?.navigation.mode === "CONTROLLED_TEST_ONLY",
      "The page is the controlled local Workday Test ATS fixture.",
    ),
    check(
      "LOW_CONFIDENCE",
      analysis.ats.confidence >= AUTO_NEXT_CONFIDENCE &&
        (workflow?.navigation.nextConfidence ?? 0) >= AUTO_NEXT_CONFIDENCE,
      `Detection and Next evidence meet the ${AUTO_NEXT_CONFIDENCE} threshold.`,
    ),
    check(
      "AUTH_BOUNDARY",
      workflow?.authBoundary === "NONE",
      "No authentication or account boundary is present.",
    ),
    check(
      "VALIDATION_ERROR",
      !workflow?.errorState,
      "The adapter reports no visible validation or session error.",
    ),
    check(
      "REQUIRED_FIELD_EMPTY",
      required.length === 0,
      required.length === 0
        ? "All visible required fields contain reviewed values."
        : `Required fields still need attention: ${required.join(", ")}.`,
    ),
    check(
      "HIGH_RISK_REVIEW",
      highRisk.length === 0,
      highRisk.length === 0
        ? "No unresolved R3/R4 questions are visible."
        : `High-risk questions require manual review: ${highRisk.join(", ")}.`,
    ),
    check(
      "MANUAL_CONTROL",
      manual.length === 0,
      manual.length === 0
        ? "No custom manual-only controls are visible."
        : `Manual controls remain: ${manual.join(", ")}.`,
    ),
    check(
      "RESUME_RECONCILIATION",
      !workflow?.resumeReconciliationRequired,
      "No résumé-parsed reconciliation gate is active.",
    ),
    check(
      "NEXT_UNAVAILABLE",
      workflow?.navigation.nextVisible === true,
      "The exact enabled Workday Next control is visible.",
    ),
    check(
      "SUBMIT_VISIBLE",
      workflow?.navigation.submitVisible === false,
      "No Submit control is available on this step.",
    ),
    check(
      "REVISIT_DETECTED",
      !analysis.workflowProgress?.revisitDetected,
      "This workflow step has not been revisited.",
    ),
    check(
      "ALREADY_DISPATCHED",
      !activeOrDispatched,
      "No navigation intent has already been dispatched for this page fingerprint.",
    ),
  ];
  const confidence = Math.min(analysis.ats.confidence, workflow?.navigation.nextConfidence ?? 0);
  return NavigationReadinessSchema.parse({
    ready: checks.every((item) => item.passed),
    confidence,
    checks,
  });
}

export function autoNextPanelState(
  analysisInput: ApplicationPageAnalysis,
  storeInput: AutoNextStore,
): AutoNextPanelState {
  const analysis = ApplicationPageAnalysisSchema.parse(analysisInput);
  const store = AutoNextStoreSchema.parse(storeInput);
  const related = store.intents.filter((intent) => intent.applicationId === analysis.applicationId);
  const activeIntent = related.find((intent) =>
    ["PREPARED", "CLICK_DISPATCHED", "VERIFYING"].includes(intent.state),
  );
  return AutoNextPanelStateSchema.parse({
    enabled: store.enabled,
    applicationOptedIn: analysis.applicationId
      ? store.applicationOptIns[analysis.applicationId] === true
      : false,
    controlledEnvironment: isControlledAutoNextUrl(analysis.snapshot.url),
    readiness: navigationReadiness({ analysis, store }),
    ...(activeIntent ? { activeIntent } : {}),
    ...(related.at(-1) ? { latestIntent: related.at(-1) } : {}),
  });
}

export function setAutoNextEnabled(storeInput: AutoNextStore, enabled: boolean): AutoNextStore {
  const store = AutoNextStoreSchema.parse(storeInput);
  return AutoNextStoreSchema.parse({ ...store, enabled });
}

export function setApplicationAutoNext(
  storeInput: AutoNextStore,
  applicationId: string,
  enabled: boolean,
): AutoNextStore {
  const store = AutoNextStoreSchema.parse(storeInput);
  return AutoNextStoreSchema.parse({
    ...store,
    applicationOptIns: { ...store.applicationOptIns, [applicationId]: enabled },
  });
}

export function prepareNavigationIntent(
  storeInput: AutoNextStore,
  analysisInput: ApplicationPageAnalysis,
  tabId: number,
  now = new Date().toISOString(),
): { store: AutoNextStore; intent: NavigationIntent; readiness: NavigationReadiness } {
  const store = AutoNextStoreSchema.parse(storeInput);
  const analysis = ApplicationPageAnalysisSchema.parse(analysisInput);
  const readiness = navigationReadiness({ analysis, store });
  if (!readiness.ready || !analysis.applicationId || !analysis.workflow) {
    throw new Error(
      readiness.checks.find((item) => !item.passed)?.message ??
        "This page is not ready for controlled navigation.",
    );
  }
  const intent = NavigationIntentSchema.parse({
    intentVersion: 1,
    id: `navigation-${crypto.randomUUID()}`,
    applicationId: analysis.applicationId,
    analysisId: analysis.analysisId,
    adapter: "WORKDAY",
    adapterVersion: analysis.ats.adapterVersion,
    tabId,
    sourceUrl: analysis.snapshot.url,
    sourcePageKey: analysis.workflow.pageKey,
    sourceFingerprint: analysis.workflow.fingerprint,
    sourceUserEditVersion: analysis.workflow.userEditVersion,
    targetToken: "WORKDAY_BOTTOM_NAVIGATION_NEXT",
    state: "PREPARED",
    createdAt: now,
    expiresAt: new Date(Date.parse(now) + INTENT_LIFETIME_MS).toISOString(),
  });
  return {
    intent,
    readiness,
    store: AutoNextStoreSchema.parse({
      ...store,
      intents: [...store.intents, intent].slice(-MAX_INTENTS),
      metrics: { ...store.metrics, prepared: store.metrics.prepared + 1 },
    }),
  };
}

export function transitionNavigationIntent(
  storeInput: AutoNextStore,
  intentId: string,
  state: NavigationIntent["state"],
  options: {
    now?: string;
    destinationPageKey?: string;
    failureCode?: NavigationBlockCode;
    message?: string;
  } = {},
): { store: AutoNextStore; intent: NavigationIntent } {
  const store = AutoNextStoreSchema.parse(storeInput);
  const selected = store.intents.find((intent) => intent.id === intentId);
  if (!selected) throw new Error("The navigation intent no longer exists.");
  const now = options.now ?? new Date().toISOString();
  const terminal = ["ADVANCED", "ABORTED", "MANUAL_REQUIRED", "FAILED"].includes(state);
  const intent = NavigationIntentSchema.parse({
    ...selected,
    state,
    ...(state === "CLICK_DISPATCHED" ? { clickDispatchedAt: now } : {}),
    ...(terminal ? { completedAt: now } : {}),
    ...(options.destinationPageKey ? { destinationPageKey: options.destinationPageKey } : {}),
    ...(options.failureCode ? { failureCode: options.failureCode } : {}),
    ...(options.message ? { message: options.message } : {}),
  });
  const metrics = { ...store.metrics };
  if (state === "ADVANCED") metrics.advanced += 1;
  if (state === "ABORTED") metrics.userAborts += 1;
  if (options.failureCode === "VALIDATION_ERROR") metrics.validationFailures += 1;
  if (options.failureCode === "REVISIT_DETECTED") metrics.navigationLoops += 1;
  if (options.failureCode === "TRANSITION_TIMEOUT") metrics.transitionTimeouts += 1;
  return {
    intent,
    store: AutoNextStoreSchema.parse({
      ...store,
      intents: store.intents.map((candidate) => (candidate.id === intent.id ? intent : candidate)),
      metrics,
    }),
  };
}

export function controlledNextPlan(intentInput: NavigationIntent): ControlledNextPlan {
  const intent = NavigationIntentSchema.parse(intentInput);
  if (intent.state !== "CLICK_DISPATCHED") {
    throw new Error("Only a persisted click-dispatched intent can reach the page executor.");
  }
  return ControlledNextPlanSchema.parse({
    intentId: intent.id,
    id: intent.id,
    applicationId: intent.applicationId,
    analysisId: intent.analysisId,
    adapter: intent.adapter,
    adapterVersion: intent.adapterVersion,
    sourceUrl: intent.sourceUrl,
    sourcePageKey: intent.sourcePageKey,
    sourceFingerprint: intent.sourceFingerprint,
    sourceUserEditVersion: intent.sourceUserEditVersion,
    targetToken: intent.targetToken,
    expiresAt: intent.expiresAt,
  });
}

export function workflowForControlledNavigation(input: unknown) {
  return WorkdayWorkflowPageSchema.parse(input);
}
