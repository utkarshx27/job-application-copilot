import {
  ContentRequestSchema,
  PanelRequestSchema,
  RuntimeResponseSchema,
  type RuntimeResponse,
} from "@copilot/browser-command-schema";
import { policyForUrl } from "@copilot/shared";
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

type RuntimeErrorCode = Extract<RuntimeResponse, { ok: false }>["error"]["code"];

function failure(code: RuntimeErrorCode, message: string): RuntimeResponse {
  return { ok: false, error: { code, message } };
}

async function scanActiveTab(): Promise<RuntimeResponse> {
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

  const request = ContentRequestSchema.parse({ type: "CONTENT_SCAN_PAGE" });
  try {
    const untrustedResponse: unknown = await chrome.tabs.sendMessage(tab.id, request);
    const response = RuntimeResponseSchema.safeParse(untrustedResponse);
    return response.success
      ? response.data
      : failure("SCAN_FAILED", "The page returned invalid scan data.");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The visible form could not be scanned.";
    return failure("SCAN_FAILED", message);
  }
}

async function handlePanelRequest(
  request: ReturnType<typeof PanelRequestSchema.parse>,
): Promise<RuntimeResponse> {
  if (request.type === "PANEL_PROFILE_GET") return { ok: true, data: await getProfileVault() };

  if (request.type === "PANEL_PROFILE_SAVE") {
    const vault = await getProfileVault();
    const saved = saveProfileDraft(vault, request.draft);
    return { ok: true, data: await setProfileVault(saved) };
  }

  if (request.type === "PANEL_PROFILE_EXPORT") {
    return { ok: true, data: { backupJson: exportProfileBackup(await getProfileVault()) } };
  }

  if (request.type === "PANEL_PROFILE_IMPORT_JSON") {
    return { ok: true, data: await setProfileVault(importProfileBackup(request.json)) };
  }

  if (request.type === "PANEL_PROFILE_IMPORT_RESUME") {
    const imported = importResumeDraft(await getProfileVault(), request.draft, request.source);
    return { ok: true, data: await setProfileVault(imported) };
  }

  if (request.type === "PANEL_PROFILE_VERIFY_IMPORTED") {
    return { ok: true, data: await setProfileVault(verifyImportedFacts(await getProfileVault())) };
  }

  if (request.type === "PANEL_PROFILE_RESOLVE_CONFLICT") {
    const resolved = resolveProfileConflict(
      await getProfileVault(),
      request.conflictId,
      request.resolution,
    );
    return { ok: true, data: await setProfileVault(resolved) };
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
