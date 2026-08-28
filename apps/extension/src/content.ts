import { ContentRequestSchema, type RuntimeResponse } from "@copilot/browser-command-schema";

import { scanVisibleForm } from "./scanner";
import { applyFillPlan, highlightFields, installUserEditTracking } from "./form-driver";

declare global {
  interface Window {
    __jobApplicationCopilotLoaded?: boolean;
  }
}

if (!window.__jobApplicationCopilotLoaded) {
  window.__jobApplicationCopilotLoaded = true;
  installUserEditTracking();

  chrome.runtime.onMessage.addListener((untrustedMessage: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;

    const request = ContentRequestSchema.safeParse(untrustedMessage);
    if (!request.success) return false;

    if (request.data.type === "CONTENT_PING") {
      sendResponse({ ok: true, data: { pong: true } } satisfies RuntimeResponse);
      return false;
    }

    try {
      if (request.data.type === "CONTENT_SCAN_PAGE") {
        sendResponse({ ok: true, data: scanVisibleForm() } satisfies RuntimeResponse);
      } else if (request.data.type === "CONTENT_HIGHLIGHT_FIELDS") {
        sendResponse({
          ok: true,
          data: highlightFields(request.data.fieldIds),
        } satisfies RuntimeResponse);
      } else {
        sendResponse({
          ok: true,
          data: applyFillPlan(request.data.plan),
        } satisfies RuntimeResponse);
      }
    } catch (error) {
      sendResponse({
        ok: false,
        error: {
          code: "SCAN_FAILED",
          message: error instanceof Error ? error.message : "Unable to scan this form.",
        },
      } satisfies RuntimeResponse);
    }
    return false;
  });
}
