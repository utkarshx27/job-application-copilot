import {
  ContentRequestSchema,
  PanelRequestSchema,
  RuntimeResponseSchema,
  type RuntimeResponse,
} from "@copilot/browser-command-schema";
import {
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
import { FillPlanSchema, FillResultSchema, HighlightResultSchema } from "@copilot/form-schema";
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
  exportProfileBackup,
  importResumeDraft,
  importProfileBackup,
  resolveProfileConflict,
  saveProfileDraft,
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
import { getApplicationTracker, setApplicationTracker } from "./application-storage";
import { adapterForId } from "./ats-page";
import {
  aiConfigStatus,
  clearAiSessionConfig,
  getAiSessionConfig,
  setAiSessionConfig,
} from "./ai-storage";

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
const analysesByTab = new Map<number, ApplicationPageAnalysis>();

type RuntimeErrorCode = Extract<RuntimeResponse, { ok: false }>["error"]["code"];

function failure(code: RuntimeErrorCode, message: string): RuntimeResponse {
  return { ok: false, error: { code, message } };
}

async function storeProfile(untrustedVault: unknown) {
  const stored = await setProfileVault(untrustedVault);
  analysesByTab.clear();
  return stored;
}

async function inspectableActiveTab(): Promise<{ id: number; url: string } | RuntimeResponse> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return failure("NO_ACTIVE_TAB", "No inspectable active tab was found.");

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
  const baseAnalysis = analyzeForm(
    inspected.data.snapshot,
    vault.currentProfile,
    crypto.randomUUID(),
    (field) => adapter?.classifyField(field) ?? classifyField(field),
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
    const draftableMappedField = mapping.canonicalQuestion === "APPLICATION.cover_letter";
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

chrome.runtime.onMessage.addListener((untrustedMessage: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;

  const parsed = PanelRequestSchema.safeParse(untrustedMessage);
  if (!parsed.success) {
    sendResponse(failure("BAD_MESSAGE", "Rejected a message outside the extension protocol."));
    return false;
  }

  if (parsed.data.type === "PANEL_PING") {
    sendResponse({ ok: true, data: { pong: true } } satisfies RuntimeResponse);
    return false;
  }

  void handlePanelRequest(parsed.data).then(sendResponse, (error: unknown) => {
    const isProfileRequest = parsed.data.type.startsWith("PANEL_PROFILE_");
    const isAiRequest = parsed.data.type.startsWith("PANEL_AI_");
    const message = error instanceof Error ? error.message : "Unexpected extension failure.";
    sendResponse(
      failure(
        isProfileRequest ? "PROFILE_INVALID" : isAiRequest ? "AI_PROVIDER_FAILED" : "SCAN_FAILED",
        message,
      ),
    );
  });
  return true;
});
