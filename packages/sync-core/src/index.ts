import {
  ApplicationTrackerSchema,
  type ApplicationRecord,
  type ApplicationTracker,
} from "@copilot/job-schema";
import { ProfileVaultSchema, type ProfileVault } from "@copilot/profile-core";
import { z } from "zod";

const ISODateTimeSchema = z.iso.datetime({ offset: true });
const Base64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);

export const SYNC_KDF_ITERATIONS = 600_000;
export const SyncDatasetSchema = z.enum(["PROFILE_VAULT", "APPLICATION_TRACKER"]);

export const SyncKdfSchema = z.object({
  name: z.literal("PBKDF2-HMAC-SHA256"),
  salt: Base64UrlSchema,
  iterations: z.number().int().min(100_000).max(2_000_000),
});

export const EncryptedSyncEnvelopeSchema = z.object({
  envelopeVersion: z.literal(1),
  dataset: SyncDatasetSchema,
  encryption: z.literal("AES-256-GCM"),
  iv: Base64UrlSchema,
  ciphertext: Base64UrlSchema,
  deviceId: z.string().min(1),
  updatedAt: ISODateTimeSchema,
});

export const VersionedSyncRecordSchema = z.object({
  revision: z.number().int().positive(),
  envelope: EncryptedSyncEnvelopeSchema,
});

export const SyncDeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  createdAt: ISODateTimeSchema,
  lastSeenAt: ISODateTimeSchema,
  revokedAt: ISODateTimeSchema.optional(),
  current: z.boolean().optional(),
});

export const SyncAccountStatusSchema = z.object({
  enabled: z.boolean(),
  unlocked: z.boolean(),
  endpoint: z.url().optional(),
  email: z.email().optional(),
  deviceId: z.string().min(1).optional(),
  deviceName: z.string().min(1).optional(),
  lastSyncedAt: ISODateTimeSchema.optional(),
  datasets: z
    .array(
      z.object({
        dataset: SyncDatasetSchema,
        revision: z.number().int().nonnegative(),
      }),
    )
    .default([]),
});

export const SyncRunResultSchema = z.object({
  status: SyncAccountStatusSchema,
  pushed: z.array(SyncDatasetSchema),
  pulled: z.array(SyncDatasetSchema),
  conflictsResolved: z.array(SyncDatasetSchema),
});

export const SyncDevicesResultSchema = z.object({ devices: z.array(SyncDeviceSchema) });

export const SyncBackupResultSchema = z.object({
  backupJson: z.string().min(1),
  encrypted: z.literal(true),
});

export const SyncDeletionResultSchema = z.object({
  deleted: z.literal(true),
  deletedAt: ISODateTimeSchema,
});

export const SyncRegistrationSchema = z.object({
  endpoint: z.url(),
  email: z.email(),
  passphrase: z.string().min(12).max(1024),
  deviceName: z.string().trim().min(1).max(100),
});

export const SyncLoginSchema = SyncRegistrationSchema;

export const SyncSessionSchema = z.object({
  token: Base64UrlSchema,
  accountId: z.string().min(1),
  deviceId: z.string().min(1),
  expiresAt: ISODateTimeSchema,
});

export const EncryptedBackupSchema = z.object({
  format: z.literal("job-application-copilot-encrypted-sync"),
  backupVersion: z.literal(1),
  exportedAt: ISODateTimeSchema,
  kdf: SyncKdfSchema,
  records: z.array(VersionedSyncRecordSchema),
});

export type SyncDataset = z.infer<typeof SyncDatasetSchema>;
export type SyncKdf = z.infer<typeof SyncKdfSchema>;
export type EncryptedSyncEnvelope = z.infer<typeof EncryptedSyncEnvelopeSchema>;
export type VersionedSyncRecord = z.infer<typeof VersionedSyncRecordSchema>;
export type SyncDevice = z.infer<typeof SyncDeviceSchema>;
export type SyncAccountStatus = z.infer<typeof SyncAccountStatusSchema>;
export type SyncRunResult = z.infer<typeof SyncRunResultSchema>;
export type SyncDevicesResult = z.infer<typeof SyncDevicesResultSchema>;
export type SyncBackupResult = z.infer<typeof SyncBackupResultSchema>;
export type SyncDeletionResult = z.infer<typeof SyncDeletionResultSchema>;
export type SyncRegistration = z.infer<typeof SyncRegistrationSchema>;
export type SyncLogin = z.infer<typeof SyncLoginSchema>;
export type SyncSession = z.infer<typeof SyncSessionSchema>;
export type EncryptedBackup = z.infer<typeof EncryptedBackupSchema>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export function randomBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function createSyncKdf(): SyncKdf {
  return SyncKdfSchema.parse({
    name: "PBKDF2-HMAC-SHA256",
    salt: randomBase64Url(16),
    iterations: SYNC_KDF_ITERATIONS,
  });
}

export async function deriveSyncSecrets(
  passphrase: string,
  kdfInput: SyncKdf,
): Promise<{ authSecret: string; encryptionKey: string }> {
  if (passphrase.length < 12 || passphrase.length > 1024) {
    throw new Error("Sync passphrases must be between 12 and 1024 characters.");
  }
  const kdf = SyncKdfSchema.parse(kdfInput);
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: base64UrlToBytes(kdf.salt),
        iterations: kdf.iterations,
      },
      material,
      512,
    ),
  );
  return {
    authSecret: bytesToBase64Url(bits.slice(0, 32)),
    encryptionKey: bytesToBase64Url(bits.slice(32, 64)),
  };
}

