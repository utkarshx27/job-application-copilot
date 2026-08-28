import {
  ContentRequestSchema,
  PanelRequestSchema,
  RuntimeResponseSchema,
  type RuntimeResponse,
} from "@copilot/browser-command-schema";
import { policyForUrl } from "@copilot/shared";
import { analyzeForm } from "@copilot/form-engine";
import {
  FillPlanSchema,
  FillResultSchema,
  HighlightResultSchema,
  PageSnapshotSchema,
  type FormAnalysis,
} from "@copilot/form-schema";
import {
  exportProfileBackup,
  importResumeDraft,
  importProfileBackup,
  resolveProfileConflict,
  saveProfileDraft,
  verifyImportedFacts,
} from "@copilot/profile-core";

import { getProfileVault, setProfileVault } from "./profile-storage";

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
const analysesByTab = new Map<number, FormAnalysis>();

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

async function analyzeActiveTab(): Promise<RuntimeResponse> {
  const tab = await inspectableActiveTab();
  if ("ok" in tab) return tab;
  const response = await sendContentRequest(tab.id, { type: "CONTENT_SCAN_PAGE" });
  if (!response.ok) return response;
  const snapshot = PageSnapshotSchema.safeParse(response.data);
  if (!snapshot.success) return failure("SCAN_FAILED", "The page scan was not a valid snapshot.");
  const analysis = analyzeForm(snapshot.data, (await getProfileVault()).currentProfile);
  analysesByTab.set(tab.id, analysis);
  return { ok: true, data: analysis };
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

async function handlePanelRequest(
  request: ReturnType<typeof PanelRequestSchema.parse>,
): Promise<RuntimeResponse> {
  if (request.type === "PANEL_PROFILE_GET") return { ok: true, data: await getProfileVault() };

  if (request.type === "PANEL_ANALYZE_ACTIVE_TAB") return analyzeActiveTab();

  if (request.type === "PANEL_HIGHLIGHT_ACTIVE_FIELDS") {
    return reviewedAction(request.analysisId, request.fieldIds, "highlight");
  }

  if (request.type === "PANEL_FILL_ACTIVE_FIELDS") {
    return reviewedAction(request.analysisId, request.fieldIds, "fill");
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
    const message = error instanceof Error ? error.message : "Unexpected extension failure.";
    sendResponse(failure(isProfileRequest ? "PROFILE_INVALID" : "SCAN_FAILED", message));
  });
  return true;
});
