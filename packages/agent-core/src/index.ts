import { z } from "zod";
import { isPreparationExecutionUrl } from "./local-portal-url";
export * from "./local-portal-url";
export * from "./feedback-memory";
export * from "./workflow-memory";
export * from "./discovery";
export * from "./job-preparation";

const Id = z.uuid();
const Ref = z.string().regex(/^[a-zA-Z0-9_.:-]{1,200}$/);
const Time = z.number().int().nonnegative().safe();
const Revision = z.number().int().nonnegative().safe();
export const AGENT_FIXTURE_URL = "http://127.0.0.1:4173/workday.html";
export const AGENT_EXECUTION_URL = "http://127.0.0.1:4173/agent.html";
export function isAgentLocalUrl(url: string): boolean {
  return url === AGENT_FIXTURE_URL || url === AGENT_EXECUTION_URL;
}
const LocalUrl = z.string().refine((url) => isAgentLocalUrl(url) || isPreparationExecutionUrl(url));
export const OBSERVATION_TTL_MS = 15_000;
export const LEASE_TTL_MS = 20_000;

// Deliberately exact: neither query parameters nor page markers grant capabilities.
export function isAgentFixtureUrl(url: string): boolean {
  return url === AGENT_FIXTURE_URL;
}

export const AgentActionKindSchema = z.enum([
  "READ_PAGE",
  "FILL_TEXT",
  "SELECT_OPTION",
  "UPLOAD_FILE",
  "NEXT",
  "SUBMIT",
  "OPEN_CONTROL",
  "ADD_ROW",
  "REMOVE_ROW",
]);
export const AgentStateSchema = z.enum([
  "QUEUED",
  "OBSERVING",
  "PLANNING",
  "EXECUTING",
  "READY_FOR_REVIEW",
  "PAUSED",
  "CANCELLED",
  "FAILED",
  "OUTCOME_UNKNOWN",
  "CONFIRMED",
]);
export const AgentPauseReasonSchema = z.enum([
  "USER_PAUSED",
  "FEATURE_DISABLED",
  "WORKER_RESTART",
  "LEASE_EXPIRED",
  "STALE_OBSERVATION",
  "PROFILE_CHANGED",
  "ACCESS_CHANGED",
  "BUDGET_EXHAUSTED",
  "ACTION_FAILED",
  "UNCERTAIN_DISPATCH",
  "ACCESS_CHALLENGE",
  "VALIDATION_REQUIRED",
  "LOOP_DETECTED",
]);
export const AgentBindingSchema = z
  .object({
    tabId: z.number().int().nonnegative(),
    documentId: Ref,
    url: LocalUrl,
    profileRevision: Revision,
    profileKey: z.string().min(1).max(1000).optional(),
  })
  .strict();
export const AgentObservationSchema = z
  .object({
    id: Id,
    binding: AgentBindingSchema,
    capturedAt: Time,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    fieldCount: z.number().int().min(0).max(2_000),
    targetRefs: z.array(Ref).max(2_000),
  })
  .strict();
export const AgentBudgetSchema = z
  .object({
    maxActions: z.number().int().min(1).max(100),
    maxCostMicros: z.number().int().min(0).max(5_000_000),
    expiresAt: Time,
    actions: z.number().int().min(0),
    spentCostMicros: z.number().int().min(0),
  })
  .strict()
  .refine(
    (b) => b.actions <= b.maxActions && b.spentCostMicros <= b.maxCostMicros,
    "Budget usage cannot exceed limits",
  );
export const AgentConsentSchema = z
  .object({
    id: Id,
    applicationId: Ref,
    profileRevision: Revision,
    url: LocalUrl,
    capabilities: z.array(AgentActionKindSchema).min(1).max(9),
    expiresAt: Time,
    submissionApproved: z.boolean(),
  })
  .strict()
  .refine(
    (c) => !c.capabilities.includes("SUBMIT") || c.submissionApproved,
    "Submission needs explicit consent",
  );
