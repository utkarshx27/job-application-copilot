import {
  ContentRequestSchema,
  PanelRequestSchema,
  RuntimeResponseSchema,
  type RuntimeResponse,
  type PanelRequest,
} from "@copilot/browser-command-schema";
import {
  AiGenerativeQuestionSchema,
  createFixtureProvider,
  createOpenAiProvider,
  type AiProvider,
  type AiTaskRequest,
} from "@copilot/ai-gateway";
import { policyForUrl } from "@copilot/shared";
import { analyzeForm, classifyField } from "@copilot/form-engine";
import {
  exportTrackerCsv,
  findDuplicateWarnings,
  importTrackerCsv,
  recordApplying,
  recordConfirmation,
  recordResumeUpload,
  recordWorkdayWorkflow,
  updateApplicationStatus,
} from "@copilot/application-state";
import {
  FillPlanSchema,
  FillResultSchema,
  HighlightResultSchema,
  FieldMappingSchema,
} from "@copilot/form-schema";
import { draftGroundedAnswer } from "@copilot/grounded-generation";
import {
  ApplicationPageAnalysisSchema,
  ApplicationTrackerSchema,
  ApprovedUploadPlanSchema,
  InspectedApplicationPageSchema,
  UploadResultSchema,
  type ApplicationPageAnalysis,
  type CustomQuestion,
  type ReviewedCustomAnswer,
} from "@copilot/job-schema";
import {
  AutoNextActionResultSchema,
  ControlledNextClickResultSchema,
  autoNextPanelState,
  controlledNextPlan,
  prepareNavigationIntent,
  setApplicationAutoNext,
  setAutoNextEnabled,
  transitionNavigationIntent,
  type NavigationIntent,
} from "@copilot/navigation-core";
import {
  ControlledSubmitClickResultSchema,
  SubmissionActionResultSchema,
  controlledSubmitPlan,
  prepareSubmissionIntent,
  setApplicationSubmission,
  setSubmissionEnabled,
  submissionPanelState,
  transitionSubmissionIntent,
  type SubmissionIntent,
  type SubmissionStore,
} from "@copilot/submission-core";
import {
  exportProfileBackup,
  importResumeDraft,
  importProfileBackup,
  resolveProfileConflict,
  saveProfileDraft,
  saveCareerSetup,
  saveProfileResponses,
  verifyImportedFacts,
} from "@copilot/profile-core";
import { classifyQuestion } from "@copilot/question-ontology";
import {
  createSavedResponse,
  matchSavedResponse,
  type SavedResponseContext,
} from "@copilot/saved-response-engine";

import { getProfileVault, setProfileVault } from "./profile-storage";
import { resolveActiveTab } from "./active-tab";
import { getSubmissionStore, setSubmissionStore } from "./submission-storage";
import { getApplicationTracker, setApplicationTracker } from "./application-storage";
import { adapterForId } from "./ats-page";
import {
  aiConfigStatus,
  clearAiSessionConfig,
  getAiSessionConfig,
  setAiSessionConfig,
} from "./ai-storage";
import {
  deleteOptionalSyncAccount,
  disableOptionalSync,
  exportEncryptedSyncBackup,
  getOptionalSyncStatus,
  listSyncDevices,
  lockOptionalSync,
  loginOptionalSync,
  registerOptionalSync,
  revokeSyncDevice,
  runOptionalSync,
} from "./sync-client";
import { getAutoNextStore, setAutoNextStore } from "./navigation-storage";
import { AgentLabController, observeAgentTab, agentLabErrorMessage } from "./agent-controller";
import { AgentRepository } from "./agent-storage";
import { AGENT_LAB_AVAILABLE } from "./agent-config";
import { parseNarrativeIntake } from "@copilot/resume-parser";
import { AGENT_EXECUTION_URL } from "@copilot/agent-core";
import { AgentExecutionController } from "./agent-execution-controller";
import { ExecutionTransport } from "./agent-execution-transport";
import { captureLocalExecution } from "./agent-execution-visual";
import { DiscoveryController } from "./discovery-controller";
import { JobPreparationController } from "./job-preparation-controller";
const discovery = new DiscoveryController();
const jobPreparation = new JobPreparationController(discovery, async (record) => {
  const pending = profileQueue.then(async () => {
    if (memoryOwnerKey(memoryOwner(await getProfileVault())) !== memoryOwnerKey(record.owner))
      throw new Error("Profile changed before tracker update.");
    const at = new Date(record.createdAt).toISOString();
    const analysis = ApplicationPageAnalysisSchema.parse({
      analysisVersion: 1,
      analysisId: record.id,
      applicationId: `local-preparation:${record.id}`,
      mappings: [],
      customQuestions: [],
      duplicateWarnings: [],
      snapshot: {
        schemaVersion: 1,
        url: record.job.applicationUrl,
        title: record.job.title,
        capturedAt: at,
        fields: [],
      },
      ats: {
        adapter: "GENERIC",
        adapterVersion: "local-native-preparation-v1",
        confidence: 1,
        supported: true,
        evidence: ["Approved native local first-screen preparation"],
      },
      job: {
        schemaVersion: 1,
        id: record.job.sourceJobId,
        externalRequisitionId: record.job.sourceJobId,
        ats: "GENERIC",
        title: record.job.title,
        company: record.job.company,
        location: record.job.location,
        description: "Local first screen prepared; not submitted.",
        sourceUrl: record.job.sourceUrl,
        applicationUrl: record.job.applicationUrl,
        snapshotAt: at,
      },
      confirmation: { confirmed: false, evidence: [] },
    });
    await setApplicationTracker(
      recordApplying(await getApplicationTracker(), analysis, record.owner.profileRevision, at),
    );
  });
  profileQueue = pending.catch(() => undefined);
  await pending;
});
import { MemoryRepository, memoryOwner, memoryScope, correctedMapping } from "./feedback-memory";
import {
  sameMemoryOwner,
  memoryOwnerKey,
  captureWorkflow,
  changeWorkflow,
  retrieveWorkflow,
} from "@copilot/agent-core";

const memory = new MemoryRepository();
async function handleMemoryRequest(request: PanelRequest): Promise<RuntimeResponse> {
  const vault = await getProfileVault();
  const owner = memoryOwner(vault);
  const now = Date.now();
  if (request.type === "PANEL_WORKFLOW_CAPTURE" || request.type === "PANEL_WORKFLOW_CHANGE") {
    const run = request.runId
      ? (await executionRepository.read()).runs.find((entry) => entry.id === request.runId)
      : undefined;
    if (request.type === "PANEL_WORKFLOW_CAPTURE") {
      if (!run) throw new Error("Select a completed local preparation.");
      await memory.transact((store) => captureWorkflow(store, owner, run, now));
    } else
      await memory.transact((store) =>
        changeWorkflow(store, owner, request.id, request.revision, request.action, now, run),
      );
  } else if (request.type === "PANEL_MEMORY_CORRECT") {
    const tab = await inspectableActiveTab();
    if ("ok" in tab) return tab;
    const analysis = analysesByTab.get(tab.id);
    if (
      !analysis ||
      analysis.analysisId !== request.analysisId ||
      analysis.snapshot.url !== tab.url ||
      new URL(tab.url).origin !== "http://127.0.0.1:4173" ||
      now - Date.parse(analysis.snapshot.capturedAt) > 300_000
    )
      throw new Error("Scan the local test form again before teaching a correction.");
    const field = analysis.snapshot.fields.find((entry) => entry.fieldId === request.fieldId);
    const mapping = analysis.mappings.find((entry) => entry.fieldId === request.fieldId);
    if (!field || !mapping) throw new Error("The field is no longer available.");
    const scope = memoryScope(analysis, field);
    if (
      /consent|agree|citizenship|authorization|sponsor|disability|gender|veteran|password|social security/i.test(
        `${scope.question} ${scope.group}`,
      )
    )
      throw new Error("Sensitive questions require the existing manual answer workflow.");
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(scope)),
    );
    await memory.save(
      {
        id: crypto.randomUUID(),
        revision: 1,
        kind: "FIELD_MEANING",
        owner,
        scope,
        rejected: mapping.canonicalQuestion,
        accepted: request.accepted,
        confirmed: true,
        observationHash: Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 90 * 86400_000,
      },
      0,
    );
    analysesByTab.clear();
  } else if (request.type === "PANEL_MEMORY_EDIT") {
    const record = (await memory.transact()).corrections.find(
      (entry) => entry.id === request.id && sameMemoryOwner(entry.owner, owner),
    );
    if (!record) throw new Error("Correction unavailable for this profile.");
    await memory.save(
      {
        ...record,
        owner,
        accepted: request.accepted,
        updatedAt: now,
        expiresAt: now + 90 * 86400_000,
      },
      request.revision,
    );
    analysesByTab.clear();
  } else if (request.type === "PANEL_MEMORY_FORGET") {
    await memory.forget(owner, request.id, request.revision);
    analysesByTab.clear();
  } else if (request.type !== "PANEL_MEMORY_GET") throw new Error("Unknown memory command.");
  return { ok: true, data: await memory.view(owner) };
}

