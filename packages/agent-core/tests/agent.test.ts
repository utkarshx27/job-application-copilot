import { describe, expect, it, vi } from "vitest";
import {
  AGENT_FIXTURE_URL,
  AgentConsentSchema,
  AgentProposalSchema,
  createAgentReceiver,
  emptyAgentStore,
  isAgentFixtureUrl,
  reduceAgentStore,
  ticketForRun,
  type AgentOperation,
  type AgentObservation,
  type AgentProposal,
  type AgentStore,
} from "../src/index";

const id = () => crypto.randomUUID();
const owner = id();
const observation: AgentObservation = {
  id: id(),
  binding: { tabId: 1, documentId: "doc-1", url: AGENT_FIXTURE_URL, profileRevision: 1 },
  capturedAt: 1_000,
  fingerprint: "a".repeat(64),
  fieldCount: 1,
  targetRefs: ["field-1"],
};
function setup(kind: AgentProposal["kind"] = "READ_PAGE") {
  const runId = id();
  let store = reduceAgentStore(emptyAgentStore(), { type: "SET_ENABLED", enabled: true }, 1_000);
  const create: AgentOperation = {
    type: "CREATE",
    id: runId,
    applicationId: "application-1",
    binding: observation.binding,
    consent: {
      id: id(),
      applicationId: "application-1",
      profileRevision: 1,
      url: AGENT_FIXTURE_URL,
      capabilities: [kind],
      expiresAt: 100_000,
      submissionApproved: kind === "SUBMIT",
    },
    budget: {
      maxActions: 2,
      maxCostMicros: 10,
      expiresAt: 100_000,
      actions: 0,
      spentCostMicros: 0,
    },
  };
  store = reduceAgentStore(store, create, 1_000);
  store = reduceAgentStore(store, { type: "ACQUIRE", runId, owner }, 1_000);
  store = reduceAgentStore(store, { type: "OBSERVE", runId, owner, fence: 1, observation }, 1_000);
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
  const proposal: AgentProposal = {
    id: id(),
    runId,
    observationId: observation.id,
    kind,
    expected: expected[kind],
    expiresAt: 30_000,
    costMicros: 0,
    targetRef: kind === "READ_PAGE" ? null : "field-1",
    factRefs: ["FILL_TEXT", "SELECT_OPTION", "UPLOAD_FILE"].includes(kind) ? ["CONTACT.email"] : [],
  };
  const claim: AgentOperation = {
    type: "CLAIM",
    runId,
    owner,
    fence: 1,
    proposal,
    current: observation,
    verifiedFactRefs: ["CONTACT.email"],
  };
  return { store, runId, proposal, claim, create };
}
function claimed(kind: AgentProposal["kind"] = "READ_PAGE") {
  const fixture = setup(kind);
  const store = reduceAgentStore(fixture.store, fixture.claim, 1_001);
  const run = store.runs[0];
  if (!run) throw new Error("Missing fixture run");
  return { ...fixture, store, ticket: ticketForRun(run) };
}
function first(store: AgentStore) {
  const run = store.runs[0];
  if (!run) throw new Error("Missing fixture run");
  return run;
}

