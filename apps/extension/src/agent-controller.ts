import {
  AGENT_FIXTURE_URL,
  AgentLabStatusSchema,
  AgentObservationSchema,
  AgentError,
  createAgentReceiver,
  isAgentFixtureUrl,
  ticketForRun,
  type AgentLabStatus,
  type AgentObservation,
  type AgentPauseReasonSchema,
} from "@copilot/agent-core";
import type { z } from "zod";
import type { AgentRepository } from "./agent-storage";

export type AgentBrowser = {
  activeTab: () => Promise<{ id: number; url: string }>;
  observe: (tabId: number, profileRevision: number) => Promise<AgentObservation>;
  profileRevision: () => Promise<number>;
};

export function agentLabErrorMessage(error: unknown): string {
  const messages: Record<string, string> = {
    LOCAL_FIXTURE_REQUIRED:
      "Open http://127.0.0.1:4173/workday.html in the active tab. The agent lab only supports that exact local page.",
    FEATURE_DISABLED: "Enable the local agent lab before starting a run.",
    RESEARCH_BUILD_REQUIRED: "Load the separate research build to use the agent lab.",
    APPLICATION_ALREADY_ACTIVE:
      "A run already exists for this tab. Resume or cancel that run before starting another.",
    PROFILE_CHANGED:
      "Your profile changed. Cancel this run and start a new one to approve the updated profile revision.",
    RUN_EXPIRED: "This run's 30-minute approval expired. Cancel it and start a new run.",
    BUDGET_EXHAUSTED:
      "This run reached its checkpoint limit. Cancel it before starting another run.",
    LEASE_BUSY: "This run is already busy. Refresh its status before trying again.",
    STALE_LEASE: "The run stopped or its controller changed. Refresh its status before resuming.",
    CONTEXT_CHANGED:
      "The page changed during the checkpoint. Refresh run status and resume to inspect it again.",
    RUN_NOT_RESUMABLE:
      "Enable the lab and choose a non-terminal run. Cancelled or uncertain runs cannot resume.",
  };
  const knownMessage = error instanceof AgentError ? messages[error.code] : undefined;
  return (
    knownMessage ??
    "Agent operation stopped. Check that the local fixture is running and accessible, then refresh runs for details. Storage errors are not reset automatically."
  );
}

/** AG-01's only browser operation is reading a checkpoint. It cannot fill or submit. */
export class AgentLabController {
  private readonly owner = crypto.randomUUID();
  private recovery: Promise<unknown> | undefined;
  private readonly receiver = createAgentReceiver();
  constructor(
    private readonly repository: AgentRepository,
    private readonly browser: AgentBrowser,
    private readonly available: boolean,
    private readonly clock = Date.now,
  ) {}

  private async ready() {
    if (!this.available) throw new AgentError("RESEARCH_BUILD_REQUIRED");
    this.recovery ??= this.repository
      .dispatch({ type: "RECOVER", owner: this.owner }, this.clock())
      .catch((error: unknown) => {
        this.recovery = undefined;
        throw error;
      });
    await this.recovery;
  }

