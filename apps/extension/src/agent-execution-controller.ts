import {
  AGENT_EXECUTION_URL,
  AgentError,
  AgentLabStatusSchema,
  ticketForRun,
  type AgentProposal,
  type AgentRun,
  type WorkflowMemory,
} from "@copilot/agent-core";
import type { AgentRepository } from "./agent-storage";
import type { ExecutionTransport } from "./agent-execution-transport";
import { DEMO_FACTS, ExecutionSnapshotSchema } from "./agent-execution-protocol";
import type { ApprovedLocalFact, LocalTarget } from "./agent-document-executor";
import { prepareLocalAction } from "./agent-action-planner";

export class AgentExecutionController {
  private readonly owner = crypto.randomUUID();
  private recovery: Promise<void> | undefined;
  private readonly running = new Set<string>();
  private readonly tasks = new Map<string, Promise<void>>();
  private readonly stopped = new Set<string>();
  private outboxQueue: Promise<void> = Promise.resolve();
  constructor(
    private readonly repository: AgentRepository,
    private readonly transport: ExecutionTransport,
    private readonly available: boolean,
    private readonly profileRevision: () => Promise<number>,
    private readonly prepared: (run: AgentRun) => Promise<void>,
    private readonly profileKey: () => Promise<string>,
    private readonly workflowMemory: () => Promise<WorkflowMemory | null>,
  ) {}

