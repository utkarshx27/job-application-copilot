import {
  EncryptedBackupSchema,
  SyncAccountStatusSchema,
  SyncDeviceSchema,
  SyncDevicesResultSchema,
  SyncKdfSchema,
  SyncRunResultSchema,
  SyncSessionSchema,
  VersionedSyncRecordSchema,
  createSyncKdf,
  decryptSyncDataset,
  deriveSyncSecrets,
  encryptSyncDataset,
  mergeSyncDataset,
  type SyncAccountStatus,
  type SyncDataset,
  type SyncDevice,
  type SyncLogin,
  type SyncRegistration,
  type VersionedSyncRecord,
} from "@copilot/sync-core";
import { z } from "zod";

import { getApplicationTracker, setApplicationTracker } from "./application-storage";
import { getProfileVault, setProfileVault } from "./profile-storage";
import {
  disableSync,
  getSyncConfig,
  getSyncSessionSecrets,
  lockSync,
  newSyncConfig,
  setSyncConfig,
  setSyncSessionSecrets,
  syncStatus,
  type SyncLocalConfig,
} from "./sync-storage";

const AuthResponseSchema = z.object({
  session: SyncSessionSchema,
  device: SyncDeviceSchema,
});
const ParametersResponseSchema = z.object({ kdf: SyncKdfSchema });
const AccountResponseSchema = z.object({
  accountId: z.string().min(1),
  email: z.email(),
  kdf: SyncKdfSchema,
  devices: z.array(SyncDeviceSchema),
  datasets: z.array(
    z.object({ dataset: z.enum(["PROFILE_VAULT", "APPLICATION_TRACKER"]), revision: z.number() }),
  ),
});
const DeletionResponseSchema = z.object({
  deleted: z.literal(true),
  deletedAt: z.iso.datetime({ offset: true }),
});

class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message: string,
  ) {
    super(message);
  }
}

function normalizeEndpoint(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("The sync endpoint cannot contain credentials, a query, or a fragment.");
  }
  const local =
    url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("Use HTTPS for sync, except for a local development server.");
  }
  return url.toString().replace(/\/$/, "");
}