export const AgentProposalSchema = z
  .object({
    id: Id,
    runId: Id,
    observationId: Id,
    kind: AgentActionKindSchema,
    targetRef: Ref.nullable(),
    factRefs: z.array(Ref).max(30),
    memoryRef: z.object({ id: Id, revision: Revision }).strict().optional(),
    expected: z.enum([
      "CHECKPOINT_RECORDED",
      "VALUE_MATCHED",
      "FILE_RETAINED",
      "STEP_CHANGED",
      "CONFIRMATION_MATCHED",
      "CONTROL_OPENED",
      "ROW_CHANGED",
    ]),
    expiresAt: Time,
    costMicros: z.number().int().min(0).max(5_000_000),
  })
  .strict()
  .superRefine((p, ctx) => {
    const expected = {
      READ_PAGE: "CHECKPOINT_RECORDED",
      FILL_TEXT: "VALUE_MATCHED",
      SELECT_OPTION: "VALUE_MATCHED",
      UPLOAD_FILE: "FILE_RETAINED",
      NEXT: "STEP_CHANGED",
      SUBMIT: "CONFIRMATION_MATCHED",
      OPEN_CONTROL: "CONTROL_OPENED",
      ADD_ROW: "ROW_CHANGED",
      REMOVE_ROW: "ROW_CHANGED",
    } as const;
    if (p.expected !== expected[p.kind])
      ctx.addIssue({ code: "custom", message: "Wrong postcondition" });
    if (p.kind !== "READ_PAGE" && !p.targetRef)
      ctx.addIssue({ code: "custom", message: "Target required" });
    if (["FILL_TEXT", "SELECT_OPTION", "UPLOAD_FILE"].includes(p.kind) && !p.factRefs.length)
      ctx.addIssue({ code: "custom", message: "Verified value reference required" });
  });
const LeaseSchema = z.object({ owner: Id, fence: Revision, expiresAt: Time }).strict();
export const AgentTicketSchema = z
  .object({
    runId: Id,
    intentId: Id,
    owner: Id,
    fence: Revision,
    binding: AgentBindingSchema,
    observationId: Id,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const AgentEventSchema = z
  .object({
    sequence: Revision,
    at: Time,
    code: z.enum([
      "CREATED",
      "LEASE_ACQUIRED",
      "OBSERVED",
      "CLAIMED",
      "RECEIVED",
      "CHECKPOINT",
      "ACTION_VERIFIED",
      "PAUSED",
      "CANCELLED",
      "RECOVERED",
      "OUTCOME_UNKNOWN",
      "CONFIRMED",
      "OUTBOX_ACK",
      "PREPARED",
      "YIELDED",
    ]),
    intentId: Id.nullable(),
  })
  .strict();
const IntentSchema = z
  .object({
    proposal: AgentProposalSchema,
    status: z.enum(["CLAIMED", "RECEIVED", "VERIFIED", "UNKNOWN", "ABORTED"]),
    fence: Revision,
  })
  .strict();
export const AgentRunSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: Id,
    applicationId: Ref,
    binding: AgentBindingSchema,
    consent: AgentConsentSchema,
    budget: AgentBudgetSchema,
    state: AgentStateSchema,
    pauseReason: AgentPauseReasonSchema.nullable(),
    revision: Revision,
    createdAt: Time,
    updatedAt: Time,
    lease: LeaseSchema.nullable(),
    observation: AgentObservationSchema.nullable(),
    intents: z.array(IntentSchema).max(100),
    journal: z.array(AgentEventSchema).max(1_000),
  })
  .strict()
  .refine(
    (r) =>
      r.applicationId === r.consent.applicationId &&
      r.binding.profileRevision === r.consent.profileRevision &&
      r.binding.url === r.consent.url,
    "Consent must match the run",
  );
const OutboxSchema = z
  .object({
    id: Id,
    runId: Id,
    applicationId: Ref,
    intentId: Id,
    createdAt: Time,
    acknowledged: z.boolean(),
    type: z.enum(["LOCAL_CONFIRMATION", "LOCAL_PREPARATION"]),
  })
  .strict();
export const AgentStoreSchema = z
  .object({
    schemaVersion: z.literal(1),
    enabled: z.boolean(),
    fence: Revision,
    runs: z.array(AgentRunSchema).max(100),
    outbox: z.array(OutboxSchema).max(100),
  })
  .strict();