  async status(): Promise<AgentLabStatus> {
    if (!this.available)
      return { kind: "AGENT_LAB_STATUS", available: false, enabled: false, runs: [] };
    await this.ready();
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

  async setEnabled(enabled: boolean) {
    await this.ready();
    await this.repository.dispatch({ type: "SET_ENABLED", enabled }, this.clock());
    return this.status();
  }

  async start() {
    await this.ready();
    if (!(await this.repository.read()).enabled) throw new AgentError("FEATURE_DISABLED");
    const tab = await this.browser.activeTab();
    if (!isAgentFixtureUrl(tab.url)) throw new AgentError("LOCAL_FIXTURE_REQUIRED");
    const profileRevision = await this.browser.profileRevision();
    const observation = AgentObservationSchema.parse(
      await this.browser.observe(tab.id, profileRevision),
    );
    const now = this.clock();
    const id = crypto.randomUUID();
    await this.repository.dispatch(
      {
        type: "CREATE",
        id,
        applicationId: `checkpoint:${tab.id}`,
        binding: observation.binding,
        consent: {
          id: crypto.randomUUID(),
          applicationId: `checkpoint:${tab.id}`,
          profileRevision,
          url: AGENT_FIXTURE_URL,
          capabilities: ["READ_PAGE"],
          expiresAt: now + 30 * 60_000,
          submissionApproved: false,
        },
        budget: {
          maxActions: 20,
          maxCostMicros: 0,
          expiresAt: now + 30 * 60_000,
          actions: 0,
          spentCostMicros: 0,
        },
      },
      now,
    );
    return this.checkpoint(id);
  }

  async checkpoint(runId: string) {
    await this.ready();
    let acquiredFence: number | undefined;
    try {
      const now = this.clock();
      const store = await this.repository.dispatch(
        { type: "ACQUIRE", runId, owner: this.owner },
        now,
      );
      const run = store.runs.find((r) => r.id === runId);
      if (!run?.lease) throw new AgentError("RUN_NOT_FOUND");
      acquiredFence = run.lease.fence;
      if ((await this.browser.profileRevision()) !== run.binding.profileRevision)
        throw new AgentError("PROFILE_CHANGED");
      const observation = AgentObservationSchema.parse(
        await this.browser.observe(run.binding.tabId, run.binding.profileRevision),
      );
      const fence = run.lease.fence;
      await this.repository.dispatch(
        { type: "OBSERVE", runId, owner: this.owner, fence, observation },
        this.clock(),
      );
      const current = AgentObservationSchema.parse(
        await this.browser.observe(run.binding.tabId, run.binding.profileRevision),
      );
      // A new probe has its own ID. Preserve the plan's observation identity while
      // checking the new document/fingerprint independently in CLAIM and RECEIVE.
      current.id = observation.id;
      const claimed = await this.repository.dispatch(
        {
          type: "CLAIM",
          runId,
          owner: this.owner,
          fence,
          current,
          verifiedFactRefs: [],
          proposal: {
            id: crypto.randomUUID(),
            runId,
            observationId: observation.id,
            kind: "READ_PAGE",
            targetRef: null,
            factRefs: [],
            expected: "CHECKPOINT_RECORDED",
            expiresAt: this.clock() + 10_000,
            costMicros: 0,
          },
        },
        this.clock(),
      );
      const claimedRun = claimed.runs.find((r) => r.id === runId);
      if (!claimedRun) throw new AgentError("RUN_NOT_FOUND");
      const ticket = ticketForRun(claimedRun);
      const received = await this.repository.dispatch(
        { type: "RECEIVE", ticket, current },
        this.clock(),
      );
      const active = received.runs.find((r) => r.id === runId);
      this.receiver(ticket, current, active?.lease?.fence ?? -1, this.clock(), () => {
        // Receipt acknowledges this read-only snapshot; no browser mutation exists.
      });
      if ((await this.browser.profileRevision()) !== run.binding.profileRevision)
        throw new AgentError("PROFILE_CHANGED");
      await this.repository.dispatch(
        { type: "VERIFY", ticket, matched: true, applicationId: run.applicationId },
        this.clock(),
      );
      return this.status();
    } catch (error) {
      if (acquiredFence !== undefined) {
        const state = await this.repository.read();
        const run = state.runs.find((r) => r.id === runId);
        if (
          run?.lease?.owner === this.owner &&
          run.lease.fence === acquiredFence &&
          ["OBSERVING", "PLANNING", "EXECUTING"].includes(run.state)
        ) {
          const reason: z.infer<typeof AgentPauseReasonSchema> =
            error instanceof AgentError && error.code === "PROFILE_CHANGED"
              ? "PROFILE_CHANGED"
              : "ACTION_FAILED";
          await this.repository.dispatch(
            {
              type: "PAUSE",
              runId,
              reason,
              expectedLease: { owner: this.owner, fence: acquiredFence },
            },
            this.clock(),
          );
        }
      }
      throw error;
    }
  }

  async pause(runId: string) {
    await this.ready();
    await this.repository.dispatch({ type: "PAUSE", runId, reason: "USER_PAUSED" }, this.clock());
    return this.status();
  }
  async cancel(runId: string) {
    await this.ready();
    await this.repository.dispatch({ type: "CANCEL", runId }, this.clock());
    return this.status();
  }
}

export async function observeAgentTab(
  tabId: number,
  profileRevision: number,
): Promise<AgentObservation> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !isAgentFixtureUrl(tab.url)) throw new AgentError("LOCAL_FIXTURE_REQUIRED");
  const [result] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: async () => {
      if (location.href !== "http://127.0.0.1:4173/workday.html")
        throw new Error("Local fixture required");
      const controls = Array.from(document.querySelectorAll("input, select, textarea, button"))
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => ({
          tag: element.tagName,
          id: element.id,
          type: element.getAttribute("type"),
          disabled: element.hasAttribute("disabled"),
          name: element.getAttribute("name"),
        }));
      // Structural metadata only: never collect values, filenames or page text.
      const bytes = new TextEncoder().encode(JSON.stringify(controls));
      const capturedAt = Date.now();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return {
        url: location.href,
        capturedAt,
        fieldCount: controls.length,
        fingerprint: Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join(""),
      };
    },
  });
  if (!result?.result || !result.documentId) throw new AgentError("DOCUMENT_UNAVAILABLE");
  return AgentObservationSchema.parse({
    id: crypto.randomUUID(),
    binding: { tabId, documentId: result.documentId, url: result.result.url, profileRevision },
    capturedAt: result.result.capturedAt,
    fingerprint: result.result.fingerprint,
    fieldCount: result.result.fieldCount,
    targetRefs: [],
  });
}