function additionalData(dataset: SyncDataset): Uint8Array<ArrayBuffer> {
  const encoded = encoder.encode(`job-application-copilot:sync:v1:${dataset}`);
  const bytes = new Uint8Array(encoded.byteLength);
  bytes.set(encoded);
  return bytes;
}

async function importAesKey(rawKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    base64UrlToBytes(Base64UrlSchema.parse(rawKey)),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function parseDataset(dataset: SyncDataset, input: unknown): unknown {
  return dataset === "PROFILE_VAULT"
    ? ProfileVaultSchema.parse(input)
    : ApplicationTrackerSchema.parse(input);
}

export async function encryptSyncDataset(
  datasetInput: SyncDataset,
  input: unknown,
  encryptionKey: string,
  deviceId: string,
  now = new Date().toISOString(),
): Promise<EncryptedSyncEnvelope> {
  const dataset = SyncDatasetSchema.parse(datasetInput);
  const plaintext = encoder.encode(JSON.stringify(parseDataset(dataset, input)));
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(dataset), tagLength: 128 },
    await importAesKey(encryptionKey),
    plaintext,
  );
  return EncryptedSyncEnvelopeSchema.parse({
    envelopeVersion: 1,
    dataset,
    encryption: "AES-256-GCM",
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    deviceId,
    updatedAt: now,
  });
}

export async function decryptSyncDataset(
  envelopeInput: EncryptedSyncEnvelope,
  encryptionKey: string,
): Promise<unknown> {
  const envelope = EncryptedSyncEnvelopeSchema.parse(envelopeInput);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlToBytes(envelope.iv),
        additionalData: additionalData(envelope.dataset),
        tagLength: 128,
      },
      await importAesKey(encryptionKey),
      base64UrlToBytes(envelope.ciphertext),
    );
  } catch {
    throw new Error("The encrypted sync record could not be authenticated or decrypted.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(decoder.decode(plaintext));
  } catch {
    throw new Error("The decrypted sync record is not valid JSON.");
  }
  return parseDataset(envelope.dataset, decoded);
}

function later(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function uniqueById<T extends { id: string }>(values: T[]): T[] {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

function uniqueProfileVersions<T extends { id: string; profileVersion: number }>(values: T[]): T[] {
  return [
    ...new Map(values.map((value) => [`${value.id}:${value.profileVersion}`, value])).values(),
  ];
}

export function mergeProfileVaults(localInput: unknown, remoteInput: unknown): ProfileVault {
  const local = ProfileVaultSchema.parse(localInput);
  const remote = ProfileVaultSchema.parse(remoteInput);
  if (local.id !== remote.id) {
    throw new Error("Sync refused to merge profile vaults with different identities.");
  }
  const localWins = Date.parse(local.updatedAt) >= Date.parse(remote.updatedAt);
  const winner = localWins ? local : remote;
  const loser = localWins ? remote : local;
  if (winner.vaultSchemaVersion === 1 && loser.vaultSchemaVersion === 2) {
    throw new Error(
      "A newer legacy profile cannot replace career setup. Update every device, review and save the version 2 profile, then sync again.",
    );
  }
  const history = uniqueProfileVersions([
    ...winner.history,
    ...loser.history,
    ...(winner.currentProfile.id === loser.currentProfile.id ? [loser.currentProfile] : []),
  ]).filter(
    (profile) =>
      profile.id !== winner.currentProfile.id ||
      profile.profileVersion !== winner.currentProfile.profileVersion,
  );
  return ProfileVaultSchema.parse({
    ...winner,
    vaultSchemaVersion: Math.max(local.vaultSchemaVersion, remote.vaultSchemaVersion),
    createdAt:
      Date.parse(local.createdAt) <= Date.parse(remote.createdAt)
        ? local.createdAt
        : remote.createdAt,
    updatedAt: later(local.updatedAt, remote.updatedAt),
    history: history.slice(-100),
    sources: uniqueById([...local.sources, ...remote.sources]),
    conflicts: uniqueById([...local.conflicts, ...remote.conflicts]),
  });
}

function mergeApplicationRecord(
  local: ApplicationRecord | undefined,
  remote: ApplicationRecord | undefined,
): ApplicationRecord {
  if (!local) return remote!;
  if (!remote) return local;
  const winner = Date.parse(local.updatedAt) >= Date.parse(remote.updatedAt) ? local : remote;
  return {
    ...winner,
    snapshots: [
      ...new Map(
        [...local.snapshots, ...remote.snapshots].map((snapshot) => [
          snapshot.snapshotId,
          snapshot,
        ]),
      ).values(),
    ]
      .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt))
      .slice(-50),
  };
}

export function mergeApplicationTrackers(
  localInput: unknown,
  remoteInput: unknown,
): ApplicationTracker {
  const local = ApplicationTrackerSchema.parse(localInput);
  const remote = ApplicationTrackerSchema.parse(remoteInput);
  const ids = new Set([
    ...local.applications.map((application) => application.id),
    ...remote.applications.map((application) => application.id),
  ]);
  return ApplicationTrackerSchema.parse({
    trackerVersion: 2,
    updatedAt: later(local.updatedAt, remote.updatedAt),
    applications: [...ids]
      .map((id) =>
        mergeApplicationRecord(
          local.applications.find((application) => application.id === id),
          remote.applications.find((application) => application.id === id),
        ),
      )
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)),
  });
}

export function mergeSyncDataset(dataset: SyncDataset, local: unknown, remote: unknown): unknown {
  return dataset === "PROFILE_VAULT"
    ? mergeProfileVaults(local, remote)
    : mergeApplicationTrackers(local, remote);
}
