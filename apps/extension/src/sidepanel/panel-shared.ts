import { PanelRequestSchema, RuntimeResponseSchema } from "@copilot/browser-command-schema";
export type Notice = { kind: "success" | "error"; message: string } | null;
export async function sendPanelRequest(untrustedRequest: unknown) {
  const request = PanelRequestSchema.parse(untrustedRequest);
  const response: unknown = await chrome.runtime.sendMessage(request);
  return RuntimeResponseSchema.parse(response);
}