export type AgentRun = z.infer<typeof AgentRunSchema>;
export type AgentStore = z.infer<typeof AgentStoreSchema>;
export type AgentObservation = z.infer<typeof AgentObservationSchema>;
export type AgentBinding = z.infer<typeof AgentBindingSchema>;
export type AgentProposal = z.infer<typeof AgentProposalSchema>;
export type AgentTicket = z.infer<typeof AgentTicketSchema>;

export function emptyAgentStore(): AgentStore {
  return { schemaVersion: 1, enabled: false, fence: 0, runs: [], outbox: [] };
}

export class AgentError extends Error {
  constructor(readonly code: string) {
    super(code.replaceAll("_", " ").toLowerCase());
  }
}
function requireThat(condition: unknown, code: string): asserts condition {
  if (!condition) throw new AgentError(code);
}
function event(
  run: AgentRun,
  code: z.infer<typeof AgentEventSchema>["code"],
  now: number,
  intentId: string | null = null,
) {
  run.revision++;
  run.updatedAt = now;
  run.journal.push({ sequence: run.revision, at: now, code, intentId });
}
function mutableState(run: AgentRun) {
  return !["CANCELLED", "FAILED", "CONFIRMED", "OUTCOME_UNKNOWN"].includes(run.state);
}
function findRun(store: AgentStore, id: string) {
  const run = store.runs.find((r) => r.id === id);
  requireThat(run, "RUN_NOT_FOUND");
  return run;
}
function matchesBinding(a: AgentBinding, b: AgentBinding) {
  return (
    a.tabId === b.tabId &&
    a.documentId === b.documentId &&
    a.url === b.url &&
    a.profileRevision === b.profileRevision &&
    a.profileKey === b.profileKey
  );
}
function requireLease(store: AgentStore, run: AgentRun, owner: string, fence: number, now: number) {
  requireThat(store.enabled, "FEATURE_DISABLED");
  requireThat(
    run.lease &&
      run.lease.owner === owner &&
      run.lease.fence === fence &&
      run.lease.expiresAt > now,
    "STALE_LEASE",
  );
  requireThat(run.consent.expiresAt > now && run.budget.expiresAt > now, "RUN_EXPIRED");
}
function stopRun(run: AgentRun, reason: z.infer<typeof AgentPauseReasonSchema>, now: number) {
  const pending = run.intents.find((i) => i.status === "CLAIMED" || i.status === "RECEIVED");
  if (pending?.proposal.kind === "SUBMIT") {
    pending.status = "UNKNOWN";
    run.state = "OUTCOME_UNKNOWN";
  } else {
    if (pending) pending.status = "ABORTED";
    run.state = "PAUSED";
  }
  run.pauseReason = reason;
  run.observation = null;
  run.lease = null;
  event(run, run.state === "OUTCOME_UNKNOWN" ? "OUTCOME_UNKNOWN" : "PAUSED", now);
}

export const AgentOperationSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("AUTHORIZE_SUBMIT"), runId: Id, consent: AgentConsentSchema })
    .strict(),
  z.object({ type: z.literal("RENEW_PREPARATION"), runId: Id, expiresAt: Time }).strict(),
  z
    .object({
      type: z.literal("YIELD"),
      runId: Id,
      owner: Id,
      fence: Revision,
      prepared: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal("SET_ENABLED"), enabled: z.boolean() }).strict(),
  z
    .object({
      type: z.literal("CREATE"),
      id: Id,
      applicationId: Ref,
      binding: AgentBindingSchema,
      consent: AgentConsentSchema,
      budget: AgentBudgetSchema,
    })
    .strict(),
  z.object({ type: z.literal("ACQUIRE"), runId: Id, owner: Id }).strict(),
  z
    .object({
      type: z.literal("OBSERVE"),
      runId: Id,
      owner: Id,
      fence: Revision,
      observation: AgentObservationSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("CLAIM"),
      runId: Id,
      owner: Id,
      fence: Revision,
      proposal: AgentProposalSchema,
      current: AgentObservationSchema,
      verifiedFactRefs: z.array(Ref).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("RECEIVE"),
      ticket: AgentTicketSchema,
      current: AgentObservationSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("VERIFY"),
      ticket: AgentTicketSchema,
      matched: z.boolean(),
      applicationId: Ref,
    })
    .strict(),
  z
    .object({
      type: z.literal("PAUSE"),
      runId: Id,
      reason: AgentPauseReasonSchema,
      expectedLease: z.object({ owner: Id, fence: Revision }).strict().optional(),
    })
    .strict(),
  z.object({ type: z.literal("CANCEL"), runId: Id }).strict(),
  z.object({ type: z.literal("RECOVER"), owner: Id }).strict(),
  z
    .object({
      type: z.literal("RECONCILE"),
      runId: Id,
      intentId: Id,
      applicationId: Ref,
      evidenceMatched: z.literal(true),
    })
    .strict(),
  z.object({ type: z.literal("ACK_OUTBOX"), id: Id }).strict(),
]);
export type AgentOperation = z.infer<typeof AgentOperationSchema>;