describe("durable agent contracts and reducer", () => {
  it("defaults off and permits only the exact local fixture", () => {
    const fixture = setup();
    expect(() => reduceAgentStore(emptyAgentStore(), fixture.create, 1_000)).toThrow(
      "feature disabled",
    );
    expect(isAgentFixtureUrl(AGENT_FIXTURE_URL)).toBe(true);
    for (const url of [
      AGENT_FIXTURE_URL + "?test=true",
      AGENT_FIXTURE_URL + "#test",
      "https://jobs.linkedin.com",
      "http://localhost:4173/workday.html",
    ]) {
      expect(isAgentFixtureUrl(url)).toBe(false);
    }
  });
  it("requires submission consent and rejects arbitrary payloads and wrong postconditions", () => {
    const fixture = setup();
    expect(
      AgentConsentSchema.safeParse({ ...first(fixture.store).consent, capabilities: ["SUBMIT"] })
        .success,
    ).toBe(false);
    expect(AgentProposalSchema.safeParse({ ...fixture.proposal, value: "private" }).success).toBe(
      false,
    );
    expect(
      AgentProposalSchema.safeParse({ ...fixture.proposal, expected: "CONFIRMATION_MATCHED" })
        .success,
    ).toBe(false);
  });
  it("records a read checkpoint without mutating its input or emitting a submission", () => {
    const fixture = claimed();
    const original = structuredClone(fixture.store);
    const received = reduceAgentStore(
      fixture.store,
      { type: "RECEIVE", ticket: fixture.ticket, current: observation },
      1_002,
    );
    const verified = reduceAgentStore(
      received,
      { type: "VERIFY", ticket: fixture.ticket, matched: true, applicationId: "application-1" },
      1_003,
    );
    expect(fixture.store).toEqual(original);
    expect(first(verified)).toMatchObject({
      state: "READY_FOR_REVIEW",
      lease: null,
      budget: { actions: 1 },
    });
    expect(first(verified).journal.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(verified.outbox).toEqual([]);
  });
  it("rejects competing leases and duplicate application runs", () => {
    const f = setup();
    expect(() =>
      reduceAgentStore(f.store, { type: "ACQUIRE", runId: f.runId, owner: id() }, 1_001),
    ).toThrow("lease busy");
    expect(() => reduceAgentStore(f.store, { ...f.create, id: id() }, 1_001)).toThrow(
      "application already active",
    );
  });
  it.each(["document", "profile", "fingerprint", "tab"])(
    "rejects a changed %s before claiming",
    (change) => {
      const f = setup();
      const current = structuredClone(observation);
      if (change === "document") current.binding.documentId = "doc-2";
      if (change === "profile") current.binding.profileRevision++;
      if (change === "fingerprint") current.fingerprint = "b".repeat(64);
      if (change === "tab") current.binding.tabId++;
      expect(() => reduceAgentStore(f.store, { ...f.claim, current }, 1_001)).toThrow(
        "context changed",
      );
    },
  );
  it("rejects stale observations, unverified facts, unknown targets and missing capability", () => {
    const f = setup("FILL_TEXT");
    expect(() => reduceAgentStore(f.store, f.claim, 17_000)).toThrow("stale observation");
    expect(() => reduceAgentStore(f.store, { ...f.claim, verifiedFactRefs: [] }, 1_001)).toThrow(
      "unverified fact",
    );
    expect(() =>
      reduceAgentStore(
        f.store,
        { ...f.claim, proposal: { ...f.proposal, targetRef: "unknown" } },
        1_001,
      ),
    ).toThrow("unknown target");
    const restricted = structuredClone(f.store);
    first(restricted).consent.capabilities = ["READ_PAGE"];
    expect(() => reduceAgentStore(restricted, f.claim, 1_001)).toThrow("capability denied");
  });
  it("reserves cost and action budget at claim and does not refund uncertain dispatches", () => {
    const f = setup();
    first(f.store).budget.maxActions = 1;
    const store = reduceAgentStore(
      f.store,
      { ...f.claim, proposal: { ...f.proposal, costMicros: 10 } },
      1_001,
    );
    expect(first(store).budget).toMatchObject({ actions: 1, spentCostMicros: 10 });
    let recovered = reduceAgentStore(store, { type: "RECOVER", owner: id() }, 1_002);
    recovered = reduceAgentStore(recovered, { type: "ACQUIRE", runId: f.runId, owner }, 1_003);
    recovered = reduceAgentStore(
      recovered,
      { type: "OBSERVE", runId: f.runId, owner, fence: 2, observation },
      1_004,
    );
    expect(() =>
      reduceAgentStore(
        recovered,
        { ...f.claim, fence: 2, proposal: { ...f.proposal, id: id() } },
        1_005,
      ),
    ).toThrow("budget exhausted");
    expect(() =>
      reduceAgentStore(f.store, { ...f.claim, proposal: { ...f.proposal, costMicros: 11 } }, 1_001),
    ).toThrow("budget exhausted");
  });
  it("deduplicates durable receipts and requires receipt before verification", () => {
    const f = claimed();
    expect(() =>
      reduceAgentStore(
        f.store,
        { type: "VERIFY", ticket: f.ticket, matched: true, applicationId: "application-1" },
        1_002,
      ),
    ).toThrow("receipt required");
    const received = reduceAgentStore(
      f.store,
      { type: "RECEIVE", ticket: f.ticket, current: observation },
      1_002,
    );
    expect(() =>
      reduceAgentStore(
        received,
        { type: "RECEIVE", ticket: f.ticket, current: observation },
        1_003,
      ),
    ).toThrow("duplicate receipt");
  });
  it("recovers a claimed action, invalidates old fencing, and requires a fresh observation", () => {
    const f = claimed();
    let recovered = reduceAgentStore(f.store, { type: "RECOVER", owner: id() }, 1_002);
    expect(first(recovered)).toMatchObject({
      state: "PAUSED",
      observation: null,
      lease: null,
      pauseReason: "WORKER_RESTART",
    });
    expect(first(recovered).intents[0]?.status).toBe("ABORTED");
    recovered = reduceAgentStore(recovered, { type: "ACQUIRE", runId: f.runId, owner }, 1_003);
    expect(first(recovered).lease?.fence).toBe(2);
    expect(() =>
      reduceAgentStore(
        recovered,
        { type: "RECEIVE", ticket: f.ticket, current: observation },
        1_004,
      ),
    ).toThrow("stale lease");
    expect(() => reduceAgentStore(recovered, { ...f.claim, fence: 2 }, 1_004)).toThrow(
      "fresh observation required",
    );
    expect(() =>
      reduceAgentStore(
        recovered,
        {
          type: "PAUSE",
          runId: f.runId,
          reason: "ACTION_FAILED",
          expectedLease: { owner, fence: 1 },
        },
        1_004,
      ),
    ).toThrow("stale lease");
  });
  it.each(["RECOVER", "ACQUIRE", "CANCEL", "SET_ENABLED"] as const)(
    "persists uncertain submission on %s without retry",
    (type) => {
      const f = claimed("SUBMIT");
      const op: AgentOperation =
        type === "RECOVER"
          ? { type, owner: id() }
          : type === "ACQUIRE"
            ? { type, runId: f.runId, owner: id() }
            : type === "CANCEL"
              ? { type, runId: f.runId }
              : { type, enabled: false };
      const stopped = reduceAgentStore(f.store, op, 22_000);
      expect(first(stopped).state).toBe("OUTCOME_UNKNOWN");
      expect(first(stopped).intents[0]?.status).toBe("UNKNOWN");
      expect(() =>
        reduceAgentStore(stopped, { type: "ACQUIRE", runId: f.runId, owner }, 22_001),
      ).toThrow("run not resumable");
      expect(stopped.outbox).toEqual([]);
    },
  );
  it("requires identity-matched reconciliation and emits one idempotently acknowledged outbox item", () => {
    const f = claimed("SUBMIT");
    const stopped = reduceAgentStore(f.store, { type: "RECOVER", owner: id() }, 1_002);
    const reconcile: AgentOperation = {
      type: "RECONCILE",
      runId: f.runId,
      intentId: f.proposal.id,
      applicationId: "application-1",
      evidenceMatched: true,
    };
    expect(() =>
      reduceAgentStore(stopped, { ...reconcile, applicationId: "wrong-application" }, 1_003),
    ).toThrow("confirmation identity mismatch");
    const confirmed = reduceAgentStore(stopped, reconcile, 1_003);
    expect(first(confirmed).state).toBe("CONFIRMED");
    expect(confirmed.outbox).toHaveLength(1);
    const ack = reduceAgentStore(confirmed, { type: "ACK_OUTBOX", id: f.proposal.id }, 1_004);
    expect(reduceAgentStore(ack, { type: "ACK_OUTBOX", id: f.proposal.id }, 1_005)).toEqual(ack);
  });
  it("receiver rejects duplicate calls and stale fences even when execution throws", () => {
    const f = claimed();
    const receive = createAgentReceiver();
    const execute = vi.fn(() => {
      throw new Error("interrupted");
    });
    expect(() => receive(f.ticket, observation, 2, 1_002, execute)).toThrow("stale lease");
    expect(execute).not.toHaveBeenCalled();
    expect(() => receive(f.ticket, observation, 1, 1_002, execute)).toThrow("interrupted");
    expect(() => receive(f.ticket, observation, 1, 1_003, execute)).toThrow("duplicate receipt");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
