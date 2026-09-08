import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_EXECUTION_URL } from "@copilot/agent-core";
import { captureLocalExecution } from "../src/agent-execution-visual";

function setup() {
  const get = vi
    .fn()
    .mockResolvedValue({ url: AGENT_EXECUTION_URL, active: true, width: 1920, height: 1080 });
  const contains = vi.fn().mockResolvedValue(true);
  const attach = vi.fn().mockResolvedValue(undefined);
  const detach = vi.fn().mockResolvedValue(undefined);
  const sendCommand = vi.fn().mockResolvedValue({ data: "synthetic" });
  vi.stubGlobal("chrome", {
    tabs: { get },
    permissions: { contains },
    debugger: { attach, detach, sendCommand },
  });
  return { get, contains, attach, detach, sendCommand };
}
afterEach(() => vi.unstubAllGlobals());
describe("local visual review lifecycle", () => {
  it("captures one bounded screenshot and detaches", async () => {
    const api = setup();
    expect(await captureLocalExecution(1)).toEqual({
      kind: "LOCAL_VISUAL_REVIEW",
      image: "data:image/jpeg;base64,synthetic",
    });
    expect(api.sendCommand).toHaveBeenCalledWith(
      { tabId: 1 },
      "Page.captureScreenshot",
      expect.objectContaining({
        clip: { x: 0, y: 0, width: 1000, height: 700, scale: 1 },
        captureBeyondViewport: false,
      }),
    );
    expect(api.detach).toHaveBeenCalledOnce();
  });
  it.each(["real-url", "inactive", "no-permission"])(
    "rejects %s before attaching",
    async (kind) => {
      const api = setup();
      if (kind === "real-url")
        api.get.mockResolvedValue({ url: "https://example.com", active: true });
      if (kind === "inactive")
        api.get.mockResolvedValue({ url: AGENT_EXECUTION_URL, active: false });
      if (kind === "no-permission") api.contains.mockResolvedValue(false);
      await expect(captureLocalExecution(1)).rejects.toThrow();
      expect(api.attach).not.toHaveBeenCalled();
    },
  );
  it("detaches on capture failure without retaining an image", async () => {
    const api = setup();
    api.sendCommand.mockRejectedValue(new Error("capture failed"));
    await expect(captureLocalExecution(1)).rejects.toThrow();
    expect(api.detach).toHaveBeenCalledOnce();
  });
  it("rejects a navigation race before capturing", async () => {
    const api = setup();
    api.get
      .mockResolvedValueOnce({ url: AGENT_EXECUTION_URL, active: true })
      .mockResolvedValue({ url: "https://example.com", active: true });
    await expect(captureLocalExecution(1)).rejects.toThrow("PAGE_CHANGED");
    expect(api.sendCommand).not.toHaveBeenCalled();
    expect(api.detach).toHaveBeenCalledOnce();
  });
  it("does not detach a debugger it failed to attach", async () => {
    const api = setup();
    api.attach.mockRejectedValue(new Error("already attached"));
    await expect(captureLocalExecution(1)).rejects.toThrow();
    expect(api.detach).not.toHaveBeenCalled();
  });
  it("rejects an oversized capture and still detaches", async () => {
    const api = setup();
    api.sendCommand.mockResolvedValue({ data: "x".repeat(1_400_001) });
    await expect(captureLocalExecution(1)).rejects.toThrow();
    expect(api.detach).toHaveBeenCalledOnce();
  });
});