const executionRepository = new AgentRepository(indexedDB, "copilot-executor-v1");
const executionController = new AgentExecutionController(
  executionRepository,
  new ExecutionTransport(AGENT_LAB_AVAILABLE),
  AGENT_LAB_AVAILABLE,
  async () => (await getProfileVault()).currentProfile.profileVersion,
  async (run) => {
    const at = new Date(run.createdAt).toISOString();
    const analysis = ApplicationPageAnalysisSchema.parse({
      analysisVersion: 1,
      analysisId: run.id,
      applicationId: run.applicationId,
      mappings: [],
      customQuestions: [],
      duplicateWarnings: [],
      snapshot: {
        schemaVersion: 1,
        url: AGENT_EXECUTION_URL,
        title: "Synthetic execution demo",
        capturedAt: at,
        fields: [],
      },
      ats: {
        adapter: "GENERIC",
        adapterVersion: "agent-local-v1",
        confidence: 1,
        supported: true,
        evidence: ["Exact local execution fixture"],
      },
      job: {
        schemaVersion: 1,
        id: run.applicationId,
        ats: "GENERIC",
        title: "Synthetic demo — prepared, not submitted",
        company: "Local Test ATS (not a real employer)",
        description: "Synthetic AG-05 execution test.",
        sourceUrl: AGENT_EXECUTION_URL,
        applicationUrl: AGENT_EXECUTION_URL,
        snapshotAt: at,
      },
      confirmation: { confirmed: false, evidence: [] },
    });
    await setApplicationTracker(
      recordApplying(await getApplicationTracker(), analysis, run.binding.profileRevision, at),
    );
  },
  async () => memoryOwnerKey(memoryOwner(await getProfileVault())),
  async () =>
    retrieveWorkflow(await memory.transact(), memoryOwner(await getProfileVault()), Date.now()),
);

const agentLab = new AgentLabController(
  new AgentRepository(),
  {
    activeTab: async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id === undefined || !tab.url)
        throw new Error("Open the local Workday fixture in the active tab.");
      return { id: tab.id, url: tab.url };
    },
    observe: observeAgentTab,
    profileRevision: async () => (await getProfileVault()).currentProfile.profileVersion,
  },
  AGENT_LAB_AVAILABLE,
);

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
const analysesByTab = new Map<number, ApplicationPageAnalysis>();

type RuntimeErrorCode = Extract<RuntimeResponse, { ok: false }>["error"]["code"];

function failure(code: RuntimeErrorCode, message: string): Extract<RuntimeResponse, { ok: false }> {
  return { ok: false, error: { code, message } };
}

async function storeProfile(untrustedVault: unknown) {
  const stored = await setProfileVault(untrustedVault);
  analysesByTab.clear();
  return stored;
}

async function inspectableActiveTab(): Promise<
  { id: number; url: string } | Extract<RuntimeResponse, { ok: false }>
> {
  let tab;
  try {
    tab = await resolveActiveTab(
      () => chrome.tabs.query({ active: true, lastFocusedWindow: true }),
      async (tabId) => {
        const [probe] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => globalThis.location.href,
        });
        return typeof probe?.result === "string" ? probe.result : undefined;
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chrome denied access to this tab.";
    return failure("INJECTION_FAILED", message);
  }
  if (!tab) return failure("NO_ACTIVE_TAB", "No inspectable active tab was found.");

  let policy;
  try {
    policy = policyForUrl(tab.url);
  } catch {
    return failure("UNSUPPORTED_PAGE", "This page URL cannot be inspected.");
  }

  if (!policy.fillAllowed) {
    return failure("BLOCKED_BY_POLICY", policy.notes ?? "Automation is disabled on this site.");
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Content script injection failed.";
    return failure("INJECTION_FAILED", message);
  }

  return { id: tab.id, url: tab.url };
}

async function sendContentRequest(tabId: number, requestInput: unknown): Promise<RuntimeResponse> {
  const request = ContentRequestSchema.parse(requestInput);
  try {
    const untrustedResponse: unknown = await chrome.tabs.sendMessage(tabId, request);
    const response = RuntimeResponseSchema.safeParse(untrustedResponse);
    return response.success
      ? response.data
      : failure("SCAN_FAILED", "The page returned invalid extension data.");
  } catch (error) {
    return failure(
      "SCAN_FAILED",
      error instanceof Error ? error.message : "The visible form could not be inspected.",
    );
  }
}

async function scanActiveTab(): Promise<RuntimeResponse> {
  const tab = await inspectableActiveTab();
  if ("ok" in tab) return tab;
  return sendContentRequest(tab.id, { type: "CONTENT_SCAN_PAGE" });
}

function countryCodeForLocation(location: string | undefined): string | undefined {
  if (!location) return undefined;
  const trimmed = location.trim();
  if (/^(US|IN|CA|GB|AU|DE)$/i.test(trimmed)) return trimmed.toUpperCase();
  const normalized = trimmed.toLocaleLowerCase();
  const countries: Array<[RegExp, string]> = [
    [/\b(united states|usa|u\.s\.)\b/, "US"],
    [/\bindia\b/, "IN"],
    [/\bcanada\b/, "CA"],
    [/\b(united kingdom|u\.k\.)\b/, "GB"],
    [/\baustralia\b/, "AU"],
    [/\bgermany\b/, "DE"],
  ];
  return countries.find(([pattern]) => pattern.test(normalized))?.[1];
}

function savedResponseContext(
  applicationId: string | undefined,
  job: ApplicationPageAnalysis["job"],
  ats: string,
): SavedResponseContext {
  const countryCode = countryCodeForLocation(job?.location);
  return {
    ...(applicationId ? { applicationId } : {}),
    ...(job?.company ? { company: job.company } : {}),
    ...(job?.title ? { role: job.title } : {}),
    ...(countryCode ? { countryCode } : {}),
    ats,
  };
}

