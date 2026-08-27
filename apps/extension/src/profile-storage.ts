import {
  createEmptyVault,
  migrateStoredProfile,
  ProfileVaultSchema,
  type ProfileVault,
} from "@copilot/profile-core";

const STORAGE_KEY = "profileVault";

export async function getProfileVault(): Promise<ProfileVault> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const parsed = ProfileVaultSchema.safeParse(stored[STORAGE_KEY]);
  if (parsed.success) return parsed.data;

  if (stored[STORAGE_KEY]) {
    const migrated = migrateStoredProfile(stored[STORAGE_KEY]);
    await chrome.storage.local.set({ [STORAGE_KEY]: migrated });
    return migrated;
  }

  const vault = createEmptyVault();
  await chrome.storage.local.set({ [STORAGE_KEY]: vault });
  return vault;
}

export async function setProfileVault(untrustedVault: unknown): Promise<ProfileVault> {
  const vault = ProfileVaultSchema.parse(untrustedVault);
  await chrome.storage.local.set({ [STORAGE_KEY]: vault });
  return vault;
}
