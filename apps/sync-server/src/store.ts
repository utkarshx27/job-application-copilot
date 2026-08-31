import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  EncryptedSyncEnvelopeSchema,
  SyncKdfSchema,
  type EncryptedSyncEnvelope,
  type SyncDataset,
} from "@copilot/sync-core";
import { z } from "zod";

const ISODateTimeSchema = z.iso.datetime({ offset: true });

export const StoredDeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  createdAt: ISODateTimeSchema,
  lastSeenAt: ISODateTimeSchema,
  revokedAt: ISODateTimeSchema.optional(),
});

export const StoredRecordSchema = z.object({
  revision: z.number().int().positive(),
  envelope: EncryptedSyncEnvelopeSchema,
});

export const StoredAccountSchema = z.object({
  id: z.string().min(1),
  email: z.email(),
  kdf: SyncKdfSchema,
  authSecretHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: ISODateTimeSchema,
  devices: z.array(StoredDeviceSchema),
  records: z.partialRecord(z.enum(["PROFILE_VAULT", "APPLICATION_TRACKER"]), StoredRecordSchema),
});

export const StoredSessionSchema = z.object({
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  accountId: z.string().min(1),
  deviceId: z.string().min(1),
  createdAt: ISODateTimeSchema,
  expiresAt: ISODateTimeSchema,
});

export const SyncStoreStateSchema = z.object({
  storeVersion: z.literal(1),
  accounts: z.array(StoredAccountSchema),
  sessions: z.array(StoredSessionSchema),
});

export type StoredDevice = z.infer<typeof StoredDeviceSchema>;
export type StoredRecord = z.infer<typeof StoredRecordSchema>;
export type StoredAccount = z.infer<typeof StoredAccountSchema>;
export type StoredSession = z.infer<typeof StoredSessionSchema>;
export type SyncStoreState = z.infer<typeof SyncStoreStateSchema>;

export interface SyncStore {
  read(): Promise<SyncStoreState>;
  update(mutator: (state: SyncStoreState) => void): Promise<SyncStoreState>;
}

function emptyState(): SyncStoreState {
  return { storeVersion: 1, accounts: [], sessions: [] };
}

export class MemorySyncStore implements SyncStore {
  private state: SyncStoreState;

  constructor(initial: SyncStoreState = emptyState()) {
    this.state = SyncStoreStateSchema.parse(structuredClone(initial));
  }

  read(): Promise<SyncStoreState> {
    return Promise.resolve(structuredClone(this.state));
  }

  update(mutator: (state: SyncStoreState) => void): Promise<SyncStoreState> {
    const next = structuredClone(this.state);
    mutator(next);
    this.state = SyncStoreStateSchema.parse(next);
    return Promise.resolve(structuredClone(this.state));
  }
}

export class JsonFileSyncStore implements SyncStore {
  private state: SyncStoreState | null = null;
  private queue = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private async load(): Promise<SyncStoreState> {
    if (this.state) return this.state;
    try {
      this.state = SyncStoreStateSchema.parse(JSON.parse(await readFile(this.filePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.state = emptyState();
    }
    return this.state;
  }

  async read(): Promise<SyncStoreState> {
    return structuredClone(await this.load());
  }

  async update(mutator: (state: SyncStoreState) => void): Promise<SyncStoreState> {
    let result = emptyState();
    this.queue = this.queue.then(async () => {
      const next = structuredClone(await this.load());
      mutator(next);
      this.state = SyncStoreStateSchema.parse(next);
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporaryPath, this.filePath);
      result = structuredClone(this.state);
    });
    await this.queue;
    return result;
  }
}

export function accountRecord(
  account: StoredAccount,
  dataset: SyncDataset,
): { revision: number; envelope: EncryptedSyncEnvelope } | undefined {
  return account.records[dataset];
}