// The sole reducer for durable state. Call within a read/write transaction, never with
// model- or page-supplied VERIFY/RECONCILE evidence. This module performs no browser IO.
export function reduceAgentStore(
  input: AgentStore,
  operationInput: AgentOperation,
  now: number,
): AgentStore {
  Time.parse(now);
  const store = AgentStoreSchema.parse(input);
  const op = AgentOperationSchema.parse(operationInput);
  if (op.type === "SET_ENABLED") {
    store.enabled = op.enabled;
    if (!op.enabled)
      for (const run of store.runs) if (mutableState(run)) stopRun(run, "FEATURE_DISABLED", now);
  } else if (op.type === "CREATE") {
    requireThat(store.enabled, "FEATURE_DISABLED");
    requireThat(!store.runs.some((r) => r.id === op.id), "DUPLICATE_RUN");
    requireThat(
      !store.runs.some(
        (r) =>
          (r.applicationId === op.applicationId && !["CANCELLED", "FAILED"].includes(r.state)) ||
          (r.binding.tabId === op.binding.tabId &&
            !["CANCELLED", "FAILED", "CONFIRMED"].includes(r.state)),
      ),
      "APPLICATION_ALREADY_ACTIVE",
    );
    requireThat(
      op.budget.actions === 0 && op.budget.spentCostMicros === 0,
      "INVALID_INITIAL_BUDGET",
    );
    requireThat(op.consent.expiresAt > now && op.budget.expiresAt > now, "RUN_EXPIRED");
    store.runs.push({
      schemaVersion: 1,
      id: op.id,
      applicationId: op.applicationId,
      binding: op.binding,
      consent: op.consent,
      budget: op.budget,
      state: "QUEUED",
      pauseReason: null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      lease: null,
      observation: null,
      intents: [],
      journal: [{ sequence: 1, at: now, code: "CREATED", intentId: null }],
    });
  } else if (op.type === "RECOVER") {
    for (const run of store.runs) {
      if (
        mutableState(run) &&
        run.lease &&
        (run.lease.owner !== op.owner || run.lease.expiresAt <= now)
      ) {
        stopRun(run, run.lease.owner !== op.owner ? "WORKER_RESTART" : "LEASE_EXPIRED", now);
        event(run, "RECOVERED", now);
      }
    }
  } else if (op.type === "ACK_OUTBOX") {
    const item = store.outbox.find((e) => e.id === op.id);
    requireThat(item, "OUTBOX_NOT_FOUND");
    if (!item.acknowledged) {
      item.acknowledged = true;
      event(findRun(store, item.runId), "OUTBOX_ACK", now);
    }
  } else {
    const run = findRun(store, "ticket" in op ? op.ticket.runId : op.runId);
    requireThat(now >= run.updatedAt, "CLOCK_MOVED_BACKWARDS");
    if (op.type === "RENEW_PREPARATION") {
      requireThat(
        store.enabled &&
          ["PAUSED", "OBSERVING", "READY_FOR_REVIEW"].includes(run.state) &&
          !run.lease &&
          !run.consent.submissionApproved &&
          !run.intents.some((i) => ["CLAIMED", "RECEIVED"].includes(i.status)),
        "RUN_NOT_RESUMABLE",
      );
      requireThat(op.expiresAt > now && op.expiresAt <= now + 600000, "RUN_EXPIRED");
      run.consent.expiresAt = op.expiresAt;
      run.budget.expiresAt = op.expiresAt;
      event(run, "RECOVERED", now);
    } else if (op.type === "AUTHORIZE_SUBMIT") {
      requireThat(
        store.enabled && run.state === "READY_FOR_REVIEW" && !run.lease,
        "FINAL_REVIEW_REQUIRED",
      );
      requireThat(
        op.consent.applicationId === run.applicationId &&
          op.consent.profileRevision === run.binding.profileRevision &&
          op.consent.url === run.binding.url,
        "CONTEXT_CHANGED",
      );
      requireThat(
        !run.consent.submissionApproved &&
          op.consent.submissionApproved &&
          op.consent.capabilities.length === 1 &&
          op.consent.capabilities[0] === "SUBMIT" &&
          op.consent.expiresAt > now &&
          !run.intents.some((i) => i.proposal.kind === "SUBMIT"),
        "INVALID_SUBMISSION_CONSENT",
      );
      run.consent = op.consent;
      run.budget.expiresAt = op.consent.expiresAt;
      event(run, "PREPARED", now);
    } else if (op.type === "YIELD") {
      requireLease(store, run, op.owner, op.fence, now);
      requireThat(run.state === "OBSERVING" || run.state === "PLANNING", "WRONG_RUN_STATE");
      run.lease = null;
      run.observation = null;
      run.state = op.prepared ? "READY_FOR_REVIEW" : "OBSERVING";
      if (
        op.prepared &&
        !store.outbox.some((x) => x.runId === run.id && x.type === "LOCAL_PREPARATION")
      ) {
        store.outbox.push({
          id: run.id,
          runId: run.id,
          applicationId: run.applicationId,
          intentId: run.id,
          createdAt: now,
          acknowledged: false,
          type: "LOCAL_PREPARATION",
        });
      }
      event(run, op.prepared ? "PREPARED" : "YIELDED", now);
    } else if (op.type === "ACQUIRE") {
      requireThat(store.enabled && mutableState(run), "RUN_NOT_RESUMABLE");
      requireThat(!run.lease || run.lease.expiresAt <= now, "LEASE_BUSY");
      requireThat(run.consent.expiresAt > now && run.budget.expiresAt > now, "RUN_EXPIRED");
      requireThat(
        !store.runs.some(
          (other) =>
            other.id !== run.id &&
            other.lease &&
            other.lease.expiresAt > now &&
            (other.binding.tabId === run.binding.tabId ||
              other.applicationId === run.applicationId),
        ),
        "LEASE_BUSY",
      );
      if (run.state === "EXECUTING") stopRun(run, "UNCERTAIN_DISPATCH", now);
      // Persist the uncertain outcome instead of throwing and rolling it back.
      if (!mutableState(run)) return AgentStoreSchema.parse(store);
      store.fence++;
      run.lease = { owner: op.owner, fence: store.fence, expiresAt: now + LEASE_TTL_MS };
      run.state = "OBSERVING";
      run.pauseReason = null;
      run.observation = null;
      event(run, "LEASE_ACQUIRED", now);
    } else if (op.type === "OBSERVE") {
      requireLease(store, run, op.owner, op.fence, now);
      requireThat(run.state === "OBSERVING", "WRONG_RUN_STATE");
      requireThat(
        op.observation.binding.tabId === run.binding.tabId &&
          op.observation.binding.url === run.binding.url &&
          op.observation.binding.profileRevision === run.binding.profileRevision &&
          op.observation.binding.profileKey === run.binding.profileKey,
        "CONTEXT_CHANGED",
      );
      requireThat(
        op.observation.capturedAt <= now && now - op.observation.capturedAt <= OBSERVATION_TTL_MS,
        "STALE_OBSERVATION",
      );
      run.binding = op.observation.binding;
      run.observation = op.observation;
      run.state = "PLANNING";
      event(run, "OBSERVED", now);
    } else if (op.type === "CLAIM") {
      requireLease(store, run, op.owner, op.fence, now);
      requireThat(run.state === "PLANNING" && run.observation, "FRESH_OBSERVATION_REQUIRED");
      const p = op.proposal;
      requireThat(!run.intents.some((i) => i.proposal.id === p.id), "DUPLICATE_INTENT");
      requireThat(p.runId === run.id && p.observationId === run.observation.id, "CONTEXT_CHANGED");
      requireThat(
        matchesBinding(run.binding, op.current.binding) &&
          op.current.fingerprint === run.observation.fingerprint &&
          op.current.id === run.observation.id,
        "CONTEXT_CHANGED",
      );
      requireThat(
        op.current.capturedAt <= now &&
          now - op.current.capturedAt <= OBSERVATION_TTL_MS &&
          now - run.observation.capturedAt <= OBSERVATION_TTL_MS &&
          p.expiresAt > now,
        "STALE_OBSERVATION",
      );
      requireThat(run.consent.capabilities.includes(p.kind), "CAPABILITY_DENIED");
      requireThat(
        !p.targetRef || run.observation.targetRefs.includes(p.targetRef),
        "UNKNOWN_TARGET",
      );
      requireThat(
        p.factRefs.every((ref) => op.verifiedFactRefs.includes(ref)),
        "UNVERIFIED_FACT",
      );
      requireThat(
        run.budget.actions < run.budget.maxActions &&
          run.budget.spentCostMicros + p.costMicros <= run.budget.maxCostMicros,
        "BUDGET_EXHAUSTED",
      );
      run.budget.actions++;
      run.budget.spentCostMicros += p.costMicros;
      run.intents.push({ proposal: p, status: "CLAIMED", fence: op.fence });
      run.state = "EXECUTING";
      event(run, "CLAIMED", now, p.id);
    } else if (op.type === "RECEIVE" || op.type === "VERIFY") {
      const ticket = op.ticket;
      requireLease(store, run, ticket.owner, ticket.fence, now);
      requireThat(
        run.state === "EXECUTING" &&
          run.observation &&
          matchesBinding(run.binding, ticket.binding) &&
          ticket.observationId === run.observation.id &&
          ticket.fingerprint === run.observation.fingerprint,
        "CONTEXT_CHANGED",
      );
      const intent = run.intents.find((i) => i.proposal.id === ticket.intentId);
      requireThat(intent && intent.fence === ticket.fence, "UNKNOWN_INTENT");
      if (op.type === "RECEIVE") {
        requireThat(intent.status === "CLAIMED", "DUPLICATE_RECEIPT");
        requireThat(
          matchesBinding(ticket.binding, op.current.binding) &&
            ticket.fingerprint === op.current.fingerprint &&
            now - run.observation.capturedAt <= OBSERVATION_TTL_MS &&
            op.current.capturedAt <= now &&
            now - op.current.capturedAt <= OBSERVATION_TTL_MS &&
            intent.proposal.expiresAt > now,
          "STALE_OBSERVATION",
        );
        intent.status = "RECEIVED";
        event(run, "RECEIVED", now, ticket.intentId);
      } else {
        requireThat(intent.status === "RECEIVED", "RECEIPT_REQUIRED");
        requireThat(op.applicationId === run.applicationId, "CONFIRMATION_IDENTITY_MISMATCH");
        if (!op.matched) stopRun(run, "ACTION_FAILED", now);
        else {
          intent.status = "VERIFIED";
          if (intent.proposal.kind === "SUBMIT") confirm(store, run, intent.proposal.id, now);
          else {
            run.state = intent.proposal.kind === "READ_PAGE" ? "READY_FOR_REVIEW" : "OBSERVING";
            if (run.state === "OBSERVING") run.observation = null;
            else run.lease = null;
            event(
              run,
              intent.proposal.kind === "READ_PAGE" ? "CHECKPOINT" : "ACTION_VERIFIED",
              now,
              intent.proposal.id,
            );
          }
        }
      }
    } else if (op.type === "PAUSE" || op.type === "CANCEL") {
      if (op.type === "PAUSE" && op.expectedLease) {
        requireThat(
          run.lease?.owner === op.expectedLease.owner && run.lease.fence === op.expectedLease.fence,
          "STALE_LEASE",
        );
      }
      requireThat(mutableState(run), "RUN_NOT_MUTABLE");
      stopRun(run, op.type === "PAUSE" ? op.reason : "USER_PAUSED", now);
      if (op.type === "CANCEL" && run.state !== "OUTCOME_UNKNOWN") {
        run.state = "CANCELLED";
        event(run, "CANCELLED", now);
      }
    } else if (op.type === "RECONCILE") {
      const intent = run.intents.find((i) => i.proposal.id === op.intentId);
      requireThat(
        run.state === "OUTCOME_UNKNOWN" &&
          intent?.status === "UNKNOWN" &&
          intent.proposal.kind === "SUBMIT",
        "RECONCILIATION_NOT_ALLOWED",
      );
      requireThat(op.applicationId === run.applicationId, "CONFIRMATION_IDENTITY_MISMATCH");
      intent.status = "VERIFIED";
      confirm(store, run, op.intentId, now);
    }
  }
  return AgentStoreSchema.parse(store);
}

