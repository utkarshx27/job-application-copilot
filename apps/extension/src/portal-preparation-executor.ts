import {
  captureWorkflow,
  changeWorkflow,
  retrieveWorkflow,
  preparationWorkflowUrl,
  retrieveCorrection,
  saveCorrection,
  ticketForRun,
  preparationUrl,
  memoryOwnerKey,
  PreparationFileSchema,
  type PreparationRecord,
  type AgentOperation,
  type AgentProposal,
  type AgentObservation,
  type MemoryScope,
  type MemoryMeaningSchema,
} from "@copilot/agent-core";
import type { z } from "zod";
import { AgentRepository } from "./agent-storage";
import { MemoryRepository } from "./feedback-memory";
import {
  portalPreparationDocument,
  type PortalSnapshot,
  type PortalDocumentCommand,
} from "./portal-preparation-document";

type Read = (id: string) => Promise<PreparationRecord>;
type Update = (
  id: string,
  change: (record: PreparationRecord) => PreparationRecord,
) => Promise<void>;
const labels: Record<string, string> = {
  "Full name": "name",
  Email: "email",
  "Phone number": "phone",
  "Current city": "currentLocation",
  "Work arrangement": "workArrangement",
  "Total experience in months": "experienceMonths",
  "Notice period in days": "noticeDays",
  "Current compensation": "currentSalary",
  "Expected compensation": "expectedSalary",
  "Compensation currency": "currency",
  "Compensation period": "salaryPeriod",
  "Resume document": "resume",
};
export const preparationMeanings: Record<string, string> = {
  "ADDRESS.city": "currentLocation",
  "COMP.current_compensation": "currentSalary",
  "COMP.desired_base": "expectedSalary",
  "AVAIL.notice_period": "noticeDays",
};
export function portalQuestionScope(field: PortalSnapshot["fields"][number]): MemoryScope {
  return {
    origin: "http://127.0.0.1:4173",
    adapter: "LOCAL_PREPARATION",
    adapterVersion: "1",
    locale: "en",
    control: field.kind,
    question: field.label,
    group: "Local application",
  };
}
export async function validatePreparationFile(input: z.infer<typeof PreparationFileSchema>) {
  const file = PreparationFileSchema.parse(input);
  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (!bytes.length || bytes.length > 500000 || sha !== file.sha256)
    throw new Error("Selected résumé content or size is invalid.");
  return file;
}
export class PortalPreparationExecutor {
  private readonly owner = crypto.randomUUID();
  readonly repository = new AgentRepository(indexedDB, "copilot-preparation-executor-v1");
  readonly memory = new MemoryRepository();
  private readonly tasks = new Map<string, Promise<void>>();
  constructor(
    private readonly read: Read,
    private readonly update: Update,
    private readonly validate: (id: string) => Promise<void>,
  ) {}
  async recover() {
    await this.repository.dispatch({ type: "RECOVER", owner: this.owner });
  }
  async stop(record: PreparationRecord, cancel: boolean) {
    const id = record.state === "SUBMITTING" ? record.submitRunId : record.runId;
    if (!id) return;
    const run = (await this.repository.read()).runs.find((r) => r.id === id);
    if (run && !["CANCELLED", "CONFIRMED", "OUTCOME_UNKNOWN", "FAILED"].includes(run.state))
      await this.repository.dispatch(
        cancel
          ? { type: "CANCEL", runId: id }
          : { type: "PAUSE", runId: id, reason: "USER_PAUSED" },
      );
  }
  async observe(record: PreparationRecord, command?: Partial<PortalDocumentCommand>) {
    await this.validate(record.id);
    const current = await this.read(record.id);
    if (
      current.tabId === null ||
      (command && current.state !== "PREPARING" && current.state !== "SUBMITTING")
    )
      throw new Error("Preparation stopped.");
    const tab = await chrome.tabs.get(current.tabId);
    if (!tab.active || tab.url !== preparationUrl(current.job))
      throw new Error("Return to the unchanged application tab.");
    const [result] = await chrome.scripting.executeScript({
      target: current.documentId
        ? { tabId: current.tabId, documentIds: [current.documentId] }
        : { tabId: current.tabId, frameIds: [0] },
      world: "ISOLATED",
      func: portalPreparationDocument,
      args: [
        {
          url: preparationUrl(current.job),
          jobId: current.job.sourceJobId,
          applicationId: current.applicationId,
          action: "OBSERVE",
          ...command,
        },
      ],
    });
    if (!result?.documentId || result.frameId !== 0 || !result.result)
      throw new Error("Application observation unavailable.");
    if (!current.documentId)
      await this.update(record.id, (r) => ({ ...r, documentId: result.documentId }));
    return result.result;
  }
  private async create(record: PreparationRecord, submit = false) {
    if (submit) {
      const run = (await this.repository.read()).runs.find((r) => r.id === record.runId);
      if (!run) throw new Error("Prepared run unavailable.");
      await this.repository.dispatch({
        type: "AUTHORIZE_SUBMIT",
        runId: run.id,
        consent: {
          ...run.consent,
          id: crypto.randomUUID(),
          capabilities: ["SUBMIT"],
          submissionApproved: true,
          expiresAt: record.expiresAt,
        },
      });
      await this.update(record.id, (r) => ({ ...r, submitRunId: run.id }));
      return run.id;
    }
    await this.repository.dispatch({ type: "SET_ENABLED", enabled: true });
    const id = crypto.randomUUID();
    await this.repository.dispatch({
      type: "CREATE",
      id,
      applicationId: submit ? record.applicationId! : `preparation:${record.id}`,
      binding: {
        tabId: record.tabId!,
        documentId: record.documentId!,
        url: preparationUrl(record.job),
        profileRevision: record.owner.profileRevision,
        profileKey: memoryOwnerKey(record.owner),
      },
      consent: {
        id: crypto.randomUUID(),
        applicationId: submit ? record.applicationId! : `preparation:${record.id}`,
        profileRevision: record.owner.profileRevision,
        url: preparationUrl(record.job),
        capabilities: submit
          ? ["SUBMIT"]
          : ["OPEN_CONTROL", "FILL_TEXT", "SELECT_OPTION", "UPLOAD_FILE", "NEXT"],
        expiresAt: record.expiresAt,
        submissionApproved: submit,
      },
      budget: {
        actions: 0,
        spentCostMicros: 0,
        maxActions: submit ? 1 : 60,
        maxCostMicros: 0,
        expiresAt: record.expiresAt,
      },
    });
    await this.update(record.id, (r) => ({
      ...r,
      ...(submit ? { submitRunId: id } : { runId: id }),
    }));
    return id;
  }
  private async act(
    record: PreparationRecord,
    snapshot: PortalSnapshot,
    action: PortalDocumentCommand["action"],
    target: string,
    semantic = "control",
    value?: string,
    memoryRef?: AgentProposal["memoryRef"],
  ) {
    const runId = action === "SUBMIT" ? record.submitRunId! : record.runId!;
    const dispatch = async (op: AgentOperation) =>
      (await this.repository.dispatch(op)).runs.find((r) => r.id === runId)!;
    let run = await dispatch({ type: "ACQUIRE", runId, owner: this.owner });
    const fence = run.lease!.fence;
    const observation: AgentObservation = {
      id: crypto.randomUUID(),
      binding: run.binding,
      capturedAt: Date.now(),
      fingerprint: snapshot.hash,
      fieldCount: snapshot.fields.length,
      targetRefs: [target],
    };
    await dispatch({ type: "OBSERVE", runId, owner: this.owner, fence, observation });
    const kind = action as AgentProposal["kind"];
    const proposal: AgentProposal = {
      id: crypto.randomUUID(),
      runId,
      observationId: observation.id,
      kind,
      targetRef: target,
      factRefs: ["FILL_TEXT", "SELECT_OPTION", "UPLOAD_FILE"].includes(kind)
        ? [`approved.${semantic}`]
        : [],
      expected:
        kind === "NEXT"
          ? "STEP_CHANGED"
          : kind === "SUBMIT"
            ? "CONFIRMATION_MATCHED"
            : kind === "UPLOAD_FILE"
              ? "FILE_RETAINED"
              : kind === "OPEN_CONTROL"
                ? "CONTROL_OPENED"
                : "VALUE_MATCHED",
      expiresAt: Date.now() + 5000,
      costMicros: 0,
      ...(memoryRef ? { memoryRef } : {}),
    };
    run = await dispatch({
      type: "CLAIM",
      runId,
      owner: this.owner,
      fence,
      proposal,
      current: observation,
      verifiedFactRefs: proposal.factRefs,
    });
    await this.update(record.id, (r) => ({ ...r, actionCount: r.actionCount + 1 }));
    const ticket = ticketForRun(run);
    await dispatch({ type: "RECEIVE", ticket, current: observation });
    const after = await this.observe(record, {
      action,
      target,
      ...(value === undefined ? {} : { value }),
      hash: snapshot.hash,
      intentId: proposal.id,
      expiresAt: proposal.expiresAt,
      ...(kind === "UPLOAD_FILE" ? { file: record.file! } : {}),
    });
    if (kind === "SUBMIT") return; // Only an independently read receipt can complete this intent.
    const matched =
      kind === "OPEN_CONTROL"
        ? after.step === "contact" && !!after.applicationId
        : kind === "NEXT"
          ? after.step === (snapshot.step === "contact" ? "screening" : "review")
          : after.fields.find((f) => f.key === target)?.value ===
            (kind === "UPLOAD_FILE" ? record.file!.sha256 : value);
    await dispatch({ type: "VERIFY", ticket, matched, applicationId: run.applicationId });
    if (!matched) throw new Error("Could not verify the action.");
    await dispatch({ type: "YIELD", runId, owner: this.owner, fence, prepared: false });
  }
  async launch(id: string) {
    if (this.tasks.has(id)) throw new Error("Preparation is still running.");
    const task = this.loop(id)
      .catch(async (error: unknown) => {
        const record = await this.read(id);
        if (record.state !== "PREPARING") return;
        await this.stop(record, false);
        await this.update(id, (r) => ({
          ...r,
          state: "NEEDS_REVIEW",
          reason:
            error instanceof Error
              ? error.message.slice(0, 500)
              : "Inspect the application before resuming.",
        }));
      })
      .finally(() => this.tasks.delete(id));
    this.tasks.set(id, task);
    await task;
  }
  private async loop(id: string) {
    for (let count = 0; count < 65; count++) {
      let record = await this.read(id);
      if (record.state !== "PREPARING") return;
      if (record.expiresAt <= Date.now())
        throw new Error("Preparation approval expired. Review again.");
      if (record.tabId === null) {
        const tab = await chrome.tabs.create({ url: preparationUrl(record.job), active: true });
        if (tab.id === undefined) throw new Error("Application tab unavailable.");
        await this.update(id, (r) => ({ ...r, tabId: tab.id! }));
        for (let n = 0; n < 50; n++) {
          if ((await chrome.tabs.get(tab.id)).status === "complete") break;
          await new Promise((r) => setTimeout(r, 100));
        }
        record = await this.read(id);
      }
      const snapshot = await this.observe(record);
      if (snapshot.applicationId && !record.applicationId)
        await this.update(id, (r) => ({ ...r, applicationId: snapshot.applicationId }));
      record = await this.read(id);
      if (!record.runId) {
        await this.create(record);
        record = await this.read(id);
      }
      if (snapshot.step === "start") {
        await this.act(record, snapshot, "OPEN_CONTROL", "start");
        continue;
      }
      if (snapshot.step === "review") {
        this.checkReview(record, snapshot);
        const acquired = (
          await this.repository.dispatch({
            type: "ACQUIRE",
            runId: record.runId!,
            owner: this.owner,
          })
        ).runs.find((r) => r.id === record.runId)!;
        const store = await this.repository.dispatch({
          type: "YIELD",
          runId: acquired.id,
          owner: this.owner,
          fence: acquired.lease!.fence,
          prepared: true,
        });
        // A fresh workflow remains a candidate until a separate run matches it.
        const run = store.runs.find((r) => r.id === record.runId)!;
        let workflowId: string | null = null;
        if (run.intents.every((i) => i.status === "VERIFIED"))
          await this.memory.transact((memory) => {
            const candidate = memory.workflows.find(
              (w) =>
                w.state === "CANDIDATE" &&
                w.owner.ownerId === record.owner.ownerId &&
                w.owner.profileId === record.owner.profileId &&
                w.owner.profileRevision === record.owner.profileRevision &&
                w.url === preparationWorkflowUrl(record.job.applicationUrl!) &&
                !w.evidenceRunIds.includes(run.id),
            );
            if (candidate) {
              workflowId = candidate.id;
              return changeWorkflow(
                memory,
                record.owner,
                candidate.id,
                candidate.revision,
                "VALIDATE",
                Date.now(),
                run,
              );
            }
            const next = captureWorkflow(memory, record.owner, run, Date.now());
            workflowId = next.workflows.at(-1)!.id;
            return next;
          });
        await this.update(id, (r) => ({
          ...r,
          state: "READY_TO_SUBMIT",
          reviewHash: snapshot.hash,
          workflowId,
          completedAt: Date.now(),
          reason:
            "Application prepared through review. Check all answers and the retained résumé, then approve submission separately.",
        }));
        return;
      }
      const memory = await this.memory.transact();
      const workflow = retrieveWorkflow(
        memory,
        record.owner,
        Date.now(),
        preparationWorkflowUrl(record.job.applicationUrl!),
      );
      const all: Record<string, string> = { ...record.answers!, ...record.extraAnswers };
      const unresolved: PortalSnapshot["fields"] = [];
      const pending: {
        field: PortalSnapshot["fields"][number];
        semantic: string;
        value: string;
        correction?: { id: string; revision: number };
      }[] = [];
      for (const field of snapshot.fields) {
        const reviewed = record.reviewedQuestions.find(
          (q) => q.key === field.key && q.label === field.label,
        );
        const correction = retrieveCorrection(
          memory,
          record.owner,
          portalQuestionScope(field),
          Date.now(),
        );
        const semantic =
          correction.status === "MATCH"
            ? preparationMeanings[correction.records[0]!.accepted]
            : correction.status === "CONFLICT"
              ? undefined
              : labels[field.label];
        if (
          reviewed?.memoryRef &&
          (correction.status !== "MATCH" ||
            correction.records[0]?.id !== reviewed.memoryRef.id ||
            correction.records[0]?.revision !== reviewed.memoryRef.revision)
        ) {
          unresolved.push(field);
          continue;
        }
        const value =
          reviewed?.value ??
          (semantic === "resume" ? record.file?.sha256 : semantic ? all[semantic] : undefined);
        if (
          value === undefined ||
          (field.value && field.value !== value) ||
          (field.kind === "select" && !field.options.includes(value))
        ) {
          unresolved.push(field);
          continue;
        }
        if (
          !record.reviewedQuestions.some(
            (q) => q.key === field.key && q.label === field.label && q.value === value,
          )
        )
          await this.update(id, (r) => ({
            ...r,
            reviewedQuestions: [
              ...r.reviewedQuestions.filter((q) => q.key !== field.key),
              {
                key: field.key,
                label: field.label,
                value,
                meaning: semantic ?? null,
                ...(correction.status === "MATCH"
                  ? {
                      memoryRef: {
                        id: correction.records[0]!.id,
                        revision: correction.records[0]!.revision,
                      },
                    }
                  : {}),
              },
            ],
          }));
        if (!field.value)
          pending.push({
            field,
            semantic: semantic ?? "manual",
            value,
            ...(correction.status === "MATCH"
              ? {
                  correction: {
                    id: correction.records[0]!.id,
                    revision: correction.records[0]!.revision,
                  },
                }
              : {}),
          });
      }
      if (unresolved.length) {
        await this.stop(record, false);
        await this.update(id, (r) => ({
          ...r,
          state: "QUESTIONS",
          questions: unresolved,
          reason:
            "Review these missing or conflicting answers together. Existing page values must be corrected on the page before resuming.",
        }));
        return;
      }
      const chosen =
        workflow?.steps.flatMap((step) =>
          pending.filter((p) => p.semantic === step.parameter),
        )[0] ?? pending[0];
      if (chosen) {
        if (chosen.correction) {
          const fresh = retrieveCorrection(
            await this.memory.transact(),
            record.owner,
            portalQuestionScope(chosen.field),
            Date.now(),
          );
          if (
            fresh.status !== "MATCH" ||
            fresh.records[0]?.id !== chosen.correction.id ||
            fresh.records[0]?.revision !== chosen.correction.revision
          )
            throw new Error("Correction memory changed. Review again.");
        }
        if (workflow) {
          const fresh = retrieveWorkflow(
            await this.memory.transact(),
            record.owner,
            Date.now(),
            workflow.url,
          );
          if (fresh?.id !== workflow.id || fresh.revision !== workflow.revision)
            throw new Error("Workflow memory changed.");
        }
        await this.act(
          await this.read(id),
          snapshot,
          chosen.field.kind === "file"
            ? "UPLOAD_FILE"
            : chosen.field.kind === "select"
              ? "SELECT_OPTION"
              : "FILL_TEXT",
          chosen.field.key,
          chosen.semantic,
          chosen.value,
          chosen.correction ??
            (workflow ? { id: workflow.id, revision: workflow.revision } : undefined),
        );
        if (chosen.correction || workflow)
          await this.update(id, (r) => ({ ...r, memoryUses: r.memoryUses + 1 }));
      } else await this.act(await this.read(id), snapshot, "NEXT", snapshot.step);
    }
    throw new Error("Action limit reached. Inspect the application.");
  }
  checkReview(record: PreparationRecord, snapshot: PortalSnapshot) {
    const expected = record.reviewedQuestions
      .filter((q) => q.meaning !== "resume")
      .map((q) => [q.label, q.value]);
    if (
      snapshot.step !== "review" ||
      JSON.stringify([...snapshot.review].sort()) !== JSON.stringify(expected.sort()) ||
      (record.reviewedQuestions.some((q) => q.meaning === "resume") &&
        (!snapshot.uploadRetained || snapshot.uploadSha256 !== record.file?.sha256))
    )
      throw new Error(
        "The final review differs from approved answers or the résumé was not retained.",
      );
  }
  async saveAnswers(
    record: PreparationRecord,
    answers: { key: string; value: string; meaning: string | null; remember: boolean }[],
  ) {
    if (
      answers.length !== record.questions.length ||
      new Set(answers.map((a) => a.key)).size !== answers.length
    )
      throw new Error("Review every missing question once.");
    const reviewed: PreparationRecord["reviewedQuestions"] = [];
    for (const field of record.questions) {
      const answer = answers.find((a) => a.key === field.key);
      if (
        !answer ||
        !answer.value.trim() ||
        field.kind === "file" ||
        (field.kind === "select" && !field.options.includes(answer.value))
      )
        throw new Error("Answer every question and select a valid option.");
      if (answer.meaning && !preparationMeanings[answer.meaning])
        throw new Error("Unsupported saved meaning.");
      const semantic = answer.meaning ? preparationMeanings[answer.meaning] : null;
      const values: Record<string, string> = { ...record.answers!, ...record.extraAnswers };
      if (
        labels[field.label] &&
        labels[field.label] !== "resume" &&
        values[labels[field.label]!] !== undefined &&
        values[labels[field.label]!] !== answer.value
      )
        throw new Error(
          "This answer conflicts with the approved profile or application answers. Correct the page or review a new preparation.",
        );
      if (semantic && values[semantic] !== answer.value)
        throw new Error("The selected meaning must match the reviewed application answer.");
      if (answer.remember) {
        if (!answer.meaning) throw new Error("Choose a field meaning before saving a correction.");
        const now = Date.now();
        await this.memory.transact((store) =>
          saveCorrection(
            store,
            {
              id: crypto.randomUUID(),
              revision: 1,
              kind: "FIELD_MEANING",
              owner: record.owner,
              scope: portalQuestionScope(field),
              rejected: null,
              accepted: answer.meaning as z.infer<typeof MemoryMeaningSchema>,
              observationHash: record.profileDigest,
              confirmed: true,
              createdAt: now,
              updatedAt: now,
              expiresAt: now + 30 * 86400000,
            },
            0,
          ),
        );
      }
      reviewed.push({
        key: field.key,
        label: field.label,
        value: answer.value,
        meaning: semantic ?? null,
      });
    }
    await this.update(record.id, (r) => ({
      ...r,
      reviewedQuestions: [
        ...r.reviewedQuestions.filter((q) => !reviewed.some((a) => a.key === q.key)),
        ...reviewed,
      ],
      questions: [],
      manualInterventions: r.manualInterventions + 1,
    }));
  }
  async activateWorkflow(record: PreparationRecord) {
    if (!record.workflowId) throw new Error("No workflow captured.");
    await this.memory.transact((store) => {
      const workflow = store.workflows.find((w) => w.id === record.workflowId);
      if (!workflow) throw new Error("Workflow forgotten.");
      return changeWorkflow(
        store,
        record.owner,
        workflow.id,
        workflow.revision,
        "ACTIVATE",
        Date.now(),
      );
    });
  }
  async submit(record: PreparationRecord) {
    const snapshot = await this.observe(record);
    this.checkReview(record, snapshot);
    if (snapshot.hash !== record.reviewHash)
      throw new Error("Final review changed. Prepare and review again.");
    await this.create(record, true);
    record = await this.read(record.id);
    await this.act(record, snapshot, "SUBMIT", "submit");
  }
  async reconcile(record: PreparationRecord) {
    if (!record.applicationId || !record.submitRunId)
      throw new Error("No submission was authorized.");
    const run = (await this.repository.read()).runs.find((r) => r.id === record.submitRunId)!;
    const intent = run.intents.find((i) => i.proposal.kind === "SUBMIT");
    if (!intent) throw new Error("No submission was dispatched. Inspect the page.");
    const endpoint = `http://127.0.0.1:4173/api/portal/applications/${record.applicationId}/receipt`;
    const response = await fetch(endpoint, {
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Receipt unavailable. Submission will not be retried.");
    const text = await response.text();
    if (text.length > 2000) throw new Error("Invalid receipt size.");
    const receipt: unknown = JSON.parse(text);
    if (
      !receipt ||
      typeof receipt !== "object" ||
      !("applicationId" in receipt) ||
      !("jobId" in receipt) ||
      !("status" in receipt) ||
      receipt.applicationId !== record.applicationId ||
      receipt.jobId !== record.job.sourceJobId ||
      receipt.status !== "ACCEPTED"
    )
      throw new Error("Receipt identity does not match this application.");
    if (run.state !== "CONFIRMED") {
      if (run.state !== "OUTCOME_UNKNOWN")
        await this.repository.dispatch({
          type: "PAUSE",
          runId: run.id,
          reason: "UNCERTAIN_DISPATCH",
        });
      await this.repository.dispatch({
        type: "RECONCILE",
        runId: run.id,
        intentId: intent.proposal.id,
        applicationId: run.applicationId,
        evidenceMatched: true,
      });
    }
    await this.update(record.id, (r) => ({
      ...r,
      state: "SUBMITTED",
      receipt: {
        applicationId: record.applicationId!,
        jobId: record.job.sourceJobId,
        status: "ACCEPTED",
      },
      completedAt: Date.now(),
      reason: "The local server confirmed this application was accepted.",
    }));
  }
}
