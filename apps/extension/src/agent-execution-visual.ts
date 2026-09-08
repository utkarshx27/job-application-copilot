import { AGENT_EXECUTION_URL } from "@copilot/agent-core";
import { z } from "zod";

/** Explicit local diagnostic fallback. Never sends screenshots to a model or clicks coordinates. */
export async function captureLocalExecution(tabId: number) {
  const tab = await chrome.tabs.get(tabId);
  if (
    tab.url !== AGENT_EXECUTION_URL ||
    !tab.active ||
    !(await chrome.permissions.contains({ permissions: ["debugger"] }))
  )
    throw new Error("VISUAL_PERMISSION_REQUIRED");
  const target = { tabId };
  await chrome.debugger.attach(target, "1.3");
  try {
    if ((await chrome.tabs.get(tabId)).url !== AGENT_EXECUTION_URL) throw new Error("PAGE_CHANGED");
    const result = z.object({ data: z.string().max(1_400_000) }).parse(
      await chrome.debugger.sendCommand(target, "Page.captureScreenshot", {
        format: "jpeg",
        quality: 55,
        captureBeyondViewport: false,
        clip: {
          x: 0,
          y: 0,
          width: Math.min(tab.width ?? 800, 1000),
          height: Math.min(tab.height ?? 600, 700),
          scale: 1,
        },
      }),
    );
    if ((await chrome.tabs.get(tabId)).url !== AGENT_EXECUTION_URL) throw new Error("PAGE_CHANGED");
    return { kind: "LOCAL_VISUAL_REVIEW" as const, image: `data:image/jpeg;base64,${result.data}` };
  } finally {
    await chrome.debugger.detach(target).catch(() => undefined);
  }
}
