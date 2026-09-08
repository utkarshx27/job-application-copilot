import {
  AgentError,
  AgentObservationSchema,
  AgentProposalSchema,
  AgentStoreSchema,
  AgentTicketSchema,
  OBSERVATION_TTL_MS,
  isAgentLocalUrl,
  type AgentBinding,
  type AgentObservation,
  type AgentProposal,
  type AgentStore,
  type AgentTicket,
} from "@copilot/agent-core";

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement;
export type LocalTarget = {
  id: string;
  label: string;
  kind:
    | "FILL_TEXT"
    | "SELECT_OPTION"
    | "OPEN_CONTROL"
    | "ADD_ROW"
    | "REMOVE_ROW"
    | "NEXT"
    | "UPLOAD_FILE";
  semantic?: string | undefined;
  options: { value: string; label: string }[];
};
export type LocalSnapshot = {
  observation: AgentObservation;
  targets: LocalTarget[];
  step?: string;
  blocked?: boolean;
  complete?: boolean;
  validation?: boolean;
  rowCount?: number;
  fixtureId?: string;
};
export type ApprovedLocalFact = {
  targetRef: string;
  factRef: string;
  profileRevision: number;
  value: string;
  file?: { name: "synthetic-resume.txt"; base64: string; sha256: string } | undefined;
};
type Entry = { element: Control; target: LocalTarget; value: string };

function requireThat(condition: unknown, code: string): asserts condition {
  if (!condition) throw new AgentError(code);
}
function sameBinding(a: AgentBinding, b: AgentBinding) {
  return (
    a.tabId === b.tabId &&
    a.documentId === b.documentId &&
    a.url === b.url &&
    a.profileRevision === b.profileRevision
  );
}

/**
 * First AG-05 building block, not registered on the runtime message bus.
 * Construct only in an isolated document context. The future transport must
 * supply fresh controller authority; page/model data is never that authority.
 */
export class LocalDocumentExecutor {
  private entries = new Map<string, Entry>();
  private readonly ids = new WeakMap<Element, string>();
  private snapshot: AgentObservation | null = null;
  private structure = "";
  private generation = 0;
  private capturedGeneration = -1;
  private readonly edited = new WeakSet<Element>();
  private readonly consumed = new Set<string>();
  private readonly expected = new Map<
    string,
    { entry: Entry; fact: ApprovedLocalFact; ticket: AgentTicket; step: string; rows: number }
  >();
  private applying: Element | null = null;
  private disposed = false;
  private readonly observer: MutationObserver;
  private readonly trackEdit = (event: Event) => {
    const target = event.composedPath()[0];
    if (target instanceof Element && (event.isTrusted || target !== this.applying)) {
      this.edited.add(target);
      this.generation++;
    }
  };

