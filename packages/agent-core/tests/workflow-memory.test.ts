import { expect, it } from "vitest";
import {
  AGENT_EXECUTION_URL,
  emptyAgentStore,
  reduceAgentStore,
  ticketForRun,
  type AgentObservation,
  type AgentProposal,
} from "../src/index";
import { captureWorkflow, changeWorkflow, retrieveWorkflow } from "../src/workflow-memory";
import { emptyMemory, memoryOwnerKey } from "../src/feedback-memory";
const person = { ownerId: "owner", profileId: "profile", profileRevision: 1 };
function completed(at: number, parameter = "email") {
  const id = crypto.randomUUID();
  const leaseOwner = crypto.randomUUID();
  const binding: AgentObservation["binding"] = {
    tabId: 1,
    documentId: "document",
    url: AGENT_EXECUTION_URL,
    profileRevision: 1,
    profileKey: memoryOwnerKey(person),
  };
  let store = reduceAgentStore(emptyAgentStore(), { type: "SET_ENABLED", enabled: true }, at);
  store = reduceAgentStore(
    store,
    {
      type: "CREATE",
      id,
      applicationId: "synthetic:1",
      binding,
      consent: {
        id: crypto.randomUUID(),
        applicationId: "synthetic:1",
        profileRevision: 1,
        url: AGENT_EXECUTION_URL,
        capabilities: ["FILL_TEXT"],
        submissionApproved: false,
        expiresAt: 100000,
      },
      budget: {
        actions: 0,
        spentCostMicros: 0,
        maxActions: 30,
        maxCostMicros: 0,
        expiresAt: 100000,
      },
    },
    at,
  );
  store = reduceAgentStore(store, { type: "ACQUIRE", runId: id, owner: leaseOwner }, at);
  const fence = store.runs[0]!.lease!.fence;
  const current: AgentObservation = {
    id: crypto.randomUUID(),
    binding,
    fingerprint: "a".repeat(64),
    fieldCount: 1,
    targetRefs: ["field"],
    capturedAt: at,
  };
  store = reduceAgentStore(
    store,
    { type: "OBSERVE", runId: id, owner: leaseOwner, fence, observation: current },
    at,
  );
  const proposal: AgentProposal = {
    id: crypto.randomUUID(),
    runId: id,
    observationId: current.id,
    kind: "FILL_TEXT",
    targetRef: "field",
    factRefs: [`demo.${parameter}`],
    expected: "VALUE_MATCHED",
    expiresAt: at + 1000,
    costMicros: 0,
  };
  store = reduceAgentStore(
    store,
    {
      type: "CLAIM",
      runId: id,
      owner: leaseOwner,
      fence,
      current,
      proposal,
      verifiedFactRefs: proposal.factRefs,
    },
    at,
  );
  const ticket = ticketForRun(store.runs[0]!);
  store = reduceAgentStore(store, { type: "RECEIVE", ticket, current }, at);
  store = reduceAgentStore(
    store,
    { type: "VERIFY", ticket, matched: true, applicationId: "synthetic:1" },
    at,
  );
  store = reduceAgentStore(
    store,
    { type: "YIELD", runId: id, owner: leaseOwner, fence, prepared: true },
    at,
  );
  return store.runs[0]!;
}
it("promotes only after a separate successful replay and removes retired/forgotten workflows", () => {
  const first = completed(1000);
  let store = captureWorkflow(emptyMemory(), person, first, 1100);
  const id = store.workflows[0]!.id;
  expect(() => changeWorkflow(store, person, id, 1, "ACTIVATE", 1200)).toThrow(/Validate/);
  expect(() => changeWorkflow(store, person, id, 1, "VALIDATE", 1200, first)).toThrow(/separate/);
  store = changeWorkflow(store, person, id, 1, "VALIDATE", 3000, completed(2000));
  store = changeWorkflow(store, person, id, 2, "ACTIVATE", 3001);
  expect(retrieveWorkflow(store, person, 3002)?.steps).toEqual([
    { kind: "FILL_TEXT", parameter: "email" },
  ]);
  expect(retrieveWorkflow(store, { ...person, profileId: "other" }, 3002)).toBeNull();
  expect(retrieveWorkflow(store, { ...person, profileRevision: 2 }, 3002)).toBeNull();
  expect(retrieveWorkflow(store, person, Number.MAX_SAFE_INTEGER)).toBeNull();
  store = changeWorkflow(store, person, id, 3, "RETIRE", 3003);
  expect(retrieveWorkflow(store, person, 3004)).toBeNull();
  store = changeWorkflow(store, person, id, 4, "FORGET", 3005);
  expect(store.workflows).toEqual([]);
});
it("rejects divergent replay, incomplete runs, different owners and arbitrary parameters", () => {
  const run = completed(1000);
  let store = captureWorkflow(emptyMemory(), person, run, 1100);
  store = changeWorkflow(
    store,
    person,
    store.workflows[0]!.id,
    1,
    "VALIDATE",
    3000,
    completed(2000, "name"),
  );
  expect(store.workflows[0]!.state).toBe("REJECTED");
  expect(() => captureWorkflow(store, person, { ...run, state: "PAUSED" }, 3000)).toThrow();
  expect(() => captureWorkflow(store, { ...person, profileId: "other" }, run, 3000)).toThrow();
  expect(() => captureWorkflow(store, person, completed(1000, "page.script"), 3000)).toThrow();
});