async function analyzeActiveTab(): Promise<RuntimeResponse> {
  const tab = await inspectableActiveTab();
  if ("ok" in tab) return tab;
  const response = await sendContentRequest(tab.id, { type: "CONTENT_INSPECT_APPLICATION" });
  if (!response.ok) return response;
  const inspected = InspectedApplicationPageSchema.safeParse(response.data);
  if (!inspected.success)
    return failure("SCAN_FAILED", "The page scan was not a valid application snapshot.");
  const vault = await getProfileVault();
  const adapter = adapterForId(inspected.data.atsReport.detection.adapter);
  const correctionStore =
    AGENT_LAB_AVAILABLE && new URL(tab.url).origin === "http://127.0.0.1:4173"
      ? await memory.transact()
      : null;
  const baseAnalysis = analyzeForm(
    inspected.data.snapshot,
    vault.currentProfile,
    crypto.randomUUID(),
    (field) => {
      const base = adapter?.classifyField(field) ?? classifyField(field);
      return correctionStore
        ? correctedMapping(
            base,
            field,
            correctionStore,
            memoryOwner(vault),
            memoryScope(
              { snapshot: inspected.data.snapshot, ats: inspected.data.atsReport.detection },
              field,
            ),
            vault.currentProfile,
          )
        : base;
    },
  );
  const job = inspected.data.atsReport.job;
  const applicationId = job ? `application:${job.id}` : undefined;
  const responseContext = savedResponseContext(
    applicationId,
    job,
    inspected.data.atsReport.detection.adapter,
  );
  const customQuestions: CustomQuestion[] = baseAnalysis.mappings.flatMap((mapping) => {
    const field = baseAnalysis.snapshot.fields.find(
      (candidate) => candidate.fieldId === mapping.fieldId,
    );
    const draftableMappedField = AiGenerativeQuestionSchema.safeParse(
      mapping.canonicalQuestion,
    ).success;
    const manualCustomControl = field?.controlKind === "other";
    if (
      !draftableMappedField &&
      !manualCustomControl &&
      (mapping.canonicalQuestion || mapping.tier !== "UNMAPPED")
    )
      return [];
    if (!field || field.controlKind === "file") return [];
    const label = field.accessibleName || field.labelText || field.name;
    if (!label) return [];
    const responseMode =
      field.controlKind === "select-one" || field.controlKind === "select-multiple"
        ? "SELECT"
        : field.controlKind === "text" ||
            field.controlKind === "email" ||
            field.controlKind === "tel" ||
            field.controlKind === "url" ||
            field.controlKind === "number" ||
            field.controlKind === "date" ||
            field.controlKind === "month" ||
            field.controlKind === "textarea"
          ? "TEXT"
          : "MANUAL";
    const classification = classifyQuestion(label);
    const savedResponse = matchSavedResponse(
      label,
      vault.currentProfile.answerLibrary,
      responseContext,
    );
    return [
      {
        field,
        label,
        required: field.required,
        responseMode,
        reviewReason: manualCustomControl
          ? "This custom ATS control is detected but requires manual completion on the page."
          : savedResponse.status === "MATCH"
            ? "A saved response matched, but you must review it before filling."
            : savedResponse.reason,
        classification,
        savedResponse,
      },
    ];
  });
  let analysis = ApplicationPageAnalysisSchema.parse({
    ...baseAnalysis,
    ...(applicationId ? { applicationId } : {}),
    ats: inspected.data.atsReport.detection,
    job,
    customQuestions,
    confirmation: inspected.data.atsReport.confirmation,
    workflow: inspected.data.atsReport.workflow,
  });
  if (analysis.applicationId && analysis.job) {
    const applicationId = analysis.applicationId;
    const previousTracker = await getApplicationTracker();
    const duplicateWarnings = findDuplicateWarnings(previousTracker, applicationId, analysis.job);
    analysis = ApplicationPageAnalysisSchema.parse({ ...analysis, duplicateWarnings });
    let tracker = recordApplying(previousTracker, analysis, vault.currentProfile.profileVersion);
    if (analysis.confirmation.confirmed) {
      tracker = recordConfirmation(tracker, applicationId, analysis.confirmation);
    }
    if (analysis.workflow) {
      tracker = recordWorkdayWorkflow(tracker, applicationId, analysis.workflow);
    }
    await setApplicationTracker(tracker);
    const progress = tracker.applications.find(
      (application) => application.id === applicationId,
    )?.workflowProgress;
    if (progress) {
      analysis = ApplicationPageAnalysisSchema.parse({ ...analysis, workflowProgress: progress });
    }
  }
  analysesByTab.set(tab.id, analysis);
  return { ok: true, data: analysis };
}

function operationForCustomAnswer(analysis: ApplicationPageAnalysis, answer: ReviewedCustomAnswer) {
  const question = analysis.customQuestions.find((item) => item.field.fieldId === answer.fieldId);
  if (!question || question.responseMode === "MANUAL") return null;
  if (question.responseMode === "SELECT") {
    const option = question.field.options.find(
      (candidate) =>
        !candidate.disabled &&
        (candidate.value === answer.value || candidate.text === answer.value),
    );
    return option ? { kind: "select" as const, value: option.value } : null;
  }
  return { kind: "text" as const, value: answer.value };
}

async function fillCustomAnswers(
  analysisId: string,
  answers: ReviewedCustomAnswer[],
): Promise<RuntimeResponse> {
  const tab = await inspectableActiveTab();
  if ("ok" in tab) return tab;
  const analysis = analysesByTab.get(tab.id);
  if (!analysis || analysis.analysisId !== analysisId)
    return failure("STALE_ANALYSIS", "Scan the form again before filling custom answers.");
  const unique = new Map(answers.map((answer) => [answer.fieldId, answer]));
  const items = [...unique.values()].flatMap((answer) => {
    const operation = operationForCustomAnswer(analysis, answer);
    return operation
      ? [
          {
            fieldId: answer.fieldId,
            canonicalQuestion: "APPLICATION.custom_answer" as const,
            operation,
          },
        ]
      : [];
  });
  if (items.length !== unique.size)
    return failure("FILL_FAILED", "One or more custom answers are no longer approved for fill.");
  const responsesToSave = [...unique.values()].flatMap((answer) => {
    if (!answer.saveScope) return [];
    const question = analysis.customQuestions.find((item) => item.field.fieldId === answer.fieldId);
    if (!question) return [];
    const selectedOption =
      question.responseMode === "SELECT"
        ? question.field.options.find(
            (option) => option.value === answer.value || option.text === answer.value,
          )
        : undefined;
    return [
      createSavedResponse({
        question: question.label,
        answer: selectedOption?.text ?? answer.value,
        reuseScope: answer.saveScope,
        context: savedResponseContext(analysis.applicationId, analysis.job, analysis.ats.adapter),
      }),
    ];
  });
  const response = await sendContentRequest(tab.id, {
    type: "CONTENT_APPLY_FILL",
    plan: FillPlanSchema.parse({ analysisId, items }),
  });
  if (!response.ok || responsesToSave.length === 0) return response;
  await storeProfile(saveProfileResponses(await getProfileVault(), responsesToSave));
  return response;
}

async function uploadApprovedResume(
  analysisId: string,
  fieldId: string,
  file: unknown,
): Promise<RuntimeResponse> {
  const tab = await inspectableActiveTab();
  if ("ok" in tab) return tab;
  const analysis = analysesByTab.get(tab.id);
  if (!analysis || analysis.analysisId !== analysisId)
    return failure("STALE_ANALYSIS", "Scan the form again before approving a résumé upload.");
  const field = analysis.snapshot.fields.find((candidate) => candidate.fieldId === fieldId);
  const mapping = analysis.mappings.find((candidate) => candidate.fieldId === fieldId);
  if (!field || field.controlKind !== "file" || mapping?.canonicalQuestion !== "APPLICATION.resume")
    return failure("UPLOAD_FAILED", "The selected field is not an approved résumé control.");
  const plan = ApprovedUploadPlanSchema.parse({
    approvalId: crypto.randomUUID(),
    analysisId,
    fieldId,
    expiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
    file,
  });
  const response = await sendContentRequest(tab.id, { type: "CONTENT_UPLOAD_APPROVED_FILE", plan });
  if (!response.ok) return response;
  const result = UploadResultSchema.safeParse(response.data);
  if (!result.success || !result.data.uploaded)
    return failure(
      "UPLOAD_FAILED",
      result.success ? (result.data.reason ?? "Upload failed.") : "Invalid upload result.",
    );
  if (analysis.applicationId) {
    const tracker = recordResumeUpload(
      await getApplicationTracker(),
      analysis.applicationId,
      result.data.fileName,
      result.data.sha256,
    );
    await setApplicationTracker(tracker);
  }
  return { ok: true, data: result.data };
}

