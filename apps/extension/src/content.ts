import { ContentRequestSchema, type RuntimeResponse } from "@copilot/browser-command-schema";

import { scanVisibleForm } from "./scanner";

declare global {
  interface Window {
    __jobApplicationCopilotLoaded?: boolean;
  }
}

if (!window.__jobApplicationCopilotLoaded) {
  window.__jobApplicationCopilotLoaded = true;

  chrome.runtime.onMessage.addListener((untrustedMessage: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;

    const request = ContentRequestSchema.safeParse(untrustedMessage);
    if (!request.success) return false;

    if (request.data.type === "CONTENT_PING") {
      sendResponse({ ok: true, data: { pong: true } } satisfies RuntimeResponse);
      return false;
    }

    try {
      sendResponse({ ok: true, data: scanVisibleForm() } satisfies RuntimeResponse);
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
