export type ActiveSiteAccessResult =
  { granted: true; originPattern: string } | { granted: false; message: string };

export type ActiveTabForSiteAccess = {
  url?: string | undefined;
};

export function originPatternForPage(pageUrl: string): string | null {
  try {
    const parsed = new URL(pageUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return `${parsed.protocol}//${parsed.hostname}/*`;
  } catch {
    return null;
  }
}

export async function ensureActiveSiteAccess(
  queryActiveTabs: () => Promise<ActiveTabForSiteAccess[]>,
  containsOrigin: (originPattern: string) => Promise<boolean>,
  requestOrigin: (originPattern: string) => Promise<boolean>,
): Promise<ActiveSiteAccessResult> {
  const [activeTab] = await queryActiveTabs();
  const pageUrl = activeTab?.url;
  const originPattern = pageUrl ? originPatternForPage(pageUrl) : null;

  if (!pageUrl || !originPattern) {
    return {
      granted: false,
      message: "Open an http or https application page, make that tab active, and scan again.",
    };
  }

  if (await containsOrigin(originPattern)) return { granted: true, originPattern };

  if (await requestOrigin(originPattern)) return { granted: true, originPattern };

  const hostname = new URL(pageUrl).hostname;
  return {
    granted: false,
    message: `Chrome site access is required to scan ${hostname}. Scan again and approve access when Chrome asks.`,
  };
}