  private async ready() {
    if (!this.available) throw new AgentError("RESEARCH_BUILD_REQUIRED");
    this.recovery ??= (async () => {
      await this.repository.dispatch({ type: "RECOVER", owner: this.owner });
      const store = await this.repository.read();
      for (const run of store.runs)
        if (run.state === "OBSERVING" && !run.lease)
          await this.repository.dispatch({
            type: "PAUSE",
            runId: run.id,
            reason: "WORKER_RESTART",
          });
    })().catch((error: unknown) => {
      this.recovery = undefined;
      throw error;
    });
    await this.recovery;
  }
  async status() {
    await this.ready();
    this.outboxQueue = this.outboxQueue
      .catch(() => undefined)
      .then(async () => {
        const store = await this.repository.read();
        for (const item of store.outbox.filter(
          (x) => !x.acknowledged && x.type === "LOCAL_PREPARATION",
        )) {
          const run = store.runs.find((x) => x.id === item.runId);
          if (
            !run ||
            run.binding.url !== AGENT_EXECUTION_URL ||
            !run.journal.some((x) => x.code === "PREPARED")
          )
            throw new Error("INVALID_PREPARATION");
          await this.prepared(run);
          await this.repository.dispatch({ type: "ACK_OUTBOX", id: item.id });
        }
      });
    await this.outboxQueue;
    const store = await this.repository.read();
    return AgentLabStatusSchema.parse({
      kind: "AGENT_LAB_STATUS",
      available: true,
      enabled: store.enabled,
      runs: [...store.runs].reverse().map((run) => ({
        id: run.id,
        state: run.state,
        revision: run.revision,
        updatedAt: run.updatedAt,
        pauseReason: run.pauseReason,
        actions: run.budget.actions,
        fieldCount: run.observation?.fieldCount ?? null,
        events: run.journal,
      })),
    });
  }
  async enable(enabled: boolean) {
    await this.ready();
    if (!enabled)
      for (const run of (await this.repository.read()).runs)
        if (!["CANCELLED", "CONFIRMED", "FAILED", "OUTCOME_UNKNOWN"].includes(run.state))
          await this.stop(run.id, false);
    await this.repository.dispatch({ type: "SET_ENABLED", enabled });
    return this.status();
  }
  async start(approved: boolean) {
    await this.ready();
    if (!approved) throw new Error("SYNTHETIC_PROFILE_APPROVAL_REQUIRED");
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined || tab.url !== AGENT_EXECUTION_URL)
      throw new Error("LOCAL_EXECUTION_PAGE_REQUIRED");
    const documentId = await this.transport.connect(tab.id);
    const revision = await this.profileRevision();
    const now = Date.now();
    const id = crypto.randomUUID();
    await this.repository.dispatch({
      type: "CREATE",
      id,
      applicationId: `synthetic:${id}`,
      binding: {
        tabId: tab.id,
        documentId,
        url: AGENT_EXECUTION_URL,
        profileRevision: revision,
        profileKey: await this.profileKey(),
      },
      consent: {
        id: crypto.randomUUID(),
        applicationId: `synthetic:${id}`,
        profileRevision: revision,
        url: AGENT_EXECUTION_URL,
        capabilities: [
          "FILL_TEXT",
          "SELECT_OPTION",
          "NEXT",
          "OPEN_CONTROL",
          "ADD_ROW",
          "REMOVE_ROW",
          "UPLOAD_FILE",
        ],
        expiresAt: now + 30 * 60_000,
        submissionApproved: false,
      },
      budget: {
        actions: 0,
        spentCostMicros: 0,
        maxActions: 30,
        maxCostMicros: 0,
        expiresAt: now + 30 * 60_000,
      },
    });
    this.launch(id);
    return this.status();
  }
  async resume(id: string) {
    await this.ready();
    const run = (await this.repository.read()).runs.find((x) => x.id === id);
    if (!run || !["PAUSED", "OBSERVING"].includes(run.state)) throw new Error("RUN_NOT_RESUMABLE");
    if (this.running.has(id)) {
      if (run.state !== "PAUSED") throw new Error("RUN_BUSY");
      await this.tasks.get(id);
    }
    this.stopped.delete(id);
    this.launch(id);
    return this.status();
  }
  private launch(id: string) {
    if (this.running.has(id)) return;
    this.running.add(id);
    const task = this.loop(id)
      .catch(async (error: unknown) => {
        const run = (await this.repository.read()).runs.find((x) => x.id === id);
        if (run && !["CANCELLED", "PAUSED", "CONFIRMED", "OUTCOME_UNKNOWN"].includes(run.state))
          await this.repository.dispatch({
            type: "PAUSE",
            runId: id,
            reason:
              error instanceof Error && error.message === "PROFILE_CHANGED"
                ? "PROFILE_CHANGED"
                : error instanceof Error && error.message === "ACCESS_CHANGED"
                  ? "ACCESS_CHANGED"
                  : error instanceof Error && error.message === "ACCESS_CHALLENGE"
                    ? "ACCESS_CHALLENGE"
                    : error instanceof Error && error.message === "VALIDATION_REQUIRED"
                      ? "VALIDATION_REQUIRED"
                      : error instanceof Error &&
                          ["REPEATED_ACTION_LOOP", "LOOP_LIMIT"].includes(error.message)
                        ? "LOOP_DETECTED"
                        : "ACTION_FAILED",
          });
      })
      .catch(() => undefined)
      .finally(() => {
        this.running.delete(id);
        this.tasks.delete(id);
      });
    this.tasks.set(id, task);
  }
  async stop(id: string, cancel: boolean) {
    await this.ready();
    this.stopped.add(id);
    const store = await this.repository.read();
    const run = store.runs.find((x) => x.id === id);
    if (!run) throw new Error("RUN_NOT_FOUND");
    // Mark stopped before awaiting IO. REVOKE shares the ordered document port
    // with dispatch: an already committed action may finish, no later one starts.
    await this.transport.revoke(run.binding.tabId, store.fence).catch(() => undefined);
    const current = (await this.repository.read()).runs.find((x) => x.id === id);
    if (current && !["CANCELLED", "CONFIRMED", "FAILED", "OUTCOME_UNKNOWN"].includes(current.state))
      await this.repository.dispatch(
        cancel
          ? { type: "CANCEL", runId: id }
          : { type: "PAUSE", runId: id, reason: "USER_PAUSED" },
      );
    await this.tasks.get(id);
    return this.status();
  }
  private async context(run: AgentRun) {
    if (this.stopped.has(run.id)) throw new Error("STOPPED");
    const tab = await chrome.tabs.get(run.binding.tabId);
    if (tab.url !== AGENT_EXECUTION_URL || !tab.active) throw new Error("ACCESS_CHANGED");
    if (
      (await this.profileRevision()) !== run.binding.profileRevision ||
      (await this.profileKey()) !== run.binding.profileKey
    )
      throw new Error("PROFILE_CHANGED");
  }
  private async loop(id: string) {
    for (let iteration = 0; iteration < 30; iteration++) {
      let run = (
        await this.repository.dispatch({ type: "ACQUIRE", runId: id, owner: this.owner })
      ).runs.find((x) => x.id === id)!;
      await this.context(run);
      const documentId = await this.transport.connect(run.binding.tabId);
      const fence = run.lease!.fence;
      const snapshot = ExecutionSnapshotSchema.parse(
        await this.transport.request(run.binding.tabId, {
          type: "OBSERVE",
          id: crypto.randomUUID(),
          fence,
          binding: { ...run.binding, documentId },
        }),
      );
      run = (
        await this.repository.dispatch({
          type: "OBSERVE",
          runId: id,
          owner: this.owner,
          fence,
          observation: snapshot.observation,
        })
      ).runs.find((x) => x.id === id)!;
      if (snapshot.blocked) throw new Error("ACCESS_CHALLENGE");
      if (snapshot.validation) throw new Error("VALIDATION_REQUIRED");
      if (snapshot.complete && snapshot.step === "review") {
        await this.context(run);
        await this.repository.dispatch({
          type: "YIELD",
          runId: id,
          owner: this.owner,
          fence,
          prepared: true,
        });
        await this.status();
        return;
      }
      const workflow = await this.workflowMemory();
      // Stored procedures only prioritize current supported fields. Native page
      // validity, fresh targets, reviewed facts and dispatch authority still apply.
      const preferred = workflow?.steps.flatMap((step) =>
        snapshot.targets.filter(
          (target) =>
            target.kind === step.kind &&
            target.semantic === step.parameter &&
            ["FILL_TEXT", "SELECT_OPTION", "OPEN_CONTROL", "UPLOAD_FILE"].includes(target.kind) &&
            !!DEMO_FACTS[step.parameter] &&
            (target.kind !== "SELECT_OPTION" ||
              target.options.some((option) => option.value === DEMO_FACTS[step.parameter])),
        ),
      )[0];
      const target =
        snapshot.targets.find((x) => x.kind === "REMOVE_ROW" && x.semantic === "removeExtra") ??
        preferred ??
        snapshot.targets.find(
          (x) =>
            ["FILL_TEXT", "SELECT_OPTION", "OPEN_CONTROL", "UPLOAD_FILE"].includes(x.kind) &&
            x.semantic &&
            DEMO_FACTS[x.semantic] &&
            (x.kind !== "SELECT_OPTION" ||
              x.options.some((option) => option.value === DEMO_FACTS[x.semantic!])),
        ) ??
        (snapshot.step === "experience" && snapshot.rowCount === 0
          ? snapshot.targets.find((x) => x.kind === "ADD_ROW")
          : undefined) ??
        snapshot.targets.find((x) => x.kind === "NEXT");
      if (!target) throw new Error("NO_SAFE_ACTION");
      if (
        run.intents.filter(
          (x) => x.proposal.kind === target.kind && x.proposal.targetRef === target.id,
        ).length >= 3
      )
        throw new Error("REPEATED_ACTION_LOOP");
      const fact = await this.fact(target, run);
      let proposal: AgentProposal;
      if (target.kind === "FILL_TEXT" || target.kind === "SELECT_OPTION") {
        const planner = prepareLocalAction(
          {
            observation: { ...snapshot.observation, targetRefs: [target.id], fieldCount: 1 },
            targets: [target],
          },
          [{ ...fact, semantic: target.semantic! }],
        );
        const planned = planner.accept(planner.deterministic(), id, Date.now() + 5000);
        if (!planned) throw new Error("NO_SAFE_ACTION");
        proposal = planned.proposal;
      } else
        proposal = {
          id: crypto.randomUUID(),
          runId: id,
          observationId: snapshot.observation.id,
          kind: target.kind,
          targetRef: target.id,
          factRefs: target.kind === "UPLOAD_FILE" ? [fact.factRef] : [],
          expected:
            target.kind === "NEXT"
              ? "STEP_CHANGED"
              : target.kind === "OPEN_CONTROL"
                ? "CONTROL_OPENED"
                : target.kind === "UPLOAD_FILE"
                  ? "FILE_RETAINED"
                  : "ROW_CHANGED",
          expiresAt: Date.now() + 5000,
          costMicros: 0,
        };
      if (preferred === target && workflow) {
        const currentWorkflow = await this.workflowMemory();
        if (currentWorkflow?.id !== workflow.id || currentWorkflow.revision !== workflow.revision)
          throw new Error("MEMORY_CHANGED");
        proposal = { ...proposal, memoryRef: { id: workflow.id, revision: workflow.revision } };
      }
      await this.context(run);
      const claimed = await this.repository.dispatch({
        type: "CLAIM",
        runId: id,
        owner: this.owner,
        fence,
        current: snapshot.observation,
        proposal,
        verifiedFactRefs: [fact.factRef],
      });
      const ticket = ticketForRun(claimed.runs.find((x) => x.id === id)!);
      await this.context(run);
      const authority = await this.repository.dispatch({
        type: "RECEIVE",
        ticket,
        current: snapshot.observation,
      });
      if (this.stopped.has(id)) throw new Error("STOPPED");
      let matched = false;
      try {
        await this.transport.request(run.binding.tabId, {
          type: "DISPATCH",
          id: crypto.randomUUID(),
          ticket,
          proposal,
          fact,
          authority,
        });
        // Verify after page handlers have run, not from the dispatch acknowledgement.
        await new Promise((resolve) => setTimeout(resolve, 200));
        await this.context(run);
        matched =
          (await this.transport.request(run.binding.tabId, {
            type: "VERIFY",
            id: crypto.randomUUID(),
            ticket,
            fact,
          })) === true;
      } catch (error) {
        if (proposal.kind !== "NEXT") throw error;
        // Navigation may destroy the receiver before its reply. Reconcile by
        // reading the new document; never redispatch the click.
        await new Promise((resolve) => setTimeout(resolve, 200));
        await this.context(run);
        const nextDocument = await this.transport.connect(run.binding.tabId);
        if (nextDocument === ticket.binding.documentId) throw error;
        const next = ExecutionSnapshotSchema.parse(
          await this.transport.request(run.binding.tabId, {
            type: "OBSERVE",
            id: crypto.randomUUID(),
            fence,
            binding: { ...run.binding, documentId: nextDocument },
          }),
        );
        matched =
          !next.blocked &&
          !next.validation &&
          next.step ===
            ({ contact: "experience", experience: "review" } as Record<string, string>)[
              snapshot.step
            ];
      }
      await this.repository.dispatch({
        type: "VERIFY",
        ticket,
        matched,
        applicationId: run.applicationId,
      });
      if (!matched) return;
      await this.repository.dispatch({
        type: "YIELD",
        runId: id,
        owner: this.owner,
        fence,
        prepared: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (this.stopped.has(id)) return;
    }
    throw new Error("LOOP_LIMIT");
  }
  private async fact(target: LocalTarget, run: AgentRun): Promise<ApprovedLocalFact> {
    const fact: ApprovedLocalFact = {
      targetRef: target.id,
      factRef: `demo.${target.semantic || "control"}`,
      profileRevision: run.binding.profileRevision,
      value: DEMO_FACTS[target.semantic ?? ""] ?? "",
    };
    if (target.kind === "UPLOAD_FILE") {
      const text = "Synthetic resume for Nora Example. Not a real candidate.\n";
      const bytes = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      fact.file = {
        name: "synthetic-resume.txt",
        base64: btoa(text),
        sha256: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(""),
      };
    }
    return fact;
  }
}
