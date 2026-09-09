import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  companies,
  listings,
  portalScenarios,
  publicScenario,
  SYNTHETIC_CANDIDATE,
  SYNTHETIC_RESUME,
  type Scenario,
} from "./portal-catalog";

type Session = {
  id: string;
  scenarioId: string;
  jobId: string;
  stage: "STARTED" | "REVIEW" | "ACCEPTED";
  values: Record<string, string>;
  uploadId: string | null;
  attempts: number;
  validations: number;
};
type Outcome = {
  applicationId: string;
  jobId: string;
  scenarioId: string;
  correct: boolean;
  acceptedCount: number;
  duplicateAttempts: number;
  uploadRetained: boolean;
};
function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const raw of request) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as string);
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request too large");
    chunks.push(chunk);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid request");
  return parsed as Record<string, unknown>;
}
const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

export function createPortalHarness(token: string, initialSeed = 7) {
  if (token.length < 32) throw new Error("Runner token must be at least 32 characters");
  let seed = initialSeed;
  let scenarios = portalScenarios(seed);
  const sessions = new Map<string, Session>();
  const uploads = new Map<string, { applicationId: string; bytes: Buffer }>();
  const outcomes = new Map<string, Outcome>();
  const validHost = (request: IncomingMessage) =>
    /^127\.0\.0\.1:(4173|4174)$/.test(request.headers.host ?? "");

  function errors(
    scenario: Scenario,
    values: Record<string, string>,
    uploadId: string | null,
    applicationId: string,
  ): string[] {
    const missing = scenario.fields
      .filter(
        (field) =>
          field.required &&
          (field.kind === "file"
            ? !uploadId || uploads.get(uploadId)?.applicationId !== applicationId
            : !values[field.key]?.trim()),
      )
      .map((field) => field.label);
    if (scenario.repeatHistory && !values.employer?.trim()) missing.push("Employer");
    if (scenario.repeatHistory && "previousEmployer" in values && !values.previousEmployer?.trim())
      missing.push("Previous employer");
    for (const field of scenario.fields) {
      if (
        field.kind === "email" &&
        values[field.key] &&
        !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values[field.key] ?? "")
      )
        missing.push(`${field.label}: invalid email`);
      if (
        field.kind === "number" &&
        values[field.key] &&
        (!Number.isFinite(Number(values[field.key])) || Number(values[field.key]) < 0)
      )
        missing.push(`${field.label}: invalid number`);
      if (field.options && values[field.key] && !field.options.includes(values[field.key] ?? ""))
        missing.push(`${field.label}: invalid option`);
    }
    return missing;
  }

  async function handlePublic(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1:4173");
    if (!url.pathname.startsWith("/api/portal/")) return false;
    if (
      !validHost(request) ||
      (request.headers.origin && request.headers.origin !== "http://127.0.0.1:4173")
    ) {
      json(response, 403, { error: "Origin denied" });
      return true;
    }
    try {
      if (request.method === "GET" && url.pathname === "/api/portal/scenarios") {
        json(response, 200, scenarios.map(publicScenario));
        return true;
      }
      if (request.method === "GET" && url.pathname === "/api/portal/jobs") {
        const query = (url.searchParams.get("q") ?? "").toLowerCase();
        const page = Math.max(0, Math.min(10, Number(url.searchParams.get("page")) || 0));
        const jobs = listings(seed).filter((job) =>
          `${job.title} ${job.company} ${job.location}`.toLowerCase().includes(query),
        );
        json(response, 200, {
          jobs: jobs.slice(page * 3, page * 3 + 3),
          hasMore: jobs.length > (page + 1) * 3,
        });
        return true;
      }
      if (request.method === "GET" && url.pathname === "/api/portal/companies") {
        json(response, 200, companies);
        return true;
      }
      const requestedJob = /^\/api\/portal\/jobs\/(job-\d+-\d+)$/.exec(url.pathname);
      if (request.method === "GET" && requestedJob) {
        const job = listings(seed).find((entry) => entry.id === requestedJob[1]);
        json(response, job ? 200 : 404, job ?? { error: "Job unavailable" });
        return true;
      }
      if (request.method === "POST" && url.pathname === "/api/portal/start") {
        const input = await body(request);
        const scenario = scenarios.find((item) => item.publicId === input.scenarioId);
        const job = listings(seed).find((item) => item.id === input.jobId);
        if (
          !scenario ||
          !job ||
          job.expired ||
          !job.destination ||
          scenario.evidenceOnly ||
          scenario.fault === "EXTERNAL_HANDOFF"
        ) {
          json(response, 409, { error: "Application unavailable" });
          return true;
        }
        if (scenario.access !== "AVAILABLE") {
          json(response, 403, { error: scenario.access });
          return true;
        }
        if (sessions.size >= 200) {
          json(response, 429, { error: "Reset the test run before continuing" });
          return true;
        }
        const existing = [...sessions.values()].find(
          (item) => item.scenarioId === scenario.id && item.jobId === job.id,
        );
        if (existing) {
          json(response, 200, { applicationId: existing.id, jobId: existing.jobId });
          return true;
        }
        const session: Session = {
          id: randomUUID(),
          scenarioId: scenario.id,
          jobId: job.id,
          stage: "STARTED",
          values: {},
          uploadId: null,
          attempts: 0,
          validations: 0,
        };
        sessions.set(session.id, session);
        json(response, 201, { applicationId: session.id, jobId: session.jobId });
        return true;
      }
      const match =
        /^\/api\/portal\/applications\/([a-f0-9-]{36})\/(upload|review|submit|receipt)$/.exec(
          url.pathname,
        );
      const session = match?.[1] ? sessions.get(match[1]) : undefined;
      const scenario = session && scenarios.find((item) => item.id === session.scenarioId);
      if (!session || !scenario || !match) {
        json(response, 404, { error: "Not found" });
        return true;
      }
      const action = match[2];
      if (request.method === "GET" && action === "receipt") {
        json(
          response,
          outcomes.has(session.id) ? 200 : 404,
          outcomes.has(session.id)
            ? { applicationId: session.id, jobId: session.jobId, status: "ACCEPTED" }
            : { error: "No receipt" },
        );
        return true;
      }
      if (request.method !== "POST") {
        json(response, 405, { error: "Method not allowed" });
        return true;
      }
      if (action === "upload") {
        const input = await body(request);
        if (
          session.stage === "ACCEPTED" ||
          typeof input.content !== "string" ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(input.content)
        ) {
          json(response, 400, { error: "Invalid upload" });
          return true;
        }
        const bytes = Buffer.from(input.content, "base64");
        const uploadId = randomUUID();
        if (!bytes.length || bytes.length > 500_000) {
          json(response, 413, { error: "Upload size limit" });
          return true;
        }
        if (session.uploadId) uploads.delete(session.uploadId);
        uploads.set(uploadId, { applicationId: session.id, bytes });
        session.uploadId = uploadId;
        if (session.stage === "REVIEW") session.stage = "STARTED";
        json(response, 201, { uploadId, sha256: sha(bytes), size: bytes.length });
        return true;
      }
      if (action === "review") {
        if (scenario.fault === "SESSION_EXPIRED") {
          json(response, 401, { error: "Your session expired. Sign in to continue." });
          return true;
        }
        if (session.stage === "ACCEPTED") {
          json(response, 409, { error: "Already accepted" });
          return true;
        }
        const input = await body(request);
        if (!input.values || typeof input.values !== "object" || Array.isArray(input.values)) {
          json(response, 400, { error: "Invalid values" });
          return true;
        }
        const entries = Object.entries(input.values as Record<string, unknown>);
        const allowed = new Set([
          ...scenario.fields.filter((field) => field.kind !== "file").map((field) => field.key),
          ...(scenario.repeatHistory ? ["employer", "previousEmployer"] : []),
        ]);
        if (
          entries.some(
            ([key, value]) => !allowed.has(key) || typeof value !== "string" || value.length > 5000,
          )
        ) {
          json(response, 400, { error: "Unknown field or invalid value" });
          return true;
        }
        const values = Object.fromEntries(entries) as Record<string, string>;
        const problems = errors(scenario, values, session.uploadId, session.id);
        session.validations++;
        if (scenario.fault === "VALIDATION" && session.validations === 1)
          problems.push("Please review your current city and try again");
        if (problems.length) {
          session.stage = "STARTED";
          json(response, 422, { errors: problems });
          return true;
        }
        session.values = values;
        session.stage = "REVIEW";
        json(response, 200, {
          applicationId: session.id,
          jobId: session.jobId,
          values: session.values,
          uploadRetained: !!session.uploadId,
        });
        return true;
      }
      if (action === "submit") {
        const input = await body(request);
        if (input.consent !== true) {
          json(response, 400, { error: "Confirm the reviewed application first" });
          return true;
        }
        session.attempts++;
        const existing = outcomes.get(session.id);
        if (existing) {
          existing.duplicateAttempts++;
          json(response, 409, { error: "Already accepted", applicationId: session.id });
          return true;
        }
        if (session.stage !== "REVIEW") {
          json(response, 409, { error: "Review required" });
          return true;
        }
        if (scenario.fault === "FALSE_CONFIRMATION") {
          json(response, 200, {
            applicationId: session.id,
            jobId: session.jobId,
            status: "ACCEPTED",
          });
          return true;
        }
        const retained = session.uploadId ? uploads.get(session.uploadId) : undefined;
        const keys = scenario.fields
          .filter((field) => field.kind !== "file")
          .map((field) => field.key);
        if (scenario.repeatHistory) keys.push("employer");
        for (const key of Object.keys(session.values)) if (!keys.includes(key)) keys.push(key);
        const expected = SYNTHETIC_CANDIDATE as Record<string, string>;
        const correct =
          keys.every((key) => session.values[key] === expected[key]) &&
          (!scenario.fields.some((field) => field.kind === "file") ||
            (!!retained && sha(retained.bytes) === sha(SYNTHETIC_RESUME)));
        outcomes.set(session.id, {
          applicationId: session.id,
          jobId: session.jobId,
          scenarioId: scenario.id,
          correct,
          acceptedCount: 1,
          duplicateAttempts: 0,
          uploadRetained: !!retained,
        });
        session.stage = "ACCEPTED";
        if (scenario.fault === "LOST_RESPONSE") {
          // Deliver headers and a partial body before dropping the response. A
          // socket closed before headers can be transparently retried by Chrome.
          response.writeHead(201, { "content-type": "application/json", "content-length": "100" });
          response.write("{");
          setTimeout(() => response.destroy(), 10);
          return true;
        }
        json(response, 201, {
          applicationId: scenario.fault === "WRONG_CONFIRMATION" ? randomUUID() : session.id,
          jobId: session.jobId,
          status: "ACCEPTED",
        });
        return true;
      }
      json(response, 404, { error: "Not found" });
      return true;
    } catch {
      json(response, 400, { error: "Invalid request" });
      return true;
    }
  }

  async function handleRunner(request: IncomingMessage, response: ServerResponse) {
    const presented = Buffer.from(request.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${token}`);
    if (
      !validHost(request) ||
      request.headers.origin ||
      presented.length !== expected.length ||
      !timingSafeEqual(presented, expected)
    ) {
      json(response, 403, { error: "Runner access denied" });
      return;
    }
    try {
      if (request.method === "POST" && request.url === "/reset") {
        const input = await body(request);
        if (
          typeof input.seed !== "number" ||
          !Number.isSafeInteger(input.seed) ||
          input.seed < 0 ||
          input.seed > 10000
        ) {
          json(response, 400, { error: "Invalid seed" });
          return;
        }
        seed = input.seed;
        scenarios = portalScenarios(seed);
        sessions.clear();
        uploads.clear();
        outcomes.clear();
        json(response, 200, { seed });
        return;
      }
      if (request.method === "GET" && request.url === "/outcomes") {
        json(response, 200, {
          outcomes: [...outcomes.values()],
          sessions: [...sessions.values()].map(({ id, scenarioId, jobId, stage, attempts }) => ({
            id,
            scenarioId,
            jobId,
            stage,
            attempts,
          })),
        });
        return;
      }
      if (request.method === "GET" && request.url === "/fixtures") {
        json(response, 200, {
          candidate: SYNTHETIC_CANDIDATE,
          resume: SYNTHETIC_RESUME,
          scenarios: scenarios.map((item) => ({
            id: item.id,
            publicId: item.publicId,
            fault: item.fault,
            mode: item.mode,
            access: item.access,
            evidenceOnly: item.evidenceOnly,
          })),
        });
        return;
      }
      json(response, 404, { error: "Not found" });
    } catch {
      json(response, 400, { error: "Invalid runner request" });
    }
  }
  return { handlePublic, handleRunner };
}
