import { createEmptyTracker } from "@copilot/application-state";
import {
  SyncDevicesResultSchema,
  SyncKdfSchema,
  SyncSessionSchema,
  createSyncKdf,
  deriveSyncSecrets,
  encryptSyncDataset,
  type SyncSession,
} from "@copilot/sync-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { buildSyncServer } from "../src/server";
import { MemorySyncStore } from "../src/store";

const now = "2026-08-31T10:00:00.000Z";
const email = "sync-user@example.test";
const passphrase = "correct horse battery staple";

describe("sync server", () => {
  let app: Awaited<ReturnType<typeof buildSyncServer>>;
  let session: SyncSession;
  let encryptionKey: string;

  beforeEach(async () => {
    app = await buildSyncServer({ store: new MemorySyncStore(), now: () => now });
    const kdf = createSyncKdf();
    const secrets = await deriveSyncSecrets(passphrase, kdf);
    encryptionKey = secrets.encryptionKey;
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, authSecret: secrets.authSecret, kdf, deviceName: "Test laptop" },
    });
    expect(response.statusCode).toBe(201);
    session = z.object({ session: SyncSessionSchema }).parse(response.json()).session;
  });

  afterEach(async () => app.close());

  it("authenticates, writes encrypted records, and rejects stale revisions", async () => {
    const envelope = await encryptSyncDataset(
      "APPLICATION_TRACKER",
      createEmptyTracker(now),
      encryptionKey,
      session.deviceId,
      now,
    );
    const write = await app.inject({
      method: "PUT",
      url: "/v1/sync/APPLICATION_TRACKER",
      headers: { authorization: `Bearer ${session.token}` },
      payload: { baseRevision: 0, envelope },
    });
    expect(write.statusCode).toBe(200);
    expect(write.json()).toMatchObject({
      revision: 1,
      envelope: { ciphertext: envelope.ciphertext },
    });

    const conflict = await app.inject({
      method: "PUT",
      url: "/v1/sync/APPLICATION_TRACKER",
      headers: { authorization: `Bearer ${session.token}` },
      payload: { baseRevision: 0, envelope },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: "REVISION_CONFLICT", current: { revision: 1 } });
  });

  it("supports additional devices, revocation, encrypted backup, and account deletion", async () => {
    const parameters = await app.inject({
      method: "GET",
      url: `/v1/auth/parameters?email=${encodeURIComponent(email)}`,
    });
    const parametersBody = z.object({ kdf: SyncKdfSchema }).parse(parameters.json());
    const secrets = await deriveSyncSecrets(passphrase, parametersBody.kdf);
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email, authSecret: secrets.authSecret, deviceName: "Second device" },
    });
    const secondSession = z.object({ session: SyncSessionSchema }).parse(login.json()).session;
    const devices = await app.inject({
      method: "GET",
      url: "/v1/devices",
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(SyncDevicesResultSchema.parse(devices.json()).devices).toHaveLength(2);

    const revoked = await app.inject({
      method: "DELETE",
      url: `/v1/devices/${secondSession.deviceId}`,
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(revoked.statusCode).toBe(200);
    const rejected = await app.inject({
      method: "GET",
      url: "/v1/devices",
      headers: { authorization: `Bearer ${secondSession.token}` },
    });
    expect(rejected.statusCode).toBe(401);

    const backup = await app.inject({
      method: "GET",
      url: "/v1/backup",
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(backup.json()).toMatchObject({
      format: "job-application-copilot-encrypted-sync",
      records: [],
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(deleted.json()).toMatchObject({ deleted: true });
    const afterDelete = await app.inject({
      method: "GET",
      url: "/v1/devices",
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(afterDelete.statusCode).toBe(401);
  });
});
