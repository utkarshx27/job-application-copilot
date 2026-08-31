import { createHash, timingSafeEqual } from "node:crypto";

import cors from "@fastify/cors";
import {
  EncryptedBackupSchema,
  EncryptedSyncEnvelopeSchema,
  SyncDatasetSchema,
  SyncKdfSchema,
  SyncSessionSchema,
  randomBase64Url,
  type SyncDevice,
} from "@copilot/sync-core";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";

import {
  MemorySyncStore,
  accountRecord,
  type StoredAccount,
  type StoredSession,
  type SyncStore,
} from "./store";

const RegisterSchema = z.object({
  email: z.email(),
  authSecret: z.string().regex(/^[A-Za-z0-9_-]{40,}$/),
  kdf: SyncKdfSchema,
  deviceName: z.string().trim().min(1).max(100),
});
const LoginSchema = RegisterSchema.pick({ email: true, authSecret: true, deviceName: true });
const PutRecordSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  envelope: EncryptedSyncEnvelopeSchema,
});
const EmailQuerySchema = z.object({ email: z.email() });
const DatasetParamsSchema = z.object({ dataset: SyncDatasetSchema });
const DeviceParamsSchema = z.object({ deviceId: z.string().min(1) });
const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function equalHash(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase();
}

function publicDevice(
  device: StoredAccount["devices"][number],
  currentDeviceId: string,
): SyncDevice {
  return {
    ...device,
    ...(device.id === currentDeviceId ? { current: true } : {}),
  };
}

type AuthContext = { account: StoredAccount; session: StoredSession };

async function authenticate(
  request: FastifyRequest,
  store: SyncStore,
): Promise<AuthContext | null> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  const tokenHash = hash(token);
  const state = await store.read();
  const session = state.sessions.find((candidate) => equalHash(candidate.tokenHash, tokenHash));
  if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;
  const account = state.accounts.find((candidate) => candidate.id === session.accountId);
  const device = account?.devices.find((candidate) => candidate.id === session.deviceId);
  if (!account || !device || device.revokedAt) return null;
  return { account, session };
}

function sessionFor(accountId: string, deviceId: string, now: string) {
  const token = randomBase64Url(32);
  const expiresAt = new Date(Date.parse(now) + SESSION_LIFETIME_MS).toISOString();
  return {
    token,
    stored: { tokenHash: hash(token), accountId, deviceId, createdAt: now, expiresAt },
    response: SyncSessionSchema.parse({ token, accountId, deviceId, expiresAt }),
  };
}