function confirm(store: AgentStore, run: AgentRun, intentId: string, now: number) {
  run.state = "CONFIRMED";
  run.pauseReason = null;
  run.lease = null;
  if (!store.outbox.some((e) => e.intentId === intentId)) {
    store.outbox.push({
      id: intentId,
      runId: run.id,
      applicationId: run.applicationId,
      intentId,
      createdAt: now,
      acknowledged: false,
      type: "LOCAL_CONFIRMATION",
    });
  }
  event(run, "CONFIRMED", now, intentId);
}

export function ticketForRun(run: AgentRun): AgentTicket {
  const intent = run.intents.find((i) => i.status === "CLAIMED");
  requireThat(intent && run.lease && run.observation, "NO_DISPATCH_CLAIM");
  return AgentTicketSchema.parse({
    runId: run.id,
    intentId: intent.proposal.id,
    owner: run.lease.owner,
    fence: run.lease.fence,
    binding: run.binding,
    observationId: run.observation.id,
    fingerprint: run.observation.fingerprint,
  });
}

// Receiver-side dedup complements the transactional claim. This is intentionally
// synchronous: validate and perform the bounded operation without an await gap.
export function createAgentReceiver() {
  const receipts = new Set<string>();
  const fences = new Map<string, number>();
  return (
    ticketInput: AgentTicket,
    current: AgentObservation,
    activeFence: number,
    now: number,
    execute: () => void,
  ) => {
    const ticket = AgentTicketSchema.parse(ticketInput);
    AgentObservationSchema.parse(current);
    requireThat(
      ticket.fence === activeFence && ticket.fence >= (fences.get(ticket.runId) ?? 0),
      "STALE_LEASE",
    );
    requireThat(
      matchesBinding(ticket.binding, current.binding) &&
        ticket.fingerprint === current.fingerprint &&
        current.capturedAt <= now &&
        now - current.capturedAt <= OBSERVATION_TTL_MS,
      "STALE_OBSERVATION",
    );
    const key = `${ticket.runId}:${ticket.intentId}`;
    requireThat(!receipts.has(key), "DUPLICATE_RECEIPT");
    fences.set(ticket.runId, ticket.fence);
    receipts.add(key);
    execute();
  };
}

export const AgentLabStatusSchema = z
  .object({
    kind: z.literal("AGENT_LAB_STATUS"),
    available: z.boolean(),
    enabled: z.boolean(),
    runs: z
      .array(
        z
          .object({
            id: Id,
            state: AgentStateSchema,
            revision: Revision,
            updatedAt: Time,
            pauseReason: AgentPauseReasonSchema.nullable(),
            actions: z.number().int().nonnegative(),
            fieldCount: z.number().int().nonnegative().nullable(),
            events: z.array(AgentEventSchema).max(1_000),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type AgentLabStatus = z.infer<typeof AgentLabStatusSchema>;
