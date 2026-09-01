import { ApplicationPageAnalysisSchema, type ApplicationPageAnalysis } from "@copilot/job-schema";
import { z } from "zod";

const ISODateTimeSchema = z.iso.datetime({ offset: true });
const MAX_INTENTS = 100;
const INTENT_LIFETIME_MS = 45_000;
export const CONTROLLED_SUBMIT_CONFIDENCE = 0.995;

export const SubmissionIntentStateSchema = z.enum([
  "PREPARED",
  "SUBMIT_DISPATCHED",
  "VERIFYING",
  "CONFIRMED",
  "ABORTED",
  "FAILED",
]);

export const SubmissionBlockCodeSchema = z.enum([
  "FEATURE_DISABLED",
  "APPLICATION_NOT_OPTED_IN",
  "UNSUPPORTED_ADAPTER",
  "UNCONTROLLED_HOST",
  "REVIEW_PAGE_REQUIRED",
  "LOW_CONFIDENCE",
  "AUTH_BOUNDARY",
  "VALIDATION_ERROR",
  "REQUIRED_FIELD_EMPTY",
  "HIGH_RISK_REVIEW",
  "MANUAL_CONTROL",
  "RESUME_RECONCILIATION",
  "WORKFLOW_INCOMPLETE",
  "REVISIT_DETECTED",
  "SUBMIT_UNAVAILABLE",
  "NEXT_VISIBLE",
  "DUPLICATE_APPLICATION",
  "ALREADY_DISPATCHED",
  "EXPLICIT_CONSENT_REQUIRED",
  "INTENT_EXPIRED",
  "CONFIRMATION_TIMEOUT",
  "CONFIRMATION_MISMATCH",
]);

export const SubmissionReadinessSchema = z.object({
  ready: z.boolean(),
  confidence: z.number().min(0).max(1),
  checks: z.array(
    z.object({
      code: SubmissionBlockCodeSchema,
      passed: z.boolean(),
      message: z.string().min(1).max(1_000),
    }),
  ),
});

export const SubmissionIntentSchema = z.object({
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
  targetToken: z.literal("WORKDAY_TEST_ATS_SUBMIT"),
  state: SubmissionIntentStateSchema,
  consentedAt: ISODateTimeSchema,
  createdAt: ISODateTimeSchema,
  expiresAt: ISODateTimeSchema,
  submitDispatchedAt: ISODateTimeSchema.optional(),
  completedAt: ISODateTimeSchema.optional(),
  confirmationReferenceId: z.string().min(1).max(500).optional(),
  failureCode: SubmissionBlockCodeSchema.optional(),
  message: z.string().min(1).max(1_000).optional(),
});

export const SubmissionStoreSchema = z.object({
  storeVersion: z.literal(1),
  enabled: z.boolean(),
  applicationOptIns: z.record(z.string(), z.boolean()),
  intents: z.array(SubmissionIntentSchema).max(MAX_INTENTS),
  metrics: z.object({
    prepared: z.number().int().nonnegative(),
    dispatched: z.number().int().nonnegative(),
    confirmed: z.number().int().nonnegative(),
    userAborts: z.number().int().nonnegative(),
    validationFailures: z.number().int().nonnegative(),
    confirmationTimeouts: z.number().int().nonnegative(),
  }),
});