  constructor(
    private readonly doc: Document,
    private readonly binding: () => AgentBinding,
    private readonly clock = Date.now,
  ) {
    this.observer = new MutationObserver((records) => {
      this.generation += records.length;
    });
    this.observer.observe(doc, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    });
    doc.addEventListener("input", this.trackEdit, true);
    doc.addEventListener("change", this.trackEdit, true);
  }

  dispose() {
    this.disposed = true;
    this.observer.disconnect();
    this.doc.removeEventListener("input", this.trackEdit, true);
    this.doc.removeEventListener("change", this.trackEdit, true);
    this.entries.clear();
    this.expected.clear();
    this.snapshot = null;
  }

  private context() {
    requireThat(!this.disposed, "EXECUTOR_DISPOSED");
    const binding = this.binding();
    requireThat(
      isAgentLocalUrl(this.doc.location.href) && binding.url === this.doc.location.href,
      "LOCAL_FIXTURE_REQUIRED",
    );
    return binding;
  }

  private flushMutations() {
    this.generation += this.observer.takeRecords().length;
  }

  private describe(element: Control): Omit<LocalTarget, "id"> | null {
    const localControl = this.doc.location.pathname === "/agent.html";
    const label =
      element.getAttribute("aria-label")?.trim() ||
      Array.from("labels" in element ? (element.labels ?? []) : [])
        .map((x) => x.textContent ?? "")
        .join(" ")
        .trim() ||
      (element instanceof HTMLButtonElement ? element.textContent?.trim() : "") ||
      "";
    // The first receiver handles only visible, labelled, empty native controls.
    // Custom controls, nested documents, shadow roots and sensitive answers wait
    // for their own handlers and review policies; no selector-based fallback.
    if (
      !label ||
      label.length > 2000 ||
      element.getClientRects().length === 0 ||
      element.closest("[hidden], [inert], [aria-hidden='true']") ||
      element.matches(":disabled") ||
      element.getAttribute("aria-disabled") === "true" ||
      element.hasAttribute("readonly") ||
      (element.hasAttribute("role") &&
        !(localControl && element.getAttribute("role") === "combobox")) ||
      this.edited.has(element)
    )
      return null;
    const style = this.doc.defaultView?.getComputedStyle(element);
    if (
      !style ||
      style.visibility !== "visible" ||
      style.display === "none" ||
      style.opacity === "0"
    )
      return null;
    if (
      /password|passport|social security|government|bank|payment|credit card|consent|citizenship|authorization|sponsor|disability|veteran|ethnic|gender/i.test(
        label,
      )
    )
      return null;
    if (
      element instanceof HTMLInputElement &&
      !["text", "email", "tel", "url", ...(localControl ? ["date", "file"] : [])].includes(
        element.type,
      )
    )
      return null;
    if (element instanceof HTMLSelectElement && element.multiple) return null;
    let special: LocalTarget["kind"] | undefined;
    if (element instanceof HTMLButtonElement) {
      if (!localControl || element.type !== "button") return null;
      const buttons: Record<string, LocalTarget["kind"]> = {
        Next: "NEXT",
        "Add experience": "ADD_ROW",
        "Remove empty experience": "REMOVE_ROW",
      };
      special = buttons[label];
      if (!special) return null;
      if (
        special === "REMOVE_ROW" &&
        Array.from(
          element.closest("[data-experience-row]")?.querySelectorAll<HTMLInputElement>("input") ??
            [],
        ).some((x) => x.value !== "")
      )
        return null;
    }
    if (element instanceof HTMLInputElement && element.type === "file") special = "UPLOAD_FILE";
    const list = element.getAttribute("aria-controls");
    const combo = localControl && element.getAttribute("role") === "combobox";
    const listElement = list ? this.doc.getElementById(list) : null;
    if (combo)
      special =
        element.getAttribute("aria-expanded") === "true" && listElement && !listElement.hidden
          ? "SELECT_OPTION"
          : "OPEN_CONTROL";
    const options =
      combo && special === "SELECT_OPTION"
        ? Array.from(listElement?.querySelectorAll<HTMLElement>("[role='option']") ?? [])
            .filter(
              (x) =>
                x.getAttribute("aria-disabled") !== "true" &&
                !x.hidden &&
                x.getClientRects().length > 0,
            )
            .map((x) => ({
              value: x.getAttribute("data-value") ?? "",
              label: x.textContent?.trim() ?? "",
            }))
        : element instanceof HTMLSelectElement
          ? Array.from(element.options)
              .filter((o) => !o.disabled && !o.parentElement?.hasAttribute("disabled"))
              .map((o) => ({ value: o.value, label: o.textContent?.trim() ?? "" }))
          : [];
    if (options.length > 200 || options.some((o) => o.value.length > 2000 || o.label.length > 2000))
      return null;
    return {
      label,
      kind: special ?? (element instanceof HTMLSelectElement ? "SELECT_OPTION" : "FILL_TEXT"),
      options,
      ...(localControl ? { semantic: element.getAttribute("data-agent-field") ?? "" } : {}),
    };
  }

  private signature() {
    return JSON.stringify({
      viewport: [this.doc.defaultView?.innerWidth, this.doc.defaultView?.innerHeight],
      targets: [...this.entries].map(([id, entry]) => ({
        id,
        connected: entry.element.isConnected && entry.element.ownerDocument === this.doc,
        description: this.describe(entry.element),
      })),
    });
  }

  async observe(): Promise<LocalSnapshot> {
    const binding = this.context();
    this.snapshot = null;
    this.entries.clear();
    this.flushMutations();
    const controls = this.doc.querySelectorAll<Control>("input, textarea, select, button");
    requireThat(controls.length <= 2000, "CONTROL_LIMIT");
    for (const element of controls) {
      const description = this.describe(element);
      if (!description || (!(element instanceof HTMLButtonElement) && element.value !== ""))
        continue;
      const id = this.ids.get(element) ?? crypto.randomUUID();
      this.ids.set(element, id);
      this.entries.set(id, { element, target: { id, ...description }, value: element.value });
    }
    // Limit to the inference task's bounded target set, rather than truncate it.
    requireThat(this.entries.size <= 50, "TARGET_LIMIT");
    const generation = this.generation;
    const signature = this.signature();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signature));
    this.flushMutations();
    requireThat(
      generation === this.generation &&
        signature === this.signature() &&
        sameBinding(binding, this.context()),
      "STALE_OBSERVATION",
    );
    this.structure = signature;
    this.capturedGeneration = generation;
    this.snapshot = AgentObservationSchema.parse({
      id: crypto.randomUUID(),
      binding,
      capturedAt: this.clock(),
      fingerprint: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(
        "",
      ),
      fieldCount: this.entries.size,
      targetRefs: [...this.entries.keys()],
    });
    return structuredClone({
      observation: this.snapshot,
      targets: [...this.entries.values()].map((x) => x.target),
      step: this.step(),
      blocked: !!this.doc.querySelector("[data-agent-challenge]:not([hidden])"),
      validation: !!this.doc.querySelector("[data-agent-validation]:not([hidden])"),
      complete: this.step() === "review",
      rowCount: this.doc.querySelectorAll("[data-experience-row]").length,
      fixtureId: this.doc.querySelector("#agent-form")?.getAttribute("data-agent-job") ?? "",
    });
  }

  private fresh(ticket: AgentTicket) {
    this.flushMutations();
    const observation = this.snapshot;
    requireThat(
      observation &&
        observation.id === ticket.observationId &&
        observation.fingerprint === ticket.fingerprint &&
        sameBinding(ticket.binding, this.context()) &&
        sameBinding(observation.binding, ticket.binding) &&
        this.clock() >= observation.capturedAt &&
        this.clock() - observation.capturedAt <= OBSERVATION_TTL_MS &&
        this.generation === this.capturedGeneration &&
        this.signature() === this.structure,
      "STALE_OBSERVATION",
    );
    // Keep values private; detect property-only edits that emitted no DOM event.
    requireThat(
      [...this.entries.values()].every((x) => x.element.value === x.value),
      "USER_VALUE_CHANGED",
    );
  }

  execute(
    ticketInput: AgentTicket,
    proposalInput: AgentProposal,
    fact: ApprovedLocalFact,
    readAuthority: () => AgentStore,
  ): { intentId: string; dispatched: true } {
    const ticket = AgentTicketSchema.parse(ticketInput);
    const proposal = AgentProposalSchema.parse(proposalInput);
    requireThat(
      [
        "FILL_TEXT",
        "SELECT_OPTION",
        "OPEN_CONTROL",
        "ADD_ROW",
        "REMOVE_ROW",
        "NEXT",
        "UPLOAD_FILE",
      ].includes(proposal.kind) &&
        (this.doc.location.pathname === "/agent.html" ||
          ["FILL_TEXT", "SELECT_OPTION"].includes(proposal.kind)),
      "UNSUPPORTED_ACTION",
    );
    const key = `${ticket.runId}:${ticket.intentId}`;
    requireThat(!this.consumed.has(key), "DUPLICATE_RECEIPT");
    requireThat(this.consumed.size < 100, "RECEIPT_LIMIT");
    this.fresh(ticket);
    const state = AgentStoreSchema.parse(readAuthority());
    const run = state.runs.find((r) => r.id === ticket.runId);
    const intent = run?.intents.find((i) => i.proposal.id === ticket.intentId);
    const now = this.clock();
    requireThat(
      state.enabled &&
        run?.state === "EXECUTING" &&
        run.lease?.owner === ticket.owner &&
        run.lease.fence === ticket.fence &&
        run.lease.expiresAt > now &&
        run.consent.expiresAt > now &&
        run.budget.expiresAt > now &&
        run.consent.capabilities.includes(proposal.kind) &&
        sameBinding(run.binding, ticket.binding) &&
        run.observation?.id === ticket.observationId &&
        run.observation.fingerprint === ticket.fingerprint &&
        intent?.status === "RECEIVED" &&
        intent.fence === ticket.fence &&
        JSON.stringify(intent.proposal) === JSON.stringify(proposal) &&
        proposal.expiresAt > now,
      "AUTHORITY_REVOKED",
    );
    requireThat(
      proposal.runId === ticket.runId &&
        proposal.id === ticket.intentId &&
        proposal.observationId === ticket.observationId &&
        (["FILL_TEXT", "SELECT_OPTION", "UPLOAD_FILE"].includes(proposal.kind)
          ? proposal.factRefs.length === 1 && fact.factRef === proposal.factRefs[0]
          : proposal.factRefs.length === 0) &&
        fact.targetRef === proposal.targetRef &&
        fact.profileRevision === ticket.binding.profileRevision &&
        typeof fact.value === "string" &&
        (fact.value.length > 0 ||
          ["OPEN_CONTROL", "ADD_ROW", "REMOVE_ROW", "NEXT"].includes(proposal.kind)) &&
        fact.value.length <= 2000,
      "UNAPPROVED_VALUE",
    );
    const entry = this.entries.get(fact.targetRef);
    requireThat(entry && entry.target.kind === proposal.kind, "UNKNOWN_TARGET");
    if (entry.target.kind === "SELECT_OPTION") {
      requireThat(
        entry.target.options.filter((o) => o.value === fact.value).length === 1,
        "AMBIGUOUS_OPTION",
      );
    } else if (entry.target.kind === "FILL_TEXT" && "maxLength" in entry.element) {
      requireThat(
        entry.element.maxLength < 0 || fact.value.length <= entry.element.maxLength,
        "VALUE_TOO_LONG",
      );
    }
    // Final synchronous check after the authority callback. No async gap and no
    // arbitrary selectors, script, navigation, or model-supplied values.
    this.fresh(ticket);
    this.consumed.add(key); // Consume before events, even if a handler throws.
    this.expected.set(key, {
      entry,
      fact: structuredClone(fact),
      ticket: structuredClone(ticket),
      step: this.step(),
      rows: this.doc.querySelectorAll("[data-experience-row]").length,
    });
    this.applying = entry.element;
    try {
      if (entry.target.kind === "NEXT") {
        requireThat(
          !this.doc.querySelector("[data-agent-challenge]:not([hidden])") &&
            Array.from(this.doc.querySelectorAll<HTMLInputElement>("input, select, textarea"))
              .filter((x) => x.getClientRects().length > 0)
              .every((x) => x.checkValidity()),
          "VALIDATION_REQUIRED",
        );
        entry.element.click();
      } else if (["OPEN_CONTROL", "ADD_ROW", "REMOVE_ROW"].includes(entry.target.kind)) {
        entry.element.click();
      } else if (entry.target.kind === "UPLOAD_FILE") {
        requireThat(
          entry.element instanceof HTMLInputElement &&
            fact.file &&
            fact.file.base64.length <= 300_000 &&
            /^[a-f0-9]{64}$/.test(fact.file.sha256),
          "APPROVED_FILE_REQUIRED",
        );
        const transfer = new DataTransfer();
        transfer.items.add(
          new File(
            [Uint8Array.from(atob(fact.file.base64), (c) => c.charCodeAt(0))],
            fact.file.name,
            { type: "text/plain" },
          ),
        );
        entry.element.files = transfer.files;
        entry.element.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (entry.element.getAttribute("role") === "combobox") {
        const list = this.doc.getElementById(entry.element.getAttribute("aria-controls") ?? "");
        const matches = Array.from(
          list?.querySelectorAll<HTMLElement>("[role='option']") ?? [],
        ).filter(
          (x) =>
            x.getAttribute("data-value") === fact.value &&
            x.getAttribute("aria-disabled") !== "true",
        );
        requireThat(matches.length === 1, "AMBIGUOUS_OPTION");
        matches[0]!.click();
      } else {
        const prototype =
          entry.element instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : entry.element instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
        requireThat(typeof descriptor?.set === "function", "SETTER_UNAVAILABLE");
        descriptor.set.call(entry.element, fact.value);
        entry.element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        entry.element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      }
    } finally {
      this.applying = null;
      this.snapshot = null; // Each next action needs a new observation.
    }
    return { intentId: ticket.intentId, dispatched: true };
  }

  /** Separate read-back. A successful event dispatch is not proof of retention. */
  verify(ticket: AgentTicket, fact: ApprovedLocalFact): boolean {
    if (
      this.disposed ||
      !isAgentLocalUrl(this.doc.location.href) ||
      !sameBinding(ticket.binding, this.binding()) ||
      !this.consumed.has(`${ticket.runId}:${ticket.intentId}`)
    )
      return false;
    const receipt = this.expected.get(`${ticket.runId}:${ticket.intentId}`);
    const entry = receipt?.entry;
    if (
      receipt &&
      entry &&
      JSON.stringify(receipt.ticket) === JSON.stringify(ticket) &&
      JSON.stringify(receipt.fact) === JSON.stringify(fact)
    ) {
      if (entry.target.kind === "NEXT")
        return (
          this.step() ===
            ({ contact: "experience", experience: "review" } as Record<string, string>)[
              receipt.step
            ] && !this.doc.querySelector("[data-agent-validation]:not([hidden])")
        );
      if (entry.target.kind === "ADD_ROW")
        return this.doc.querySelectorAll("[data-experience-row]").length === receipt.rows + 1;
      if (entry.target.kind === "REMOVE_ROW")
        return (
          !entry.element.isConnected &&
          this.doc.querySelectorAll("[data-experience-row]").length === receipt.rows - 1
        );
      if (entry.target.kind === "OPEN_CONTROL")
        return entry.element.isConnected && entry.element.getAttribute("aria-expanded") === "true";
      if (
        entry.target.kind === "SELECT_OPTION" &&
        entry.element.getAttribute("role") === "combobox"
      )
        return (
          entry.element.isConnected &&
          !this.edited.has(entry.element) &&
          entry.element.value === fact.value
        );
      if (entry.target.kind === "UPLOAD_FILE") return false; // Asynchronous byte read-back is required.
    }
    return (
      !!entry &&
      JSON.stringify(receipt.ticket) === JSON.stringify(ticket) &&
      JSON.stringify(receipt.fact) === JSON.stringify(fact) &&
      entry.element.isConnected &&
      entry.element.ownerDocument === this.doc &&
      JSON.stringify(this.describe(entry.element)) ===
        JSON.stringify({
          label: entry.target.label,
          kind: entry.target.kind,
          options: entry.target.options,
          ...(entry.target.semantic !== undefined ? { semantic: entry.target.semantic } : {}),
        }) &&
      entry.element.value === fact.value &&
      entry.element.validity.valid &&
      fact.profileRevision === ticket.binding.profileRevision
    );
  }

  private step() {
    return (
      this.doc.querySelector("[data-agent-step]:not([hidden])")?.getAttribute("data-agent-step") ??
      "unknown"
    );
  }

  async verifyUpload(ticket: AgentTicket, fact: ApprovedLocalFact): Promise<boolean> {
    const receipt = this.expected.get(`${ticket.runId}:${ticket.intentId}`);
    if (
      !receipt ||
      receipt.entry.target.kind !== "UPLOAD_FILE" ||
      JSON.stringify(receipt.ticket) !== JSON.stringify(ticket) ||
      JSON.stringify(receipt.fact) !== JSON.stringify(fact) ||
      !sameBinding(ticket.binding, this.context())
    )
      return false;
    const input = receipt.entry.element;
    if (
      !(input instanceof HTMLInputElement) ||
      !input.isConnected ||
      input.files?.length !== 1 ||
      input.files[0]?.name !== fact.file?.name
    )
      return false;
    const file = input.files[0];
    if (!file || !fact.file) return false;
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return (
      input.files?.[0] === file &&
      sameBinding(ticket.binding, this.context()) &&
      Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("") ===
        fact.file.sha256
    );
  }
}