export async function buildSyncServer(
  options: { store?: SyncStore; now?: () => string; allowedOrigins?: string[] } = {},
): Promise<FastifyInstance> {
  const store = options.store ?? new MemorySyncStore();
  const now = options.now ?? (() => new Date().toISOString());
  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 });
  const allowedOrigins = options.allowedOrigins ?? ["http://127.0.0.1:5173"];
  await app.register(cors, {
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    origin(origin, callback) {
      const allowed =
        !origin || origin.startsWith("chrome-extension://") || allowedOrigins.includes(origin);
      callback(allowed ? null : new Error("Origin is not allowed."), allowed);
    },
  });

  app.get("/health", () => ({ ok: true, service: "job-application-copilot-sync" }));

  app.get("/v1/auth/parameters", async (request, reply) => {
    const query = EmailQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    const account = (await store.read()).accounts.find(
      (candidate) => candidate.email === normalizeEmail(query.data.email),
    );
    if (!account) return reply.code(404).send({ error: "INVALID_CREDENTIALS" });
    return { kdf: account.kdf };
  });

  app.post("/v1/auth/register", async (request, reply) => {
    const input = RegisterSchema.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    const email = normalizeEmail(input.data.email);
    const state = await store.read();
    if (state.accounts.some((account) => account.email === email)) {
      return reply.code(409).send({ error: "ACCOUNT_EXISTS" });
    }
    const timestamp = now();
    const accountId = `account-${crypto.randomUUID()}`;
    const deviceId = `device-${crypto.randomUUID()}`;
    const session = sessionFor(accountId, deviceId, timestamp);
    await store.update((draft) => {
      draft.accounts.push({
        id: accountId,
        email,
        kdf: input.data.kdf,
        authSecretHash: hash(input.data.authSecret),
        createdAt: timestamp,
        devices: [
          {
            id: deviceId,
            name: input.data.deviceName,
            createdAt: timestamp,
            lastSeenAt: timestamp,
          },
        ],
        records: {},
      });
      draft.sessions.push(session.stored);
    });
    return reply.code(201).send({
      session: session.response,
      device: {
        id: deviceId,
        name: input.data.deviceName,
        createdAt: timestamp,
        lastSeenAt: timestamp,
      },
    });
  });

  app.post("/v1/auth/login", async (request, reply) => {
    const input = LoginSchema.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    const email = normalizeEmail(input.data.email);
    const account = (await store.read()).accounts.find((candidate) => candidate.email === email);
    if (!account || !equalHash(account.authSecretHash, hash(input.data.authSecret))) {
      return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
    }
    const timestamp = now();
    const deviceId = `device-${crypto.randomUUID()}`;
    const session = sessionFor(account.id, deviceId, timestamp);
    await store.update((draft) => {
      const stored = draft.accounts.find((candidate) => candidate.id === account.id)!;
      stored.devices.push({
        id: deviceId,
        name: input.data.deviceName,
        createdAt: timestamp,
        lastSeenAt: timestamp,
      });
      draft.sessions.push(session.stored);
    });
    return {
      session: session.response,
      device: {
        id: deviceId,
        name: input.data.deviceName,
        createdAt: timestamp,
        lastSeenAt: timestamp,
      },
    };
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/v1/") || request.url.startsWith("/v1/auth/")) return;
    const auth = await authenticate(request, store);
    if (!auth) return reply.code(401).send({ error: "UNAUTHORIZED" });
  });

  async function authFor(request: FastifyRequest): Promise<AuthContext> {
    const auth = await authenticate(request, store);
    if (!auth) throw new Error("Authenticated route reached without a valid session.");
    return auth;
  }

  app.get("/v1/account", async (request) => {
    const { account, session } = await authFor(request);
    return {
      accountId: account.id,
      email: account.email,
      kdf: account.kdf,
      devices: account.devices.map((device) => publicDevice(device, session.deviceId)),
      datasets: Object.entries(account.records).map(([dataset, record]) => ({
        dataset,
        revision: record.revision,
      })),
    };
  });

  app.get("/v1/devices", async (request) => {
    const { account, session } = await authFor(request);
    return { devices: account.devices.map((device) => publicDevice(device, session.deviceId)) };
  });

  app.delete("/v1/devices/:deviceId", async (request, reply) => {
    const params = DeviceParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    const { account, session } = await authFor(request);
    if (params.data.deviceId === session.deviceId) {
      return reply.code(409).send({ error: "CURRENT_DEVICE" });
    }
    const device = account.devices.find((candidate) => candidate.id === params.data.deviceId);
    if (!device) return reply.code(404).send({ error: "DEVICE_NOT_FOUND" });
    const timestamp = now();
    await store.update((draft) => {
      const stored = draft.accounts.find((candidate) => candidate.id === account.id)!;
      const storedDevice = stored.devices.find(
        (candidate) => candidate.id === params.data.deviceId,
      )!;
      storedDevice.revokedAt = timestamp;
      draft.sessions = draft.sessions.filter(
        (candidate) =>
          !(candidate.accountId === account.id && candidate.deviceId === params.data.deviceId),
      );
    });
    return { revokedAt: timestamp };
  });

  app.get("/v1/sync/:dataset", async (request, reply) => {
    const params = DatasetParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_DATASET" });
    const { account } = await authFor(request);
    const record = accountRecord(account, params.data.dataset);
    if (!record) return reply.code(404).send({ error: "RECORD_NOT_FOUND" });
    return record;
  });

  app.put("/v1/sync/:dataset", async (request, reply) => {
    const params = DatasetParamsSchema.safeParse(request.params);
    const input = PutRecordSchema.safeParse(request.body);
    if (!params.success || !input.success)
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    const { account, session } = await authFor(request);
    if (
      input.data.envelope.dataset !== params.data.dataset ||
      input.data.envelope.deviceId !== session.deviceId
    ) {
      return reply.code(400).send({ error: "ENVELOPE_CONTEXT_MISMATCH" });
    }
    const existing = accountRecord(account, params.data.dataset);
    const currentRevision = existing?.revision ?? 0;
    if (input.data.baseRevision !== currentRevision) {
      return reply.code(409).send({ error: "REVISION_CONFLICT", current: existing });
    }
    const revision = currentRevision + 1;
    await store.update((draft) => {
      const stored = draft.accounts.find((candidate) => candidate.id === account.id)!;
      stored.records[params.data.dataset] = { revision, envelope: input.data.envelope };
      const device = stored.devices.find((candidate) => candidate.id === session.deviceId)!;
      device.lastSeenAt = now();
    });
    return { revision, envelope: input.data.envelope };
  });

  app.get("/v1/backup", async (request) => {
    const { account } = await authFor(request);
    return EncryptedBackupSchema.parse({
      format: "job-application-copilot-encrypted-sync",
      backupVersion: 1,
      exportedAt: now(),
      kdf: account.kdf,
      records: Object.values(account.records),
    });
  });

  app.delete("/v1/account", async (request) => {
    const { account } = await authFor(request);
    await store.update((draft) => {
      draft.accounts = draft.accounts.filter((candidate) => candidate.id !== account.id);
      draft.sessions = draft.sessions.filter((candidate) => candidate.accountId !== account.id);
    });
    return { deleted: true, deletedAt: now() };
  });

  return app;
}