export const ControlledSubmitPlanSchema = SubmissionIntentSchema.pick({
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

export const ControlledSubmitClickResultSchema = z.object({
  intentId: z.string().min(1),
  clicked: z.literal(true),
  sourcePageKey: z.string().min(1),
  sourceFingerprint: z.string().regex(/^workday:[a-f0-9]{8}$/),
});

export const SubmissionPanelStateSchema = z.object({
  enabled: z.boolean(),
  applicationOptedIn: z.boolean(),
  controlledEnvironment: z.boolean(),
  readiness: SubmissionReadinessSchema,
  activeIntent: SubmissionIntentSchema.optional(),
  latestIntent: SubmissionIntentSchema.optional(),
});

export const SubmissionActionResultSchema = z.object({
  intent: SubmissionIntentSchema,
  panelState: SubmissionPanelStateSchema.optional(),
});

export type SubmissionBlockCode = z.infer<typeof SubmissionBlockCodeSchema>;
export type SubmissionReadiness = z.infer<typeof SubmissionReadinessSchema>;
export type SubmissionIntent = z.infer<typeof SubmissionIntentSchema>;
export type SubmissionStore = z.infer<typeof SubmissionStoreSchema>;
export type ControlledSubmitPlan = z.infer<typeof ControlledSubmitPlanSchema>;
export type SubmissionPanelState = z.infer<typeof SubmissionPanelStateSchema>;

export function createSubmissionStore(): SubmissionStore {
  return {
    storeVersion: 1,
    enabled: false,
    applicationOptIns: {},
    intents: [],
    metrics: {
      prepared: 0,
      dispatched: 0,
      confirmed: 0,
      userAborts: 0,
      validationFailures: 0,
      confirmationTimeouts: 0,
    },
  };
}

export function isControlledSubmissionUrl(value: string): boolean {
  const url = new URL(value);
  return (
    url.protocol === "http:" &&
    url.hostname === "127.0.0.1" &&
    url.port === "4173" &&
    url.pathname === "/workday.html"
  );
}

function resolvedValue(field: ApplicationPageAnalysis["snapshot"]["fields"][number]): boolean {
  return Boolean(
    field.valueState && ["PREFILLED", "COPILOT_FILLED", "USER_EDITED"].includes(field.valueState),
  );
}

function check(
  code: SubmissionBlockCode,
  passed: boolean,
  message: string,
): SubmissionReadiness["checks"][number] {
  return { code, passed, message };
}

export function submissionReadiness(input: {
  analysis: ApplicationPageAnalysis;
  store: SubmissionStore;
}): SubmissionReadiness {
  const analysis = ApplicationPageAnalysisSchema.parse(input.analysis);
  const store = SubmissionStoreSchema.parse(input.store);
  const workflow = analysis.workflow;
  const optedIn = analysis.applicationId
    ? store.applicationOptIns[analysis.applicationId] === true
    : false;
  const required = analysis.snapshot.fields.filter(
    (field) => field.required && !field.disabled && !resolvedValue(field),
  );
  const unresolvedHighRisk = analysis.customQuestions.filter(
    (question) =>
      (question.savedResponse.risk === "R3" || question.savedResponse.risk === "R4") &&
      !resolvedValue(question.field),
  );
  const unresolvedManual = analysis.customQuestions.filter(
    (question) => question.responseMode === "MANUAL" && !resolvedValue(question.field),
  );
  const expectedSteps = workflow?.stepCount ?? analysis.workflowProgress?.stepCount ?? 0;
  const observedSteps = analysis.workflowProgress?.observedPageKeys.length ?? 0;
  const requiredPageTypes = ["MY_INFORMATION", "MY_EXPERIENCE", "APPLICATION_QUESTIONS", "REVIEW"];
  const completeControlledWorkflow =
    expectedSteps === requiredPageTypes.length &&
    observedSteps >= expectedSteps &&
    requiredPageTypes.every((pageType) =>
      analysis.workflowProgress?.observedPageKeys.some((pageKey) =>
        pageKey.includes(`:${pageType}:`),
      ),
    );
  const externalDuplicate = analysis.duplicateWarnings.find(
    (warning) => warning.existingApplicationId !== analysis.applicationId,
  );
  const existingIntent = store.intents.find(
    (intent) =>
      intent.applicationId === analysis.applicationId &&
      intent.sourceFingerprint === workflow?.fingerprint &&
      ["PREPARED", "SUBMIT_DISPATCHED", "VERIFYING", "CONFIRMED"].includes(intent.state),
  );
  const checks: SubmissionReadiness["checks"] = [
    check("FEATURE_DISABLED", store.enabled, "Controlled Test ATS submission is enabled globally."),
    check(
      "APPLICATION_NOT_OPTED_IN",
      optedIn,
      "Controlled submission is enabled for this application only.",
    ),
    check(
      "UNSUPPORTED_ADAPTER",
      analysis.ats.adapter === "WORKDAY" && Boolean(workflow),
      "The active page uses the controlled Workday adapter.",
    ),
    check(
      "UNCONTROLLED_HOST",
      isControlledSubmissionUrl(analysis.snapshot.url) &&
        workflow?.navigation.mode === "CONTROLLED_TEST_ONLY",
      "The page is the exact local Workday Test ATS fixture.",
    ),
    check("REVIEW_PAGE_REQUIRED", workflow?.pageType === "REVIEW", "The active step is Review."),
    check(
      "LOW_CONFIDENCE",
      analysis.ats.confidence >= CONTROLLED_SUBMIT_CONFIDENCE &&
        (workflow?.navigation.submitConfidence ?? 0) >= CONTROLLED_SUBMIT_CONFIDENCE,
      `Detection and Submit evidence meet the ${CONTROLLED_SUBMIT_CONFIDENCE} threshold.`,
    ),
    check(
      "AUTH_BOUNDARY",
      workflow?.authBoundary === "NONE",
      "No authentication boundary is present.",
    ),
    check(
      "VALIDATION_ERROR",
      !workflow?.errorState,
      "No visible validation or session error is present.",
    ),
    check(
      "REQUIRED_FIELD_EMPTY",
      required.length === 0,
      required.length === 0
        ? "All visible required review controls are complete."
        : "A visible required review control still needs attention.",
    ),
    check(
      "HIGH_RISK_REVIEW",
      unresolvedHighRisk.length === 0,
      "No unresolved R3/R4 question remains.",
    ),
    check(
      "MANUAL_CONTROL",
      unresolvedManual.length === 0,
      "No unresolved manual-only control remains.",
    ),
    check(
      "RESUME_RECONCILIATION",
      !workflow?.resumeReconciliationRequired,
      "No résumé reconciliation gate is active.",
    ),
    check(
      "WORKFLOW_INCOMPLETE",
      completeControlledWorkflow,
      completeControlledWorkflow
        ? `All ${expectedSteps} workflow steps were observed.`
        : "My Information, My Experience, Application Questions, and Review must each be scanned before submission.",
    ),
    check(
      "REVISIT_DETECTED",
      !analysis.workflowProgress?.revisitDetected,
      "No workflow loop or revisit is active.",
    ),
    check(
      "SUBMIT_UNAVAILABLE",
      workflow?.navigation.submitVisible === true,
      "The exact enabled Test ATS Submit control is visible.",
    ),
    check(
      "NEXT_VISIBLE",
      workflow?.navigation.nextVisible === false,
      "No Next control is visible on Review.",
    ),
    check(
      "DUPLICATE_APPLICATION",
      !externalDuplicate,
      "No different tracked application conflicts with this job.",
    ),
    check(
      "ALREADY_DISPATCHED",
      !existingIntent,
      "No submission was already dispatched for this review page.",
    ),
  ];
  return SubmissionReadinessSchema.parse({
    ready: checks.every((item) => item.passed),
    confidence: Math.min(analysis.ats.confidence, workflow?.navigation.submitConfidence ?? 0),
    checks,
  });
}

export function submissionPanelState(
  analysisInput: ApplicationPageAnalysis,
  storeInput: SubmissionStore,
): SubmissionPanelState {
  const analysis = ApplicationPageAnalysisSchema.parse(analysisInput);
  const store = SubmissionStoreSchema.parse(storeInput);
  const related = store.intents.filter((intent) => intent.applicationId === analysis.applicationId);
  const activeIntent = related.find((intent) =>
    ["PREPARED", "SUBMIT_DISPATCHED", "VERIFYING"].includes(intent.state),
  );
  const latestIntent = related[related.length - 1];
  return SubmissionPanelStateSchema.parse({
    enabled: store.enabled,
    applicationOptedIn: analysis.applicationId
      ? store.applicationOptIns[analysis.applicationId] === true
      : false,
    controlledEnvironment: isControlledSubmissionUrl(analysis.snapshot.url),
    readiness: submissionReadiness({ analysis, store }),
    ...(activeIntent ? { activeIntent } : {}),
    ...(latestIntent ? { latestIntent } : {}),
  });
}

export function setSubmissionEnabled(
  storeInput: SubmissionStore,
  enabled: boolean,
): SubmissionStore {
  return SubmissionStoreSchema.parse({ ...SubmissionStoreSchema.parse(storeInput), enabled });
}

export function setApplicationSubmission(
  storeInput: SubmissionStore,
  applicationId: string,
  enabled: boolean,
): SubmissionStore {
  const store = SubmissionStoreSchema.parse(storeInput);
  return SubmissionStoreSchema.parse({
    ...store,
    applicationOptIns: { ...store.applicationOptIns, [applicationId]: enabled },
  });
}

export function prepareSubmissionIntent(
  storeInput: SubmissionStore,
  analysisInput: ApplicationPageAnalysis,
  tabId: number,
  explicitConsent: boolean,
  now = new Date().toISOString(),
): { store: SubmissionStore; intent: SubmissionIntent; readiness: SubmissionReadiness } {
  if (!explicitConsent) throw new Error("Explicit final submission consent is required.");
  const store = SubmissionStoreSchema.parse(storeInput);
  const analysis = ApplicationPageAnalysisSchema.parse(analysisInput);
  const readiness = submissionReadiness({ analysis, store });
  if (!readiness.ready || !analysis.applicationId || !analysis.workflow) {
    throw new Error(
      readiness.checks.find((item) => !item.passed)?.message ??
        "This review page is not ready for controlled submission.",
    );
  }
  const intent = SubmissionIntentSchema.parse({
    intentVersion: 1,
    id: `submission-${crypto.randomUUID()}`,
    applicationId: analysis.applicationId,
    analysisId: analysis.analysisId,
    adapter: "WORKDAY",
    adapterVersion: analysis.ats.adapterVersion,
    tabId,
    sourceUrl: analysis.snapshot.url,
    sourcePageKey: analysis.workflow.pageKey,
    sourceFingerprint: analysis.workflow.fingerprint,
    sourceUserEditVersion: analysis.workflow.userEditVersion,
    targetToken: "WORKDAY_TEST_ATS_SUBMIT",
    state: "PREPARED",
    consentedAt: now,
    createdAt: now,
    expiresAt: new Date(Date.parse(now) + INTENT_LIFETIME_MS).toISOString(),
  });
  return {
    intent,
    readiness,
    store: SubmissionStoreSchema.parse({
      ...store,
      intents: [...store.intents, intent].slice(-MAX_INTENTS),
      metrics: { ...store.metrics, prepared: store.metrics.prepared + 1 },
    }),
  };
}

export function transitionSubmissionIntent(
  storeInput: SubmissionStore,
  intentId: string,
  state: SubmissionIntent["state"],
  options: {
    now?: string;
    failureCode?: SubmissionBlockCode;
    message?: string;
    confirmationReferenceId?: string;
  } = {},
): { store: SubmissionStore; intent: SubmissionIntent } {
  const store = SubmissionStoreSchema.parse(storeInput);
  const selected = store.intents.find((intent) => intent.id === intentId);
  if (!selected) throw new Error("The submission intent no longer exists.");
  const now = options.now ?? new Date().toISOString();
  const terminal = ["CONFIRMED", "ABORTED", "FAILED"].includes(state);
  const intent = SubmissionIntentSchema.parse({
    ...selected,
    state,
    ...(state === "SUBMIT_DISPATCHED" ? { submitDispatchedAt: now } : {}),
    ...(terminal ? { completedAt: now } : {}),
    ...(options.failureCode ? { failureCode: options.failureCode } : {}),
    ...(options.message ? { message: options.message } : {}),
    ...(options.confirmationReferenceId
      ? { confirmationReferenceId: options.confirmationReferenceId }
      : {}),
  });
  const metrics = { ...store.metrics };
  if (state === "SUBMIT_DISPATCHED") metrics.dispatched += 1;
  if (state === "CONFIRMED") metrics.confirmed += 1;
  if (state === "ABORTED") metrics.userAborts += 1;
  if (options.failureCode === "VALIDATION_ERROR") metrics.validationFailures += 1;
  if (options.failureCode === "CONFIRMATION_TIMEOUT") metrics.confirmationTimeouts += 1;
  return {
    intent,
    store: SubmissionStoreSchema.parse({
      ...store,
      intents: store.intents.map((candidate) => (candidate.id === intent.id ? intent : candidate)),
      metrics,
    }),
  };
}

export function controlledSubmitPlan(intentInput: SubmissionIntent): ControlledSubmitPlan {
  const intent = SubmissionIntentSchema.parse(intentInput);
  if (intent.state !== "SUBMIT_DISPATCHED") {
    throw new Error("Only a persisted submit-dispatched intent can reach the page executor.");
  }
  return ControlledSubmitPlanSchema.parse({
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