async function requestJson(
  endpoint: string,
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<unknown> {
  const response = await fetch(`${endpoint}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // The status and generic message remain sufficient for a malformed server response.
  }
  if (!response.ok) {
    const code =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `HTTP_${response.status}`;
    throw new SyncHttpError(response.status, body, `Sync server rejected the request (${code}).`);
  }
  return body;
}

async function currentStatus(): Promise<SyncAccountStatus> {
  return SyncAccountStatusSchema.parse(
    syncStatus(await getSyncConfig(), await getSyncSessionSecrets()),
  );
}

async function requireUnlocked() {
  const [config, secrets] = await Promise.all([getSyncConfig(), getSyncSessionSecrets()]);
  if (!config) throw new Error("Optional cloud sync is not configured on this browser.");
  if (!secrets) throw new Error("Cloud sync is locked. Sign in again to unlock this session.");
  return { config, secrets };
}

async function localDataset(dataset: SyncDataset): Promise<unknown> {
  return dataset === "PROFILE_VAULT" ? getProfileVault() : getApplicationTracker();
}

async function storeLocalDataset(dataset: SyncDataset, value: unknown): Promise<void> {
  if (dataset === "PROFILE_VAULT") await setProfileVault(value);
  else await setApplicationTracker(value as Awaited<ReturnType<typeof getApplicationTracker>>);
}

async function putRecord(
  config: SyncLocalConfig,
  token: string,
  dataset: SyncDataset,
  baseRevision: number,
  value: unknown,
  encryptionKey: string,
): Promise<VersionedSyncRecord> {
  const envelope = await encryptSyncDataset(dataset, value, encryptionKey, config.deviceId);
  return VersionedSyncRecordSchema.parse(
    await requestJson(config.endpoint, `/v1/sync/${dataset}`, {
      method: "PUT",
      token,
      body: { baseRevision, envelope },
    }),
  );
}

async function syncOneDataset(
  config: SyncLocalConfig,
  token: string,
  encryptionKey: string,
  dataset: SyncDataset,
  preferRemote: boolean,
): Promise<{ revision: number; pushed: boolean; pulled: boolean; conflict: boolean }> {
  const local = await localDataset(dataset);
  let remoteRecord: VersionedSyncRecord | null = null;
  try {
    remoteRecord = VersionedSyncRecordSchema.parse(
      await requestJson(config.endpoint, `/v1/sync/${dataset}`, { token }),
    );
  } catch (error) {
    if (!(error instanceof SyncHttpError) || error.status !== 404) throw error;
  }
  if (!remoteRecord) {
    const written = await putRecord(config, token, dataset, 0, local, encryptionKey);
    return { revision: written.revision, pushed: true, pulled: false, conflict: false };
  }

  const remote = await decryptSyncDataset(remoteRecord.envelope, encryptionKey);
  const merged = preferRemote ? remote : mergeSyncDataset(dataset, local, remote);
  const pulled = JSON.stringify(local) !== JSON.stringify(merged);
  if (pulled) await storeLocalDataset(dataset, merged);
  if (JSON.stringify(remote) === JSON.stringify(merged)) {
    return { revision: remoteRecord.revision, pushed: false, pulled, conflict: false };
  }

  try {
    const written = await putRecord(
      config,
      token,
      dataset,
      remoteRecord.revision,
      merged,
      encryptionKey,
    );
    return { revision: written.revision, pushed: true, pulled, conflict: false };
  } catch (error) {
    if (!(error instanceof SyncHttpError) || error.status !== 409) throw error;
    const conflictBody = z
      .object({ error: z.literal("REVISION_CONFLICT"), current: VersionedSyncRecordSchema })
      .parse(error.body);
    const currentRemote = await decryptSyncDataset(conflictBody.current.envelope, encryptionKey);
    const resolved = mergeSyncDataset(dataset, merged, currentRemote);
    await storeLocalDataset(dataset, resolved);
    const written = await putRecord(
      config,
      token,
      dataset,
      conflictBody.current.revision,
      resolved,
      encryptionKey,
    );
    return { revision: written.revision, pushed: true, pulled: true, conflict: true };
  }
}

async function runSync(preferRemote = false) {
  const { config, secrets } = await requireUnlocked();
  const datasets: SyncDataset[] = ["PROFILE_VAULT", "APPLICATION_TRACKER"];
  const results = [];
  for (const dataset of datasets) {
    results.push({
      dataset,
      ...(await syncOneDataset(
        config,
        secrets.session.token,
        secrets.encryptionKey,
        dataset,
        preferRemote,
      )),
    });
  }
  const lastSyncedAt = new Date().toISOString();
  const updatedConfig = await setSyncConfig({
    ...config,
    lastSyncedAt,
    revisions: Object.fromEntries(results.map((result) => [result.dataset, result.revision])),
  });
  return SyncRunResultSchema.parse({
    status: syncStatus(updatedConfig, secrets),
    pushed: results.filter((result) => result.pushed).map((result) => result.dataset),
    pulled: results.filter((result) => result.pulled).map((result) => result.dataset),
    conflictsResolved: results.filter((result) => result.conflict).map((result) => result.dataset),
  });
}

export async function getOptionalSyncStatus(): Promise<SyncAccountStatus> {
  return currentStatus();
}

export async function registerOptionalSync(input: SyncRegistration) {
  const endpoint = normalizeEndpoint(input.endpoint);
  const kdf = createSyncKdf();
  const secrets = await deriveSyncSecrets(input.passphrase, kdf);
  const response = AuthResponseSchema.parse(
    await requestJson(endpoint, "/v1/auth/register", {
      method: "POST",
      body: {
        email: input.email,
        authSecret: secrets.authSecret,
        kdf,
        deviceName: input.deviceName,
      },
    }),
  );
  const config = await setSyncConfig(
    newSyncConfig({
      endpoint,
      email: input.email.trim().toLocaleLowerCase(),
      deviceId: response.session.deviceId,
      deviceName: input.deviceName,
      kdf,
    }),
  );
  await setSyncSessionSecrets({ session: response.session, encryptionKey: secrets.encryptionKey });
  try {
    return await runSync(false);
  } catch (error) {
    await setSyncConfig(config);
    throw error;
  }
}

export async function loginOptionalSync(input: SyncLogin) {
  const endpoint = normalizeEndpoint(input.endpoint);
  const parameters = ParametersResponseSchema.parse(
    await requestJson(endpoint, `/v1/auth/parameters?email=${encodeURIComponent(input.email)}`),
  );
  const secrets = await deriveSyncSecrets(input.passphrase, parameters.kdf);
  const response = AuthResponseSchema.parse(
    await requestJson(endpoint, "/v1/auth/login", {
      method: "POST",
      body: {
        email: input.email,
        authSecret: secrets.authSecret,
        deviceName: input.deviceName,
      },
    }),
  );
  await setSyncConfig(
    newSyncConfig({
      endpoint,
      email: input.email.trim().toLocaleLowerCase(),
      deviceId: response.session.deviceId,
      deviceName: input.deviceName,
      kdf: parameters.kdf,
    }),
  );
  await setSyncSessionSecrets({ session: response.session, encryptionKey: secrets.encryptionKey });
  return runSync(true);
}

export async function runOptionalSync() {
  return runSync(false);
}

export async function listSyncDevices(): Promise<{ devices: SyncDevice[] }> {
  const { config, secrets } = await requireUnlocked();
  return SyncDevicesResultSchema.parse(
    await requestJson(config.endpoint, "/v1/devices", { token: secrets.session.token }),
  );
}

export async function revokeSyncDevice(deviceId: string): Promise<{ devices: SyncDevice[] }> {
  const { config, secrets } = await requireUnlocked();
  if (deviceId === config.deviceId) throw new Error("The current device cannot revoke itself.");
  await requestJson(config.endpoint, `/v1/devices/${encodeURIComponent(deviceId)}`, {
    method: "DELETE",
    token: secrets.session.token,
  });
  return listSyncDevices();
}

export async function exportEncryptedSyncBackup(): Promise<{
  backupJson: string;
  encrypted: true;
}> {
  const { config, secrets } = await requireUnlocked();
  const backup = EncryptedBackupSchema.parse(
    await requestJson(config.endpoint, "/v1/backup", { token: secrets.session.token }),
  );
  return { backupJson: JSON.stringify(backup, null, 2), encrypted: true };
}

export async function lockOptionalSync(): Promise<SyncAccountStatus> {
  await lockSync();
  return currentStatus();
}

export async function disableOptionalSync(): Promise<SyncAccountStatus> {
  await disableSync();
  return currentStatus();
}

export async function deleteOptionalSyncAccount() {
  const { config, secrets } = await requireUnlocked();
  const result = DeletionResponseSchema.parse(
    await requestJson(config.endpoint, "/v1/account", {
      method: "DELETE",
      token: secrets.session.token,
    }),
  );
  await disableSync();
  return result;
}

export async function verifySyncAccount(): Promise<SyncAccountStatus> {
  const { config, secrets } = await requireUnlocked();
  const account = AccountResponseSchema.parse(
    await requestJson(config.endpoint, "/v1/account", { token: secrets.session.token }),
  );
  return SyncAccountStatusSchema.parse({
    ...syncStatus(config, secrets),
    datasets: account.datasets,
  });
}
