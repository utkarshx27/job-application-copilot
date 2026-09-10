import {
  MemoryStoreSchema,
  WorkflowMemorySchema,
  WorkflowStepSchema,
  sameMemoryOwner,
  memoryOwnerKey,
  type MemoryStore,
  type MemoryOwner,
  type WorkflowMemory,
} from "./feedback-memory";
import type { AgentRun } from "./index";
import { isPreparationExecutionUrl, preparationWorkflowUrl } from "./local-portal-url";

function observedSteps(run: AgentRun, owner: MemoryOwner) {
  if (
    (run.binding.url !== "http://127.0.0.1:4173/agent.html" &&
      !isPreparationExecutionUrl(run.binding.url)) ||
    run.binding.profileRevision !== owner.profileRevision ||
    run.binding.profileKey !== memoryOwnerKey(owner) ||
    run.state !== "READY_FOR_REVIEW" ||
    !run.journal.some((entry) => entry.code === "PREPARED") ||
    !run.intents.length ||
    run.intents.some((intent) => intent.status !== "VERIFIED")
  )
    throw new Error("A fully verified local preparation for the current profile is required.");
  return run.intents
    .filter(
      (intent) => intent.proposal.kind !== "OPEN_CONTROL" || intent.proposal.targetRef !== "start",
    )
    .map((intent) =>
      WorkflowStepSchema.parse({
        kind: intent.proposal.kind,
        parameter: intent.proposal.factRefs[0]?.replace(/^(?:demo|approved)\./, "") ?? "control",
      }),
    );
}
export function captureWorkflow(
  store: MemoryStore,
  owner: MemoryOwner,
  run: AgentRun,
  now: number,
) {
  const steps = observedSteps(run, owner);
  const record = WorkflowMemorySchema.parse({
    id: crypto.randomUUID(),
    revision: 1,
    owner,
    state: "CANDIDATE",
    url: isPreparationExecutionUrl(run.binding.url)
      ? preparationWorkflowUrl(run.binding.url)
      : run.binding.url,
    steps,
    evidenceRunIds: [run.id],
    createdAt: now,
    expiresAt: now + 30 * 86400_000,
  });
  return MemoryStoreSchema.parse({
    ...store,
    revision: store.revision + 1,
    workflows: [...store.workflows, record],
  });
}
export function changeWorkflow(
  store: MemoryStore,
  owner: MemoryOwner,
  id: string,
  revision: number,
  action: "VALIDATE" | "ACTIVATE" | "RETIRE" | "FORGET",
  now: number,
  run?: AgentRun,
) {
  const record = store.workflows.find(
    (entry) => entry.id === id && sameMemoryOwner(entry.owner, owner),
  );
  if (!record || record.revision !== revision)
    throw new Error("Workflow changed or unavailable. Refresh it.");
  if (action === "FORGET")
    return MemoryStoreSchema.parse({
      ...store,
      revision: store.revision + 1,
      workflows: store.workflows.filter((entry) => entry.id !== id),
    });
  let state: WorkflowMemory["state"];
  let evidenceRunIds = record.evidenceRunIds;
  if (action === "RETIRE") state = "RETIRED";
  else {
    if (record.expiresAt <= now || record.owner.profileRevision !== owner.profileRevision)
      throw new Error("Workflow expired or belongs to an older profile revision.");
    if (action === "ACTIVATE") {
      if (record.state !== "OFFLINE_VALIDATED")
        throw new Error("Validate the workflow before activation.");
      state = "ACTIVE";
    } else {
      if (
        record.state !== "CANDIDATE" ||
        !run ||
        record.evidenceRunIds.includes(run.id) ||
        run.createdAt < record.createdAt ||
        (isPreparationExecutionUrl(run.binding.url)
          ? preparationWorkflowUrl(run.binding.url)
          : run.binding.url) !== record.url
      )
        throw new Error("Validate against a separate local preparation completed after capture.");
      state =
        JSON.stringify(observedSteps(run, owner)) === JSON.stringify(record.steps)
          ? "OFFLINE_VALIDATED"
          : "REJECTED";
      evidenceRunIds = [...record.evidenceRunIds, run.id];
    }
  }
  return MemoryStoreSchema.parse({
    ...store,
    revision: store.revision + 1,
    workflows: store.workflows.map((entry) =>
      entry.id === id ? { ...record, revision: record.revision + 1, state, evidenceRunIds } : entry,
    ),
  });
}
export function retrieveWorkflow(
  store: MemoryStore,
  owner: MemoryOwner,
  now: number,
  url = "http://127.0.0.1:4173/agent.html",
) {
  const active = store.workflows.filter(
    (entry) =>
      sameMemoryOwner(entry.owner, owner) &&
      entry.url === url &&
      entry.owner.profileRevision === owner.profileRevision &&
      entry.state === "ACTIVE" &&
      entry.createdAt <= now &&
      entry.expiresAt > now,
  );
  if (new Set(active.map((entry) => JSON.stringify(entry.steps))).size > 1) return null;
  return active[0] ?? null;
}
