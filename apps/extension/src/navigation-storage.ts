import {
  AutoNextStoreSchema,
  createAutoNextStore,
  type AutoNextStore,
} from "@copilot/navigation-core";

const STORAGE_KEY = "controlledAutoNext";

export async function getAutoNextStore(): Promise<AutoNextStore> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const parsed = AutoNextStoreSchema.safeParse(stored[STORAGE_KEY]);
  if (parsed.success) return parsed.data;
  const initial = createAutoNextStore();
  await chrome.storage.local.set({ [STORAGE_KEY]: initial });
  return initial;
}

export async function setAutoNextStore(input: AutoNextStore): Promise<AutoNextStore> {
  const store = AutoNextStoreSchema.parse(input);
  await chrome.storage.local.set({ [STORAGE_KEY]: store });
  return store;
}
