import { ContentRequestSchema, type RuntimeResponse } from "@copilot/browser-command-schema";

import { inspectApplicationPage } from "./ats-page";
import { scanVisibleForm } from "./scanner";
import { uploadApprovedFile } from "./upload-driver";
import { applyFillPlan, highlightFields, installUserEditTracking } from "./form-driver";
import { executeControlledNext } from "./navigation-driver";

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

    void (async () => {
      try {
        if (request.data.type === "CONTENT_SCAN_PAGE") {
          sendResponse({ ok: true, data: scanVisibleForm() } satisfies RuntimeResponse);
        } else if (request.data.type === "CONTENT_INSPECT_APPLICATION") {
          sendResponse({ ok: true, data: inspectApplicationPage() } satisfies RuntimeResponse);
        } else if (request.data.type === "CONTENT_HIGHLIGHT_FIELDS") {
          sendResponse({
            ok: true,
            data: highlightFields(request.data.fieldIds),
          } satisfies RuntimeResponse);
        } else if (request.data.type === "CONTENT_APPLY_FILL") {
          sendResponse({
            ok: true,
            data: applyFillPlan(request.data.plan),
          } satisfies RuntimeResponse);
        } else if (request.data.type === "CONTENT_UPLOAD_APPROVED_FILE") {
          sendResponse({
            ok: true,
            data: await uploadApprovedFile(request.data.plan),
          } satisfies RuntimeResponse);
        } else if (request.data.type === "CONTENT_EXECUTE_CONTROLLED_NEXT") {
          sendResponse({
            ok: true,
            data: executeControlledNext(request.data.plan),
          } satisfies RuntimeResponse);
        }
      } catch (error) {
        sendResponse({
          ok: false,
          error: {
            code: "SCAN_FAILED",
            message: error instanceof Error ? error.message : "Unable to inspect this application.",
          },
        } satisfies RuntimeResponse);
      }
    })();
    return true;
  });
}
