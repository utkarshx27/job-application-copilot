import { migrateApplicationTracker } from "@copilot/application-state";
import { ApplicationTrackerSchema, type ApplicationTracker } from "@copilot/job-schema";

const STORAGE_KEY = "applicationTracker";

export async function getApplicationTracker(): Promise<ApplicationTracker> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const parsed = ApplicationTrackerSchema.safeParse(stored[STORAGE_KEY]);
  if (parsed.success) return parsed.data;
  const tracker = migrateApplicationTracker(stored[STORAGE_KEY]);
  await chrome.storage.local.set({ [STORAGE_KEY]: tracker });
  return tracker;
}

export async function setApplicationTracker(
  trackerInput: ApplicationTracker,
): Promise<ApplicationTracker> {
  const tracker = ApplicationTrackerSchema.parse(trackerInput);
  await chrome.storage.local.set({ [STORAGE_KEY]: tracker });
  return tracker;
}
