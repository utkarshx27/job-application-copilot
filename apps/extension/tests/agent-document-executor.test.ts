// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://127.0.0.1:4173/workday.html"}

import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_FIXTURE_URL,
  emptyAgentStore,
  reduceAgentStore,
  ticketForRun,
  type AgentBinding,
  type AgentOperation,
  type AgentStore,
} from "@copilot/agent-core";
import { LocalDocumentExecutor } from "../src/agent-document-executor";
import { prepareLocalAction } from "../src/agent-action-planner";
import {
  InferenceRouter,
  MemoryInferenceBudgetStore,
  createInferenceFixtureProvider,
} from "@copilot/ai-gateway";

describe("local document executor boundary", () => {
  let executor: LocalDocumentExecutor;
  let binding: AgentBinding;
  let store: AgentStore;
  let now: number;
  const dispatch = (operation: AgentOperation) => {
    store = reduceAgentStore(store, operation, now);
  };
  beforeEach(() => {
    vi.stubGlobal("crypto", webcrypto);
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
    document.body.innerHTML = '<label>Email<input type="email" id="email"></label>';
    now = Date.now();
    binding = { tabId: 1, documentId: "document-1", url: AGENT_FIXTURE_URL, profileRevision: 4 };
    store = emptyAgentStore();
    dispatch({ type: "SET_ENABLED", enabled: true });
    executor = new LocalDocumentExecutor(
      document,
      () => binding,
      () => now,
    );
  });
  afterEach(() => {
    executor.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function prepare(value = "synthetic@example.test") {
    const snapshot = await executor.observe();
    const target = snapshot.targets[0];
    if (!target) throw new Error("Missing test target");
    const runId = crypto.randomUUID();
    const planner = prepareLocalAction(snapshot, [
      {
        targetRef: target.id,
        factRef: "contact.email",
        profileRevision: 4,
        value,
        semantic: "CONTACT.email",
      },
    ]);
    const plan = planner.accept(planner.deterministic(), runId, now + 10_000);
    if (!plan) throw new Error("Missing test plan");
    dispatch({
      type: "CREATE",
      id: runId,
      applicationId: "local-test",
      binding,
      consent: {
        id: crypto.randomUUID(),
        applicationId: "local-test",
        profileRevision: 4,
        url: AGENT_FIXTURE_URL,
        capabilities: ["FILL_TEXT", "SELECT_OPTION"],
        expiresAt: now + 60_000,
        submissionApproved: false,
      },
      budget: {
        actions: 0,
        spentCostMicros: 0,
        maxActions: 5,
        maxCostMicros: 0,
        expiresAt: now + 60_000,
      },
    });
    const owner = crypto.randomUUID();
    dispatch({ type: "ACQUIRE", runId, owner });
    const fence = store.runs[0]!.lease!.fence;
    dispatch({ type: "OBSERVE", runId, owner, fence, observation: snapshot.observation });
    dispatch({
      type: "CLAIM",
      runId,
      owner,
      fence,
      proposal: plan.proposal,
      current: snapshot.observation,
      verifiedFactRefs: [plan.fact.factRef],
    });
    const ticket = ticketForRun(store.runs[0]!);
    const receive = () => dispatch({ type: "RECEIVE", ticket, current: snapshot.observation });
    const execute = () => executor.execute(ticket, plan.proposal, plan.fact, () => store);
    return { snapshot, planner, plan, ticket, runId, receive, execute };
  }

  it("uses a durable received intent, native events, and separate read-back verification", async () => {
    const p = await prepare();
    const events: string[] = [];
    document.getElementById("email")!.addEventListener("input", () => events.push("input"));
    document.getElementById("email")!.addEventListener("change", () => events.push("change"));
    expect(executor.verify(p.ticket, p.plan.fact)).toBe(false);
    expect(p.execute).toThrow(/authority revoked/);
    p.receive();
    expect(p.execute()).toEqual({ intentId: p.ticket.intentId, dispatched: true });
    expect(events).toEqual(["input", "change"]);
    expect(executor.verify(p.ticket, p.plan.fact)).toBe(true);
    dispatch({ type: "VERIFY", ticket: p.ticket, applicationId: "local-test", matched: true });
    expect(store.runs[0]?.journal.at(-1)?.code).toBe("ACTION_VERIFIED");
    expect(JSON.stringify(store)).not.toContain("synthetic@example.test");
    expect(p.execute).toThrow(/duplicate receipt/);
  });

  it("selects by exact option value, never by index", async () => {
    document.body.innerHTML =
      '<label>Location<select><option value="">Choose</option><option value="IN">India</option></select></label>';
    const p = await prepare("IN");
    p.receive();
    p.execute();
    expect(document.querySelector("select")!.value).toBe("IN");
    expect(executor.verify(p.ticket, p.plan.fact)).toBe(true);
  });

  it("rejects duplicate option values", async () => {
    document.body.innerHTML =
      '<label>Location<select><option value="">Choose</option><option value="IN">India</option><option value="IN">Different</option></select></label>';
    const p = await prepare("IN");
    p.receive();
    expect(p.execute).toThrow(/ambiguous option/);
  });

  it.each(["pause", "cancel", "disable", "restart", "lease"])(
    "rejects revoked authority: %s",
    async (kind) => {
      const p = await prepare();
      p.receive();
      if (kind === "pause") dispatch({ type: "PAUSE", runId: p.runId, reason: "USER_PAUSED" });
      if (kind === "cancel") dispatch({ type: "CANCEL", runId: p.runId });
      if (kind === "disable") dispatch({ type: "SET_ENABLED", enabled: false });
      if (kind === "restart") dispatch({ type: "RECOVER", owner: crypto.randomUUID() });
      if (kind === "lease") store.runs[0]!.lease!.expiresAt = now;
      expect(p.execute).toThrow(/authority revoked/);
      expect((document.querySelector("input") as HTMLInputElement).value).toBe("");
    },
  );

  it.each(["profile", "document", "tab", "time", "replace", "label", "viewport", "options"])(
    "rejects stale context: %s",
    async (kind) => {
      const p = await prepare();
      p.receive();
      if (kind === "profile") binding = { ...binding, profileRevision: 5 };
      if (kind === "document") binding = { ...binding, documentId: "new-document" };
      if (kind === "tab") binding = { ...binding, tabId: 2 };
      if (kind === "time") now += 16_000;
      if (kind === "replace")
        document.getElementById("email")!.replaceWith(document.createElement("input"));
      if (kind === "label")
        document.querySelector("label")!.firstChild!.textContent = "Different question";
      if (kind === "viewport") vi.stubGlobal("innerWidth", window.innerWidth + 1);
      if (kind === "options") document.body.append(document.createElement("select"));
      expect(p.execute).toThrow(/stale observation/);
    },
  );

  it("protects property-only edits and edits cleared back to blank", async () => {
    const p = await prepare();
    p.receive();
    const input = document.querySelector("input")!;
    input.value = "user@example.test";
    expect(p.execute).toThrow(/user value changed/);
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(p.execute).toThrow(/stale observation/);
    expect((await executor.observe()).targets).toEqual([]);
  });

  it("omits populated, hidden, unsupported, and sensitive controls", async () => {
    document.body.innerHTML = `<label>Email<input value="existing@example.test"></label>
      <label>Password<input type="password"></label><label>Consent<input type="checkbox"></label>
      <label>Disabled<input disabled></label><label>Read only<input readonly></label>
      <label hidden>Hidden<input></label><label>Country<input role="combobox"></label>
      <label>Citizenship<input></label><input><label>Upload<input type="file"></label>`;
    expect((await executor.observe()).targets).toEqual([]);
  });

  it("does not count a framework-rejected value as retained or retry it", async () => {
    const p = await prepare();
    p.receive();
    const input = document.querySelector("input")!;
    input.addEventListener("change", () => {
      input.value = "";
    });
    p.execute();
    expect(executor.verify(p.ticket, p.plan.fact)).toBe(false);
    expect(p.execute).toThrow(/duplicate receipt/);
  });

  it("detects delayed application rejection and invalid values", async () => {
    const p = await prepare("not-an-email");
    p.receive();
    p.execute();
    expect(executor.verify(p.ticket, p.plan.fact)).toBe(false);
    await Promise.resolve();
    document.querySelector("input")!.value = "changed@example.test";
    expect(executor.verify(p.ticket, p.plan.fact)).toBe(false);
  });

  it("does not verify a substituted fact or replacement target", async () => {
    const p = await prepare();
    p.receive();
    p.execute();
    expect(executor.verify(p.ticket, { ...p.plan.fact, factRef: "other.fact" })).toBe(false);
    document.getElementById("email")!.replaceWith(document.createElement("input"));
    expect(executor.verify(p.ticket, p.plan.fact)).toBe(false);
  });

  it("rejects an unapproved value binding and a changed proposal", async () => {
    const p = await prepare();
    p.receive();
    expect(() =>
      executor.execute(
        p.ticket,
        p.plan.proposal,
        { ...p.plan.fact, profileRevision: 3 },
        () => store,
      ),
    ).toThrow(/unapproved value/);
    expect(() =>
      executor.execute(
        p.ticket,
        { ...p.plan.proposal, expiresAt: now + 9999 },
        p.plan.fact,
        () => store,
      ),
    ).toThrow(/authority revoked/);
  });

  it("blocks all action kinds except native text and select", async () => {
    const p = await prepare();
    p.receive();
    expect(() =>
      executor.execute(
        p.ticket,
        { ...p.plan.proposal, kind: "NEXT", expected: "STEP_CHANGED" },
        p.plan.fact,
        () => store,
      ),
    ).toThrow(/unsupported action/);
  });

  it("rejects a non-allowlisted document and disposal", async () => {
    window.history.replaceState(null, "", "/other.html");
    await expect(executor.observe()).rejects.toThrow(/local fixture required/);
    window.history.replaceState(null, "", "/workday.html");
    executor.dispose();
    await expect(executor.observe()).rejects.toThrow(/executor disposed/);
  });

  it("keeps values out of inference and rejects unknown, stale or injected proposals", async () => {
    const p = await prepare();
    expect(JSON.stringify(p.planner.request)).not.toContain(p.plan.fact.value);
    const valid = p.planner.deterministic();
    expect(() => p.planner.accept({ ...valid, observationRef: "old" }, p.runId, now + 1)).toThrow(
      "STALE_OBSERVATION",
    );
    expect(() =>
      p.planner.accept(
        { ...valid, action: { kind: "NEXT", targetRef: p.plan.fact.targetRef, factRef: null } },
        p.runId,
        now + 1,
      ),
    ).toThrow("UNAUTHORIZED_PROPOSAL");
    expect(() =>
      p.planner.accept(
        { ...valid, action: { ...valid.action, value: "injected" } },
        p.runId,
        now + 1,
      ),
    ).toThrow("INVALID_OUTPUT");
    expect(() =>
      p.planner.accept(
        { ...valid, action: { ...valid.action, factRef: "invented" } },
        p.runId,
        now + 1,
      ),
    ).toThrow("INVALID_FACT_REFERENCE");
    expect(p.planner.accept({ ...valid, action: null }, p.runId, now + 1)).toBeNull();
  });

  it("never guesses unreviewed mappings or mutates captured planning inputs", async () => {
    const snapshot = await executor.observe();
    const planner = prepareLocalAction(snapshot, []);
    expect(planner.deterministic().action).toBeNull();
    const mapping = {
      targetRef: snapshot.targets[0]!.id,
      factRef: "email",
      semantic: "CONTACT.email",
      profileRevision: 4,
      value: "original@example.test",
    };
    const approved = prepareLocalAction(snapshot, [mapping]);
    mapping.value = "replaced@example.test";
    approved.request.targets[0]!.allowedActions.push("NEXT");
    expect(
      approved.accept(approved.deterministic(), crypto.randomUUID(), now + 10)?.fact.value,
    ).toBe("original@example.test");
    expect(() => prepareLocalAction(snapshot, [mapping, mapping])).toThrow(/ambiguous mapping/);
  });

  it("routes a synthetic proposal through the metered gateway without granting execution", async () => {
    const p = await prepare();
    const budget = new MemoryInferenceBudgetStore({
      version: 1,
      runId: p.runId,
      maxCostMicros: 0,
      maxAttempts: 1,
      expiresAt: Date.now() + 60_000,
      attempts: [],
    });
    const router = new InferenceRouter(budget);
    const result = await router.execute(
      createInferenceFixtureProvider(() =>
        Promise.resolve({
          output: p.planner.deterministic(),
          usage: { inputTokens: 100, outputTokens: 40, reasoningTokens: 0 },
          modelVersion: "synthetic-local-action-v1",
        }),
      ),
      p.planner.request,
      {
        provider: "FIXTURE",
        model: "agent-fixture-v1",
        checkedAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        source: "synthetic-only",
        inputUsdPerMillion: 0,
        outputUsdPerMillion: 0,
      },
      {
        runId: p.runId,
        localOnly: true,
        approvedCloudProviders: [],
        maxInputTokens: 8192,
        maxOutputTokens: 512,
        timeoutMs: 1000,
        retries: 0,
      },
    );
    expect(p.planner.accept(result.output, p.runId, now + 1000)?.fact.value).toBe(
      p.plan.fact.value,
    );
    expect(p.execute).toThrow(/authority revoked/);
    expect(document.querySelector("input")!.value).toBe("");
  });

  it("rechecks the DOM after authority resolution and rejects expired intents", async () => {
    const p = await prepare();
    p.receive();
    expect(() =>
      executor.execute(p.ticket, p.plan.proposal, p.plan.fact, () => {
        document.querySelector("input")!.value = "user@example.test";
        return store;
      }),
    ).toThrow(/user value changed/);
    document.querySelector("input")!.value = "";
    now += 10_001;
    expect(p.execute).toThrow(/authority revoked/);
  });

  it("rejects altered option order before dispatch", async () => {
    document.body.innerHTML =
      '<label>Location<select><option value="">Choose</option><option value="IN">India</option><option value="GB">UK</option></select></label>';
    const p = await prepare("IN");
    p.receive();
    const select = document.querySelector("select")!;
    select.append(select.options[1]!);
    expect(p.execute).toThrow(/stale observation/);
    expect(select.value).toBe("");
  });

  it("rejects overlong text before dispatch", async () => {
    document.querySelector("input")!.maxLength = 3;
    const p = await prepare();
    p.receive();
    expect(p.execute).toThrow(/value too long/);
    expect(document.querySelector("input")!.value).toBe("");
  });
});
