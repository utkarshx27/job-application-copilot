import { describe, expect, it, vi } from "vitest";

import { ensureActiveSiteAccess, originPatternForPage } from "../src/site-access";

describe("active site access", () => {
  it("builds a site-scoped Chrome origin pattern", () => {
    expect(
      originPatternForPage(
        "https://jobs.smartrecruiters.com/oneclick-ui/company/example?candidate=local",
      ),
    ).toBe("https://jobs.smartrecruiters.com/*");
    expect(originPatternForPage("http://127.0.0.1:4173/workday.html")).toBe("http://127.0.0.1/*");
    expect(originPatternForPage("chrome://extensions")).toBeNull();
  });

  it("does not prompt when the active site is already granted", async () => {
    const request = vi.fn<() => Promise<boolean>>();
    await expect(
      ensureActiveSiteAccess(
        () => Promise.resolve([{ url: "https://jobs.example.test/apply" }]),
        () => Promise.resolve(true),
        request,
      ),
    ).resolves.toEqual({ granted: true, originPattern: "https://jobs.example.test/*" });
    expect(request).not.toHaveBeenCalled();
  });

  it("requests only the active site's origin when access is missing", async () => {
    const request = vi.fn<(origin: string) => Promise<boolean>>(() => Promise.resolve(true));
    await expect(
      ensureActiveSiteAccess(
        () => Promise.resolve([{ url: "https://jobs.example.test/apply" }]),
        () => Promise.resolve(false),
        request,
      ),
    ).resolves.toEqual({ granted: true, originPattern: "https://jobs.example.test/*" });
    expect(request).toHaveBeenCalledWith("https://jobs.example.test/*");
  });

  it("stops cleanly when the user declines site access", async () => {
    await expect(
      ensureActiveSiteAccess(
        () => Promise.resolve([{ url: "https://jobs.example.test/apply" }]),
        () => Promise.resolve(false),
        () => Promise.resolve(false),
      ),
    ).resolves.toEqual({
      granted: false,
      message:
        "Chrome site access is required to scan jobs.example.test. Scan again and approve access when Chrome asks.",
    });
  });
});
