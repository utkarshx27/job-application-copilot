export type ActiveTabCandidate = {
  id?: number | undefined;
  url?: string | undefined;
};

export type ResolvedActiveTab = {
  id: number;
  url: string;
};

export async function resolveActiveTab(
  queryActiveTabs: () => Promise<ActiveTabCandidate[]>,
  probeTabUrl: (tabId: number) => Promise<string | undefined>,
): Promise<ResolvedActiveTab | null> {
  const [candidate] = await queryActiveTabs();
  if (!candidate || typeof candidate.id !== "number") return null;
  const url = candidate.url ?? (await probeTabUrl(candidate.id));
  return url ? { id: candidate.id, url } : null;
}
