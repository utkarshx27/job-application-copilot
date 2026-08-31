import {
  SyncKdfSchema,
  SyncSessionSchema,
  type SyncAccountStatus,
  type SyncDataset,
  type SyncKdf,
} from "@copilot/sync-core";
import { z } from "zod";

const CONFIG_KEY = "optionalSyncConfig";
const SESSION_KEY = "optionalSyncSession";

const SyncLocalConfigSchema = z.object({
  configVersion: z.literal(1),
  enabled: z.literal(true),
  endpoint: z.url(),
  email: z.email(),
  deviceId: z.string().min(1),
  deviceName: z.string().min(1),
  kdf: SyncKdfSchema,
  revisions: z.partialRecord(
    z.enum(["PROFILE_VAULT", "APPLICATION_TRACKER"]),
    z.number().int().nonnegative(),
  ),
  lastSyncedAt: z.iso.datetime({ offset: true }).optional(),
});

const SyncSessionSecretsSchema = z.object({
  session: SyncSessionSchema,
  encryptionKey: z.string().regex(/^[A-Za-z0-9_-]+$/),
});

export type SyncLocalConfig = z.infer<typeof SyncLocalConfigSchema>;
export type SyncSessionSecrets = z.infer<typeof SyncSessionSecretsSchema>;

export async function getSyncConfig(): Promise<SyncLocalConfig | null> {
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  const parsed = SyncLocalConfigSchema.safeParse(stored[CONFIG_KEY]);
  return parsed.success ? parsed.data : null;
}

export async function setSyncConfig(input: SyncLocalConfig): Promise<SyncLocalConfig> {
  const config = SyncLocalConfigSchema.parse(input);
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
  return config;
}

export async function getSyncSessionSecrets(): Promise<SyncSessionSecrets | null> {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  const parsed = SyncSessionSecretsSchema.safeParse(stored[SESSION_KEY]);
  if (!parsed.success) return null;
  if (Date.parse(parsed.data.session.expiresAt) <= Date.now()) {
    await chrome.storage.session.remove(SESSION_KEY);
    return null;
  }
  return parsed.data;
}

export async function setSyncSessionSecrets(
  input: SyncSessionSecrets,
): Promise<SyncSessionSecrets> {
  const secrets = SyncSessionSecretsSchema.parse(input);
  await chrome.storage.session.set({ [SESSION_KEY]: secrets });
  return secrets;
}

export async function lockSync(): Promise<void> {
  await chrome.storage.session.remove(SESSION_KEY);
}

export async function disableSync(): Promise<void> {
  await Promise.all([
    chrome.storage.local.remove(CONFIG_KEY),
    chrome.storage.session.remove(SESSION_KEY),
  ]);
}

export function syncStatus(
  config: SyncLocalConfig | null,
  secrets: SyncSessionSecrets | null,
): SyncAccountStatus {
  if (!config) return { enabled: false, unlocked: false, datasets: [] };
  return {
    enabled: true,
    unlocked: Boolean(secrets),
    endpoint: config.endpoint,
    email: config.email,
    deviceId: config.deviceId,
    deviceName: config.deviceName,
    ...(config.lastSyncedAt ? { lastSyncedAt: config.lastSyncedAt } : {}),
    datasets: (Object.entries(config.revisions) as Array<[SyncDataset, number]>).map(
      ([dataset, revision]) => ({ dataset, revision }),
    ),
  };
}

export function newSyncConfig(input: {
  endpoint: string;
  email: string;
  deviceId: string;
  deviceName: string;
  kdf: SyncKdf;
}): SyncLocalConfig {
  return SyncLocalConfigSchema.parse({
    configVersion: 1,
    enabled: true,
    endpoint: input.endpoint,
    email: input.email,
    deviceId: input.deviceId,
    deviceName: input.deviceName,
    kdf: input.kdf,
    revisions: {},
  });
}
