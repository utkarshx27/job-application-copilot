import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { createPortalHarness } from "./dist-server/portal-server.mjs";

const root = resolve(import.meta.dirname, "dist");
const host = "127.0.0.1";
const port = 4173;
const harness = createPortalHarness(
  process.env.PORTAL_RUNNER_TOKEN ?? randomBytes(32).toString("hex"),
);
const runner = createServer((request, response) => void harness.handleRunner(request, response));
runner.listen(4174, host);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const server = createServer(async (request, response) => {
  if (await harness.handlePublic(request, response)) return;
  if (request.url === "/healthz") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("ok");
    return;
  }

  const pathname = new URL(request.url ?? "/", `http://${host}:${port}`).pathname;
  const requestedPath = resolve(root, pathname === "/" ? "index.html" : `.${pathname}`);

  if (requestedPath !== root && !requestedPath.startsWith(`${root}${sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await stat(requestedPath);
    if (!file.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "content-type": contentTypes[extname(requestedPath)] ?? "application/octet-stream",
      "cache-control": "no-store",
      ...(pathname.startsWith("/portal")
        ? {
            "content-security-policy":
              "default-src 'self'; script-src 'self'; style-src 'self'; frame-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none'",
          }
        : {}),
    });
    createReadStream(requestedPath).pipe(response);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Test ATS listening at http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    runner.close();
    server.close(() => process.exit(0));
  });
}