async function reviewedAction(
  analysisId: string,
  fieldIds: string[],
  action: "highlight" | "fill",
): Promise<RuntimeResponse> {
  const tab = await inspectableActiveTab();
  if ("ok" in tab) return tab;
  const analysis = analysesByTab.get(tab.id);
  if (!analysis || analysis.analysisId !== analysisId) {
    return failure("STALE_ANALYSIS", "Scan the form again before taking this action.");
  }
  const uniqueFieldIds = [...new Set(fieldIds)];
  if (action === "highlight") {
    const response = await sendContentRequest(tab.id, {
      type: "CONTENT_HIGHLIGHT_FIELDS",
      fieldIds: uniqueFieldIds,
    });
    if (!response.ok) return response;
    const result = HighlightResultSchema.safeParse(response.data);
    return result.success
      ? { ok: true, data: result.data }
      : failure("FILL_FAILED", "The page returned an invalid highlight result.");
  }

  const requested = new Set(uniqueFieldIds);
  if (
    AGENT_LAB_AVAILABLE &&
    analysis.mappings.some(
      (mapping) =>
        requested.has(mapping.fieldId) &&
        mapping.evidence.some((entry) => entry.startsWith("memory:")),
    )
  ) {
    const vault = await getProfileVault();
    const store = await memory.transact();
    for (const mapping of analysis.mappings.filter((entry) => requested.has(entry.fieldId))) {
      if (!mapping.evidence.some((entry) => entry.startsWith("memory:"))) continue;
      const field = analysis.snapshot.fields.find((entry) => entry.fieldId === mapping.fieldId)!;
      const refreshed = correctedMapping(
        FieldMappingSchema.parse({
          fieldId: field.fieldId,
          canonicalQuestion: null,
          tier: "UNMAPPED",
          confidence: 0,
          evidence: [],
          fillable: false,
        }),
        field,
        store,
        memoryOwner(vault),
        memoryScope(analysis, field),
        vault.currentProfile,
      );
      if (
        refreshed.canonicalQuestion !== mapping.canonicalQuestion ||
        refreshed.evidence[0] !== mapping.evidence[0]
      )
        return failure(
          "STALE_ANALYSIS",
          "The correction changed or expired. Scan again before filling.",
        );
    }
  }
  const items = analysis.mappings.flatMap((mapping) =>
    requested.has(mapping.fieldId) &&
    mapping.fillable &&
    mapping.canonicalQuestion &&
    mapping.operation
      ? [
          {
            fieldId: mapping.fieldId,
            canonicalQuestion: mapping.canonicalQuestion,
            operation: mapping.operation,
          },
        ]
      : [],
  );
  if (items.length !== uniqueFieldIds.length) {
    return failure("FILL_FAILED", "One or more selected fields are no longer approved for fill.");
  }
  const plan = FillPlanSchema.parse({ analysisId, items });
  const response = await sendContentRequest(tab.id, { type: "CONTENT_APPLY_FILL", plan });
  if (!response.ok) return response;
  const result = FillResultSchema.safeParse(response.data);
  return result.success
    ? { ok: true, data: result.data }
    : failure("FILL_FAILED", "The page returned an invalid fill result.");
}

function fixtureAiProvider(): AiProvider {
  return createFixtureProvider((request: AiTaskRequest) => {
    if (request.task === "QUESTION_CLASSIFY") {
      return {
        task: "QUESTION_CLASSIFY",
        canonicalQuestion: "ESSAY.why_role",
        confidence: 0.99,
        reason: "Deterministic Phase 5 fixture classification.",
      };
    }
    const candidate = request.evidence.find((item) => item.source === "CANDIDATE");
    if (!candidate) throw new Error("The deterministic provider received no candidate evidence.");
    const fact = candidate.text.replace(/[.\s]+$/g, "");
    const answer = `My experience includes ${fact}.`;
    return {
      task: "FREE_TEXT_GENERATE",
      answer,
      evidenceIds: [candidate.id],
      claims: [{ text: answer, supportedBy: [candidate.id] }],
      unsupportedClaims: [],
    };
  });
}

async function configuredAiProvider(): Promise<AiProvider | RuntimeResponse> {
  const config = await getAiSessionConfig();
  if (!config)
    return failure(
      "AI_NOT_CONFIGURED",
      "Configure an AI provider for this browser session before requesting a draft.",
    );
  return config.provider === "OPENAI"
    ? createOpenAiProvider({ apiKey: config.apiKey, model: config.model })
    : fixtureAiProvider();
}

async function draftCustomAnswer(
  analysisId: string,
  fieldId: string,
  maxChars: number,
): Promise<RuntimeResponse> {
  const tab = await inspectableActiveTab();
  if ("ok" in tab) return tab;
  const analysis = analysesByTab.get(tab.id);
  if (!analysis || analysis.analysisId !== analysisId)
    return failure("STALE_ANALYSIS", "Scan the form again before requesting an AI draft.");
  const question = analysis.customQuestions.find((item) => item.field.fieldId === fieldId);
  if (
    !question ||
    question.responseMode !== "TEXT" ||
    (question.field.controlKind !== "text" && question.field.controlKind !== "textarea")
  )
    return failure(
      "AI_POLICY_BLOCKED",
      "AI drafting is available only for reviewable text questions.",
    );
  if (!analysis.job)
    return failure(
      "AI_POLICY_BLOCKED",
      "A detected job description is required for grounded drafting.",
    );
  const provider = await configuredAiProvider();
  if ("ok" in provider) return provider;
  const vault = await getProfileVault();
  const result = await draftGroundedAnswer({
    provider,
    profile: vault.currentProfile,
    job: analysis.job,
    question: question.label,
    controlKind: question.field.controlKind,
    maxChars,
  });
  return { ok: true, data: result };
}

async function activeNavigationContext(analysisId: string) {
  const tab = await inspectableActiveTab();
  if ("error" in tab) throw new Error(tab.error.message);
  const analysis = analysesByTab.get(tab.id);
  if (!analysis || analysis.analysisId !== analysisId) {
    throw new Error("Scan the current Workday step again before using controlled auto-next.");
  }
  return { tab, analysis };
}

async function autoNextStatus(analysisId: string) {
  const { analysis } = await activeNavigationContext(analysisId);
  return autoNextPanelState(analysis, await getAutoNextStore());
}

async function setAutoNextFeature(analysisId: string, enabled: boolean) {
  const { analysis } = await activeNavigationContext(analysisId);
  let store = setAutoNextEnabled(await getAutoNextStore(), enabled);
  if (!enabled) {
    const prepared = store.intents.filter((intent) => intent.state === "PREPARED");
    for (const intent of prepared) {
      store = transitionNavigationIntent(store, intent.id, "ABORTED", {
        message: "The experimental auto-next flag was disabled.",
      }).store;
    }
  }
  await setAutoNextStore(store);
  return autoNextPanelState(analysis, store);
}

async function setApplicationAutoNextFeature(analysisId: string, enabled: boolean) {
  const { analysis } = await activeNavigationContext(analysisId);
  if (!analysis.applicationId) throw new Error("The application does not have a stable identity.");
  let store = setApplicationAutoNext(await getAutoNextStore(), analysis.applicationId, enabled);
  if (!enabled) {
    const prepared = store.intents.filter(
      (intent) => intent.applicationId === analysis.applicationId && intent.state === "PREPARED",
    );
    for (const intent of prepared) {
      store = transitionNavigationIntent(store, intent.id, "ABORTED", {
        message: "Auto-next was disabled for this application.",
      }).store;
    }
  }
  await setAutoNextStore(store);
  return autoNextPanelState(analysis, store);
}

async function prepareAutoNext(analysisId: string) {
  const { tab, analysis } = await activeNavigationContext(analysisId);
  const prepared = prepareNavigationIntent(await getAutoNextStore(), analysis, tab.id);
  await setAutoNextStore(prepared.store);
  return AutoNextActionResultSchema.parse({
    intent: prepared.intent,
    panelState: autoNextPanelState(analysis, prepared.store),
  });
}

