import {
  SubmissionStoreSchema,
  createSubmissionStore,
  type SubmissionStore,
} from "@copilot/submission-core";

const STORAGE_KEY = "controlledSubmission";

export async function getSubmissionStore(): Promise<SubmissionStore> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const parsed = SubmissionStoreSchema.safeParse(stored[STORAGE_KEY]);
  if (parsed.success) return parsed.data;
  const initial = createSubmissionStore();
  await chrome.storage.local.set({ [STORAGE_KEY]: initial });
  return initial;
}

export async function setSubmissionStore(input: SubmissionStore): Promise<SubmissionStore> {
  const store = SubmissionStoreSchema.parse(input);
  await chrome.storage.local.set({ [STORAGE_KEY]: store });
  return store;
}
