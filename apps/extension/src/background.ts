import {
  ContentRequestSchema,
  PanelRequestSchema,
  RuntimeResponseSchema,
  type RuntimeResponse,
} from "@copilot/browser-command-schema";
import { policyForUrl } from "@copilot/shared";

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

  void scanActiveTab().then(sendResponse, () => {
    sendResponse(failure("SCAN_FAILED", "Unexpected scan failure."));
  });
  return true;
});
