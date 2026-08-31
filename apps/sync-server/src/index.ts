import { resolve } from "node:path";

import { buildSyncServer } from "./server";
import { JsonFileSyncStore } from "./store";

const port = Number.parseInt(process.env["SYNC_PORT"] ?? "8787", 10);
const host = process.env["SYNC_HOST"] ?? "127.0.0.1";
const stateFile = resolve(process.env["SYNC_DATA_FILE"] ?? ".tmp/sync-server/state.json");
const allowedOrigins = (process.env["SYNC_ALLOWED_ORIGINS"] ?? "http://127.0.0.1:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const server = await buildSyncServer({
  store: new JsonFileSyncStore(stateFile),
  allowedOrigins,
});

await server.listen({ port, host });
console.log(`Sync server listening on http://${host}:${port}`);
