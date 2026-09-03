import { describe, expect, it, vi } from "vitest";

import { resolveActiveTab } from "../src/active-tab";

describe("active tab resolution", () => {
  it("uses the URL Chrome exposes directly", async () => {
    const probe = vi.fn<() => Promise<string | undefined>>();
    await expect(
      resolveActiveTab(
        () => Promise.resolve([{ id: 7, url: "https://jobs.example.test/application" }]),
        probe,
      ),
    ).resolves.toEqual({ id: 7, url: "https://jobs.example.test/application" });
    expect(probe).not.toHaveBeenCalled();
  });

  it("probes only the page URL when Chrome omits it from the tab object", async () => {
    await expect(
      resolveActiveTab(
        () => Promise.resolve([{ id: 8 }]),
        (tabId) => Promise.resolve(tabId === 8 ? "https://careers.example.test/apply" : undefined),
      ),
    ).resolves.toEqual({ id: 8, url: "https://careers.example.test/apply" });
  });

  it("returns null when Chrome exposes no active tab", async () => {
    await expect(
      resolveActiveTab(
        () => Promise.resolve([]),
        () => Promise.resolve(undefined),
      ),
    ).resolves.toBeNull();
  });
});