async function abortAutoNext(intentId: string) {
  const store = await getAutoNextStore();
  const selected = store.intents.find((intent) => intent.id === intentId);
  if (!selected || selected.state !== "PREPARED") {
    throw new Error("Only a prepared, not-yet-clicked navigation can be canceled.");
  }
  const result = transitionNavigationIntent(store, intentId, "ABORTED", {
    message: "Canceled by the user during the countdown.",
  });
  await setAutoNextStore(result.store);
  const analysis = analysesByTab.get(selected.tabId);
  if (!analysis) throw new Error("The application tab is no longer active.");
  return AutoNextActionResultSchema.parse({
    intent: result.intent,
    panelState: autoNextPanelState(analysis, result.store),
  });
}

function workflowChanged(
  intent: NavigationIntent,
  workflow: NonNullable<ApplicationPageAnalysis["workflow"]> | null,
): boolean {
  return Boolean(
    workflow &&
    (workflow.pageKey !== intent.sourcePageKey ||
      workflow.fingerprint !== intent.sourceFingerprint),
  );
}

async function waitForWorkdayTransition(tabId: number, intent: NavigationIntent) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await sendContentRequest(tabId, { type: "CONTENT_INSPECT_APPLICATION" });
    if (response.ok) {
      const inspected = InspectedApplicationPageSchema.safeParse(response.data);
      if (inspected.success && workflowChanged(intent, inspected.data.atsReport.workflow)) {
        return inspected.data.atsReport.workflow;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

async function executeAutoNext(intentId: string) {
  let store = await getAutoNextStore();
  const selected = store.intents.find((intent) => intent.id === intentId);
  if (!selected || selected.state !== "PREPARED") {
    throw new Error("This navigation intent is not prepared or was already dispatched.");
  }
  if (Date.parse(selected.expiresAt) <= Date.now()) {
    const expired = transitionNavigationIntent(store, intentId, "FAILED", {
      failureCode: "INTENT_EXPIRED",
      message: "The countdown approval expired before the click.",
    });
    await setAutoNextStore(expired.store);
    throw new Error(expired.intent.message ?? "The countdown approval expired.");
  }
  if (!store.enabled || store.applicationOptIns[selected.applicationId] !== true) {
    throw new Error("Auto-next was disabled after this navigation was prepared.");
  }
  const tab = await inspectableActiveTab();
  if ("error" in tab) throw new Error(tab.error.message);
  const analysis = analysesByTab.get(tab.id);
  if (
    tab.id !== selected.tabId ||
    tab.url !== selected.sourceUrl ||
    !analysis ||
    analysis.analysisId !== selected.analysisId ||
    !analysis.workflow ||
    analysis.workflow.pageKey !== selected.sourcePageKey ||
    analysis.workflow.fingerprint !== selected.sourceFingerprint
  ) {
    throw new Error("The active page changed after auto-next was prepared. Scan it again.");
  }

  const dispatched = transitionNavigationIntent(store, intentId, "CLICK_DISPATCHED");
  store = await setAutoNextStore(dispatched.store);
  const clickResponse = await sendContentRequest(tab.id, {
    type: "CONTENT_EXECUTE_CONTROLLED_NEXT",
    plan: controlledNextPlan(dispatched.intent),
  });
  if (!clickResponse.ok) {
    const failed = transitionNavigationIntent(store, intentId, "FAILED", {
      failureCode: "VALIDATION_ERROR",
      message: clickResponse.error.message,
    });
    await setAutoNextStore(failed.store);
    throw new Error(clickResponse.error.message);
  }
  const clicked = ControlledNextClickResultSchema.parse(clickResponse.data);
  const verifying = transitionNavigationIntent(store, intentId, "VERIFYING");
  store = await setAutoNextStore(verifying.store);
  const immediateChanged =
    clicked.observedPageKey !== selected.sourcePageKey ||
    clicked.observedFingerprint !== selected.sourceFingerprint;
  const destination = immediateChanged
    ? clicked.observedPageKey
    : (await waitForWorkdayTransition(tab.id, selected))?.pageKey;
  if (!destination) {
    const failed = transitionNavigationIntent(store, intentId, "FAILED", {
      failureCode: "TRANSITION_TIMEOUT",
      message:
        "Next was clicked once, but no verified page transition appeared. Continue manually; the copilot will not retry.",
    });
    await setAutoNextStore(failed.store);
    throw new Error(failed.intent.message ?? "The page transition could not be verified.");
  }
  const advanced = transitionNavigationIntent(store, intentId, "ADVANCED", {
    destinationPageKey: destination,
    message: "One controlled Next transition was verified.",
  });
  await setAutoNextStore(advanced.store);
  const refreshed = await analyzeActiveTab();
  const nextAnalysis =
    refreshed.ok && ApplicationPageAnalysisSchema.safeParse(refreshed.data).success
      ? ApplicationPageAnalysisSchema.parse(refreshed.data)
      : analysis;
  return AutoNextActionResultSchema.parse({
    intent: advanced.intent,
    panelState: autoNextPanelState(nextAnalysis, advanced.store),
  });
}

async function activeSubmissionContext(analysisId: string) {
  const tab = await inspectableActiveTab();
  if ("error" in tab) throw new Error(tab.error.message);
  const analysis = analysesByTab.get(tab.id);
  if (!analysis || analysis.analysisId !== analysisId) {
    throw new Error("Scan the current Test ATS review step again before controlled submission.");
  }
  return { tab, analysis };
}

async function submissionStatus(analysisId: string) {
  const { analysis } = await activeSubmissionContext(analysisId);
  return submissionPanelState(analysis, await getSubmissionStore());
}

async function setSubmissionFeature(analysisId: string, enabled: boolean) {
  const { analysis } = await activeSubmissionContext(analysisId);
  let store = setSubmissionEnabled(await getSubmissionStore(), enabled);
  if (!enabled) {
    for (const intent of store.intents.filter((candidate) => candidate.state === "PREPARED")) {
      store = transitionSubmissionIntent(store, intent.id, "ABORTED", {
        message: "Controlled submission was disabled before dispatch.",
      }).store;
    }
  }
  await setSubmissionStore(store);
  return submissionPanelState(analysis, store);
}

async function setApplicationSubmissionFeature(analysisId: string, enabled: boolean) {
  const { analysis } = await activeSubmissionContext(analysisId);
  if (!analysis.applicationId) throw new Error("The application does not have a stable identity.");
  let store = setApplicationSubmission(await getSubmissionStore(), analysis.applicationId, enabled);
  if (!enabled) {
    for (const intent of store.intents.filter(
      (candidate) =>
        candidate.applicationId === analysis.applicationId && candidate.state === "PREPARED",
    )) {
      store = transitionSubmissionIntent(store, intent.id, "ABORTED", {
        message: "Controlled submission was disabled for this application.",
      }).store;
    }
  }
  await setSubmissionStore(store);
  return submissionPanelState(analysis, store);
}

async function prepareControlledSubmission(analysisId: string, explicitConsent: true) {
  const { tab, analysis } = await activeSubmissionContext(analysisId);
  const prepared = prepareSubmissionIntent(
    await getSubmissionStore(),
    analysis,
    tab.id,
    explicitConsent,
  );
  await setSubmissionStore(prepared.store);
  return SubmissionActionResultSchema.parse({
    intent: prepared.intent,
    panelState: submissionPanelState(analysis, prepared.store),
  });
}

async function abortControlledSubmission(intentId: string) {
  const store = await getSubmissionStore();
  const selected = store.intents.find((intent) => intent.id === intentId);
  if (!selected || selected.state !== "PREPARED") {
    throw new Error("Only a prepared, not-yet-dispatched submission can be canceled.");
  }
  const result = transitionSubmissionIntent(store, intentId, "ABORTED", {
    message: "Canceled by the user during the final countdown.",
  });
  await setSubmissionStore(result.store);
  const analysis = analysesByTab.get(selected.tabId);
  return SubmissionActionResultSchema.parse({
    intent: result.intent,
    ...(analysis ? { panelState: submissionPanelState(analysis, result.store) } : {}),
  });
}

async function waitForControlledConfirmation(tabId: number, intent: SubmissionIntent) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await sendContentRequest(tabId, { type: "CONTENT_INSPECT_APPLICATION" });
    if (response.ok) {
      const inspected = InspectedApplicationPageSchema.safeParse(response.data);
      if (inspected.success && inspected.data.atsReport.confirmation.confirmed) {
        const observedApplicationId = inspected.data.atsReport.job
          ? `application:${inspected.data.atsReport.job.id}`
          : null;
        return {
          matches: observedApplicationId === intent.applicationId,
          confirmation: inspected.data.atsReport.confirmation,
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

async function failPreparedSubmission(store: SubmissionStore, intentId: string, message: string) {
  const failed = transitionSubmissionIntent(store, intentId, "FAILED", {
    failureCode: "VALIDATION_ERROR",
    message,
  });
  await setSubmissionStore(failed.store);
  return failed.intent;
}

async function executeControlledSubmission(intentId: string) {
  let store = await getSubmissionStore();
  const selected = store.intents.find((intent) => intent.id === intentId);
  if (!selected || selected.state !== "PREPARED") {
    throw new Error("This submission intent is not prepared or was already dispatched.");
  }
  if (Date.parse(selected.expiresAt) <= Date.now()) {
    const expired = transitionSubmissionIntent(store, intentId, "FAILED", {
      failureCode: "INTENT_EXPIRED",
      message: "The final submission approval expired before dispatch.",
    });
    await setSubmissionStore(expired.store);
    throw new Error(expired.intent.message ?? "The final submission approval expired.");
  }
  if (!store.enabled || store.applicationOptIns[selected.applicationId] !== true) {
    const failed = await failPreparedSubmission(
      store,
      intentId,
      "Controlled submission was disabled after final approval.",
    );
    throw new Error(failed.message);
  }
  const tab = await inspectableActiveTab();
  if ("error" in tab) {
    const failed = await failPreparedSubmission(store, intentId, tab.error.message);
    throw new Error(failed.message);
  }
  const analysis = analysesByTab.get(tab.id);
  if (
    tab.id !== selected.tabId ||
    tab.url !== selected.sourceUrl ||
    !analysis ||
    analysis.analysisId !== selected.analysisId ||
    !analysis.workflow ||
    analysis.workflow.pageKey !== selected.sourcePageKey ||
    analysis.workflow.fingerprint !== selected.sourceFingerprint ||
    analysis.workflow.userEditVersion !== selected.sourceUserEditVersion
  ) {
    const failed = await failPreparedSubmission(
      store,
      intentId,
      "The review page changed after final submission approval. Scan it again.",
    );
    throw new Error(failed.message);
  }

  const preflightResponse = await sendContentRequest(tab.id, {
    type: "CONTENT_INSPECT_APPLICATION",
  });
  const preflight = preflightResponse.ok
    ? InspectedApplicationPageSchema.safeParse(preflightResponse.data)
    : null;
  const currentWorkflow = preflight?.success ? preflight.data.atsReport.workflow : null;
  const currentApplicationId =
    preflight?.success && preflight.data.atsReport.job
      ? `application:${preflight.data.atsReport.job.id}`
      : null;
  if (
    !preflightResponse.ok ||
    !preflight?.success ||
    preflight.data.snapshot.url !== selected.sourceUrl ||
    currentApplicationId !== selected.applicationId ||
    !currentWorkflow ||
    currentWorkflow.pageKey !== selected.sourcePageKey ||
    currentWorkflow.fingerprint !== selected.sourceFingerprint ||
    currentWorkflow.userEditVersion !== selected.sourceUserEditVersion
  ) {
    const failed = await failPreparedSubmission(
      store,
      intentId,
      "The review page changed after final submission approval. Scan it again.",
    );
    throw new Error(failed.message);
  }

  const dispatched = transitionSubmissionIntent(store, intentId, "SUBMIT_DISPATCHED");
  store = await setSubmissionStore(dispatched.store);
  const clickResponse = await sendContentRequest(tab.id, {
    type: "CONTENT_EXECUTE_CONTROLLED_SUBMIT",
    plan: controlledSubmitPlan(dispatched.intent),
  });
  if (!clickResponse.ok) {
    const failed = transitionSubmissionIntent(store, intentId, "FAILED", {
      failureCode: "VALIDATION_ERROR",
      message: clickResponse.error.message,
    });
    await setSubmissionStore(failed.store);
    throw new Error(clickResponse.error.message);
  }
  ControlledSubmitClickResultSchema.parse(clickResponse.data);
  const verifying = transitionSubmissionIntent(store, intentId, "VERIFYING");
  store = await setSubmissionStore(verifying.store);
  const observed = await waitForControlledConfirmation(tab.id, selected);
  if (!observed) {
    const failed = transitionSubmissionIntent(store, intentId, "FAILED", {
      failureCode: "CONFIRMATION_TIMEOUT",
      message:
        "Submit was clicked once, but no verified confirmation appeared. The copilot will not retry.",
    });
    await setSubmissionStore(failed.store);
    throw new Error(failed.intent.message ?? "Submission confirmation was not verified.");
  }
  if (!observed.matches) {
    const failed = transitionSubmissionIntent(store, intentId, "FAILED", {
      failureCode: "CONFIRMATION_MISMATCH",
      message: "A confirmation appeared for a different application identity.",
    });
    await setSubmissionStore(failed.store);
    throw new Error(failed.intent.message ?? "The confirmation identity did not match.");
  }
  const refreshed = await analyzeActiveTab();
  const refreshedAnalysis =
    refreshed.ok && ApplicationPageAnalysisSchema.safeParse(refreshed.data).success
      ? ApplicationPageAnalysisSchema.parse(refreshed.data)
      : null;
  if (
    !refreshedAnalysis ||
    refreshedAnalysis.applicationId !== selected.applicationId ||
    !refreshedAnalysis.confirmation.confirmed
  ) {
    const failed = transitionSubmissionIntent(store, intentId, "FAILED", {
      failureCode: "CONFIRMATION_MISMATCH",
      message: "The confirmation could not be bound to the tracked application.",
    });
    await setSubmissionStore(failed.store);
    throw new Error(failed.intent.message ?? "The tracked confirmation did not match.");
  }
  const confirmed = transitionSubmissionIntent(store, intentId, "CONFIRMED", {
    ...(observed.confirmation.referenceId
      ? { confirmationReferenceId: observed.confirmation.referenceId }
      : {}),
    message: "One Test ATS submission was verified by confirmation evidence.",
  });
  await setSubmissionStore(confirmed.store);
  return SubmissionActionResultSchema.parse({ intent: confirmed.intent });
}

async function handlePanelRequest(
  request: ReturnType<typeof PanelRequestSchema.parse>,
): Promise<RuntimeResponse> {
  if (request.type === "PANEL_PROFILE_GET") return { ok: true, data: await getProfileVault() };

  if (request.type === "PANEL_ANALYZE_ACTIVE_TAB") return analyzeActiveTab();

  if (request.type === "PANEL_TRACKER_GET") {
    return { ok: true, data: ApplicationTrackerSchema.parse(await getApplicationTracker()) };
  }

  if (request.type === "PANEL_TRACKER_UPDATE_STATUS") {
    try {
      const tracker = updateApplicationStatus(
        await getApplicationTracker(),
        request.applicationId,
        request.status,
      );
      return { ok: true, data: await setApplicationTracker(tracker) };
    } catch (error) {
      return failure(
        "TRACKER_INVALID",
        error instanceof Error ? error.message : "The tracker status could not be updated.",
      );
    }
  }

  if (request.type === "PANEL_TRACKER_EXPORT_CSV") {
    return { ok: true, data: exportTrackerCsv(await getApplicationTracker()) };
  }

  if (request.type === "PANEL_TRACKER_IMPORT_CSV") {
    try {
      const result = importTrackerCsv(await getApplicationTracker(), request.csv);
      const tracker = await setApplicationTracker(result.tracker);
      return { ok: true, data: { ...result, tracker } };
    } catch (error) {
      return failure(
        "TRACKER_INVALID",
        error instanceof Error ? error.message : "The tracker CSV could not be imported.",
      );
    }
  }

  if (request.type === "PANEL_AI_CONFIG_GET") {
    return { ok: true, data: aiConfigStatus(await getAiSessionConfig()) };
  }

  if (request.type === "PANEL_AI_CONFIG_SET") {
    return { ok: true, data: aiConfigStatus(await setAiSessionConfig(request.config)) };
  }

  if (request.type === "PANEL_AI_CONFIG_CLEAR") {
    await clearAiSessionConfig();
    return { ok: true, data: aiConfigStatus(null) };
  }

  if (request.type === "PANEL_SYNC_STATUS") {
    return { ok: true, data: await getOptionalSyncStatus() };
  }

  if (request.type === "PANEL_SYNC_REGISTER") {
    return { ok: true, data: await registerOptionalSync(request.input) };
  }

  if (request.type === "PANEL_SYNC_LOGIN") {
    return { ok: true, data: await loginOptionalSync(request.input) };
  }

  if (request.type === "PANEL_SYNC_RUN") {
    return { ok: true, data: await runOptionalSync() };
  }

  if (request.type === "PANEL_SYNC_DEVICES") {
    return { ok: true, data: await listSyncDevices() };
  }

  if (request.type === "PANEL_SYNC_REVOKE_DEVICE") {
    return { ok: true, data: await revokeSyncDevice(request.deviceId) };
  }

  if (request.type === "PANEL_SYNC_EXPORT_BACKUP") {
    return { ok: true, data: await exportEncryptedSyncBackup() };
  }

  if (request.type === "PANEL_SYNC_LOCK") {
    return { ok: true, data: await lockOptionalSync() };
  }

  if (request.type === "PANEL_SYNC_DISABLE") {
    return { ok: true, data: await disableOptionalSync() };
  }

  if (request.type === "PANEL_SYNC_DELETE_ACCOUNT") {
    return { ok: true, data: await deleteOptionalSyncAccount() };
  }

  if (request.type === "PANEL_AUTO_NEXT_STATUS") {
    return { ok: true, data: await autoNextStatus(request.analysisId) };
  }

  if (request.type === "PANEL_AUTO_NEXT_SET_ENABLED") {
    return { ok: true, data: await setAutoNextFeature(request.analysisId, request.enabled) };
  }

  if (request.type === "PANEL_AUTO_NEXT_SET_APPLICATION") {
    return {
      ok: true,
      data: await setApplicationAutoNextFeature(request.analysisId, request.enabled),
    };
  }

  if (request.type === "PANEL_AUTO_NEXT_PREPARE") {
    return { ok: true, data: await prepareAutoNext(request.analysisId) };
  }

  if (request.type === "PANEL_AUTO_NEXT_EXECUTE") {
    return { ok: true, data: await executeAutoNext(request.intentId) };
  }

  if (request.type === "PANEL_AUTO_NEXT_ABORT") {
    return { ok: true, data: await abortAutoNext(request.intentId) };
  }

  if (request.type === "PANEL_SUBMISSION_STATUS") {
    return { ok: true, data: await submissionStatus(request.analysisId) };
  }

  if (request.type === "PANEL_SUBMISSION_SET_ENABLED") {
    return { ok: true, data: await setSubmissionFeature(request.analysisId, request.enabled) };
  }

  if (request.type === "PANEL_SUBMISSION_SET_APPLICATION") {
    return {
      ok: true,
      data: await setApplicationSubmissionFeature(request.analysisId, request.enabled),
    };
  }

  if (request.type === "PANEL_SUBMISSION_PREPARE") {
    return {
      ok: true,
      data: await prepareControlledSubmission(request.analysisId, request.explicitConsent),
    };
  }

  if (request.type === "PANEL_SUBMISSION_EXECUTE") {
    return { ok: true, data: await executeControlledSubmission(request.intentId) };
  }

  if (request.type === "PANEL_SUBMISSION_ABORT") {
    return { ok: true, data: await abortControlledSubmission(request.intentId) };
  }

  if (request.type === "PANEL_AI_DRAFT") {
    return draftCustomAnswer(request.analysisId, request.fieldId, request.maxChars);
  }

  if (request.type === "PANEL_HIGHLIGHT_ACTIVE_FIELDS") {
    return reviewedAction(request.analysisId, request.fieldIds, "highlight");
  }

  if (request.type === "PANEL_FILL_ACTIVE_FIELDS") {
    return reviewedAction(request.analysisId, request.fieldIds, "fill");
  }

  if (request.type === "PANEL_FILL_CUSTOM_ANSWERS") {
    return fillCustomAnswers(request.analysisId, request.answers);
  }

  if (request.type === "PANEL_UPLOAD_APPROVED_RESUME") {
    return uploadApprovedResume(request.analysisId, request.fieldId, request.file);
  }

  if (request.type === "PANEL_PROFILE_SAVE") {
    const vault = await getProfileVault();
    const saved = saveProfileDraft(vault, request.draft);
    return { ok: true, data: await storeProfile(saved) };
  }

  if (request.type === "PANEL_PROFILE_SETUP_SAVE") {
    return {
      ok: true,
      data: await storeProfile(saveCareerSetup(await getProfileVault(), request.draft)),
    };
  }
  if (request.type === "PANEL_PROFILE_IMPORT_NARRATIVE") {
    const vault = await getProfileVault();
    if (vault.currentProfile.profileVersion !== request.expectedProfileVersion)
      throw new Error("Your profile changed. Reload before importing notes.");
    const draft = parseNarrativeIntake(request.text);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(request.text));
    return {
      ok: true,
      data: await storeProfile(
        importResumeDraft(vault, draft, {
          id: `narrative-${crypto.randomUUID()}`,
          kind: "NARRATIVE",
          displayName: "Background notes (labelled contact details)",
          sha256: Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join(""),
          importedAt: new Date().toISOString(),
        }),
      ),
    };
  }

  if (request.type === "PANEL_PROFILE_EXPORT") {
    return { ok: true, data: { backupJson: exportProfileBackup(await getProfileVault()) } };
  }

  if (request.type === "PANEL_PROFILE_IMPORT_JSON") {
    return { ok: true, data: await storeProfile(importProfileBackup(request.json)) };
  }

  if (request.type === "PANEL_PROFILE_IMPORT_RESUME") {
    const imported = importResumeDraft(await getProfileVault(), request.draft, request.source);
    return { ok: true, data: await storeProfile(imported) };
  }

  if (request.type === "PANEL_PROFILE_VERIFY_IMPORTED") {
    return { ok: true, data: await storeProfile(verifyImportedFacts(await getProfileVault())) };
  }

  if (request.type === "PANEL_PROFILE_RESOLVE_CONFLICT") {
    const resolved = resolveProfileConflict(
      await getProfileVault(),
      request.conflictId,
      request.resolution,
    );
    return { ok: true, data: await storeProfile(resolved) };
  }

  return scanActiveTab();
}

let profileQueue: Promise<unknown> = Promise.resolve();
chrome.runtime.onMessage.addListener((untrustedMessage: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;

  const parsed = PanelRequestSchema.safeParse(untrustedMessage);
  if (!parsed.success) {
    sendResponse(failure("BAD_MESSAGE", "Rejected a message outside the extension protocol."));
    return false;
  }

  if (
    parsed.data.type.startsWith("PANEL_MEMORY_") ||
    parsed.data.type.startsWith("PANEL_WORKFLOW_")
  ) {
    if (!AGENT_LAB_AVAILABLE || sender.url !== chrome.runtime.getURL("sidepanel.html")) {
      sendResponse(failure("BAD_MESSAGE", "Correction memory requires the research panel."));
      return false;
    }
    const result = profileQueue.then(() => handleMemoryRequest(parsed.data));
    profileQueue = result.then(
      () => undefined,
      () => undefined,
    );
    void result.then(sendResponse, (error: unknown) =>
      sendResponse(
        failure("AGENT_FAILED", error instanceof Error ? error.message : "Memory unavailable."),
      ),
    );
    return true;
  }

  if (parsed.data.type.startsWith("PANEL_PREPARATION_")) {
    if (!AGENT_LAB_AVAILABLE || sender.url !== chrome.runtime.getURL("sidepanel.html")) {
      sendResponse(failure("BAD_MESSAGE", "Local preparation requires the research panel."));
      return false;
    }
    const request = parsed.data;
    const result =
      request.type === "PANEL_PREPARATION_REVIEW"
        ? jobPreparation.review(request.jobId)
        : request.type === "PANEL_PREPARATION_GET"
          ? jobPreparation.view(request.id)
          : request.type === "PANEL_PREPARATION_CANCEL"
            ? jobPreparation.cancel(request.id, request.revision)
            : request.type === "PANEL_PREPARATION_FORGET"
              ? jobPreparation.forget(request.id, request.revision)
              : request.type === "PANEL_PREPARATION_APPROVE"
                ? jobPreparation.approve(request.id, request.revision, request.answers)
                : Promise.reject(new Error("Unknown preparation request."));
    void result.then(
      (data) => sendResponse({ ok: true, data }),
      (error: unknown) =>
        sendResponse(
          failure(
            "AGENT_FAILED",
            error instanceof Error ? error.message : "Preparation unavailable.",
          ),
        ),
    );
    return true;
  }

  if (parsed.data.type.startsWith("PANEL_JOBS_")) {
    if (!AGENT_LAB_AVAILABLE || sender.url !== chrome.runtime.getURL("sidepanel.html")) {
      sendResponse(failure("BAD_MESSAGE", "Jobs research requires the extension panel."));
      return false;
    }
    const request = parsed.data;
    const result =
      request.type === "PANEL_JOBS_GET"
        ? discovery.view()
        : request.type === "PANEL_JOBS_SEARCH"
          ? discovery.search(request.query)
          : request.type === "PANEL_JOBS_CANCEL"
            ? discovery.cancel()
            : request.type === "PANEL_JOBS_IMPORT"
              ? discovery.importListing(request)
              : request.type === "PANEL_JOBS_DISMISS"
                ? discovery.dismiss(request.id, request.dismissed)
                : request.type === "PANEL_JOBS_FORGET"
                  ? discovery.forget(request.id)
                  : request.type === "PANEL_JOBS_EVIDENCE"
                    ? discovery.evidence(request.id, request.rating)
                    : request.type === "PANEL_JOBS_FORGET_EVIDENCE"
                      ? discovery.evidence(request.id, null)
                      : Promise.reject(new Error("Unknown jobs request."));
    void result.then(
      (data) => sendResponse({ ok: true, data }),
      (error: unknown) =>
        sendResponse(
          failure("AGENT_FAILED", error instanceof Error ? error.message : "Jobs unavailable."),
        ),
    );
    return true;
  }

  if (parsed.data.type.startsWith("PANEL_AGENT_")) {
    if (sender.url !== chrome.runtime.getURL("sidepanel.html")) {
      sendResponse(failure("BAD_MESSAGE", "Agent lab requests require the extension panel."));
      return false;
    }
    const request = parsed.data;
    const result =
      request.type === "PANEL_AGENT_STATUS"
        ? agentLab.status()
        : request.type === "PANEL_AGENT_SET_ENABLED"
          ? agentLab.setEnabled(request.enabled)
          : request.type === "PANEL_AGENT_START"
            ? agentLab.start()
            : request.type === "PANEL_AGENT_CHECKPOINT"
              ? agentLab.checkpoint(request.runId)
              : request.type === "PANEL_AGENT_PAUSE"
                ? agentLab.pause(request.runId)
                : request.type === "PANEL_AGENT_CANCEL"
                  ? agentLab.cancel(request.runId)
                  : Promise.reject(new Error("Unknown agent lab command."));
    void result.then(
      (data) => sendResponse({ ok: true, data } satisfies RuntimeResponse),
      (error: unknown) => sendResponse(failure("AGENT_FAILED", agentLabErrorMessage(error))),
    );
    return true;
  }

  if (parsed.data.type.startsWith("PANEL_EXECUTOR_")) {
    if (!AGENT_LAB_AVAILABLE || sender.url !== chrome.runtime.getURL("sidepanel.html")) {
      sendResponse(failure("BAD_MESSAGE", "Local executor requires the research panel."));
      return false;
    }
    const request = parsed.data;
    void (async () => {
      try {
        const data =
          request.type === "PANEL_EXECUTOR_STATUS"
            ? await executionController.status()
            : request.type === "PANEL_EXECUTOR_ENABLE"
              ? await executionController.enable(request.enabled)
              : request.type === "PANEL_EXECUTOR_START"
                ? await executionController.start(request.approved)
                : request.type === "PANEL_EXECUTOR_RESUME"
                  ? await executionController.resume(request.runId)
                  : request.type === "PANEL_EXECUTOR_PAUSE"
                    ? await executionController.stop(request.runId, false)
                    : request.type === "PANEL_EXECUTOR_CANCEL"
                      ? await executionController.stop(request.runId, true)
                      : request.type === "PANEL_EXECUTOR_VISUAL"
                        ? await (async () => {
                            await executionController.stop(request.runId, false);
                            const run = (await executionRepository.read()).runs.find(
                              (x) => x.id === request.runId,
                            );
                            if (!run) throw new Error("RUN_NOT_FOUND");
                            return captureLocalExecution(run.binding.tabId);
                          })()
                        : null;
        sendResponse({ ok: true, data });
      } catch (error) {
        sendResponse(
          failure("AGENT_FAILED", error instanceof Error ? error.message : "Execution stopped"),
        );
      }
    })();
    return true;
  }

  if (parsed.data.type === "PANEL_PING") {
    sendResponse({ ok: true, data: { pong: true } } satisfies RuntimeResponse);
    return false;
  }

  const request = parsed.data;
  const serialized =
    request.type.startsWith("PANEL_PROFILE_") || request.type.startsWith("PANEL_SYNC_");
  const response = serialized
    ? profileQueue.then(() => handlePanelRequest(request))
    : handlePanelRequest(request);
  if (serialized)
    profileQueue = response.then(
      () => undefined,
      () => undefined,
    );
  void response.then(sendResponse, (error: unknown) => {
    const isProfileRequest = parsed.data.type.startsWith("PANEL_PROFILE_");
    const isAiRequest = parsed.data.type.startsWith("PANEL_AI_");
    const isSyncRequest = parsed.data.type.startsWith("PANEL_SYNC_");
    const isNavigationRequest = parsed.data.type.startsWith("PANEL_AUTO_NEXT_");
    const isSubmissionRequest = parsed.data.type.startsWith("PANEL_SUBMISSION_");
    const message = error instanceof Error ? error.message : "Unexpected extension failure.";
    sendResponse(
      failure(
        isProfileRequest
          ? "PROFILE_INVALID"
          : isAiRequest
            ? "AI_PROVIDER_FAILED"
            : isSyncRequest
              ? "SYNC_FAILED"
              : isNavigationRequest
                ? "NAVIGATION_FAILED"
                : isSubmissionRequest
                  ? "SUBMISSION_FAILED"
                  : "SCAN_FAILED",
        message,
      ),
    );
  });
  return true;
});
