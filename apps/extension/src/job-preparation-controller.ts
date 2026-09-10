import {
  PreparationStoreSchema,
  PreparationViewSchema,
  PreparationForgottenSchema,
  PreparationRecordSchema,
  type PreparationExtraAnswersSchema,
  type PreparationFileSchema,
  emptyPreparations,
  claimPreparation,
  preparationUrl,
  memoryOwnerKey,
  sameMemoryOwner,
  type PreparationRecord,
  type PreparationAnswers,
} from "@copilot/agent-core";
import type { CandidateFact } from "@copilot/candidate-schema";
import { getProfileVault } from "./profile-storage";
import { memoryOwner } from "./feedback-memory";
import { PrivateRepository } from "./private-repository";
import type { DiscoveryController } from "./discovery-controller";
import { prepareNativeDocument } from "./job-preparation-document";
import { PortalPreparationExecutor, validatePreparationFile } from "./portal-preparation-executor";
import type { z } from "zod";

function verified<T>(fact: CandidateFact<T> | undefined): T | null {
  return fact &&
    ["VERIFIED_USER", "VERIFIED_DOCUMENT"].includes(fact.status) &&
    (!fact.expiresAt || Date.parse(fact.expiresAt) > Date.now()) &&
    (!fact.refreshAfter || Date.parse(fact.refreshAfter) > Date.now())
    ? fact.value
    : null;
}
export async function preparationProfile() {
  const vault = await getProfileVault();
  const profile = vault.currentProfile;
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(profile)),
  );
  const digest = [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const contact = {
    name: verified(profile.identity.legalName)?.full ?? "",
    email: verified(profile.contact.emails[0])?.address ?? "",
    phone: verified(profile.contact.phones[0])?.e164 ?? "",
    currentLocation: verified(profile.contact.addresses[0])?.city ?? "",
  };
  const blockers = [
    !contact.name && "Verify your full name in Profile.",
    !contact.email && "Verify your email in Profile.",
    !contact.phone && "Verify your phone number in Profile.",
  ].filter((entry): entry is string => !!entry);
  return { owner: memoryOwner(vault), digest, contact, blockers };
}
export class JobPreparationController {
  private readonly repository = new PrivateRepository(
    "copilot-job-preparation-v1",
    PreparationStoreSchema,
    emptyPreparations,
  );
  private recovery: Promise<unknown> | undefined;
  private flush: Promise<unknown> = Promise.resolve();
  private readonly executor = new PortalPreparationExecutor(
    async (id) => (await this.owned(id)).record,
    async (id, change) => {
      await this.repository.transact((store) => ({
        ...store,
        records: store.records.map((record) => {
          if (record.id !== id) return record;
          const next = change(record);
          if (record.state === "CANCELLED" && next.state !== "CANCELLED")
            throw new Error("Preparation cancelled.");
          return { ...next, revision: record.revision + 1 };
        }),
      }));
    },
    async (id) => {
      const { profile, record } = await this.owned(id);
      if (
        profile.digest !== record.profileDigest ||
        profile.owner.profileRevision !== record.owner.profileRevision ||
        profile.blockers.length ||
        record.expiresAt <= Date.now()
      )
        throw new Error("Profile or approval changed. Review this application again.");
    },
  );
  constructor(
    private readonly discovery: Pick<DiscoveryController, "localForPreparation">,
    private readonly prepared: (record: PreparationRecord) => Promise<void>,
  ) {}
  private async ready() {
    this.recovery ??= this.repository.transact((store) => ({
      ...store,
      records: store.records.map((record) =>
        ["PREPARING", "SUBMITTING"].includes(record.state)
          ? {
              ...record,
              revision: record.revision + 1,
              state: record.state === "SUBMITTING" ? "OUTCOME_UNKNOWN" : "NEEDS_REVIEW",
              reason:
                "Browser worker interrupted preparation. Inspect the existing tab; no action was retried.",
            }
          : record,
      ),
    }));
    try {
      await this.recovery;
    } catch (error) {
      this.recovery = undefined;
      throw error;
    }
  }
  private async owned(id: string) {
    await this.ready();
    const profile = await preparationProfile();
    const record = (await this.repository.transact()).records.find(
      (entry) => entry.id === id && sameMemoryOwner(entry.owner, profile.owner),
    );
    if (!record) throw new Error("Preparation unavailable for this profile.");
    return { profile, record };
  }
  async view(id: string) {
    let { profile, record } = await this.owned(id);
    this.flush = this.flush
      .catch(() => undefined)
      .then(async () => {
        const current = await this.owned(id);
        if (
          (["PREPARED", "READY_TO_SUBMIT", "SUBMITTED"].includes(current.record.state) &&
            !current.record.trackerRecorded) ||
          (current.record.state === "SUBMITTED" && !current.record.confirmationRecorded)
        ) {
          await this.prepared(current.record);
          await this.repository.transact((store) => ({
            ...store,
            records: store.records.map((entry) =>
              entry.id === id
                ? {
                    ...entry,
                    trackerRecorded: true,
                    confirmationRecorded: current.record.state === "SUBMITTED",
                  }
                : entry,
            ),
          }));
        }
      });
    await this.flush;
    ({ profile, record } = await this.owned(id));
    return PreparationViewSchema.parse({
      kind: "JOB_PREPARATION",
      record,
      contact: profile.contact,
      blockers: [
        ...profile.blockers,
        ...(record.state === "REVIEW_REQUIRED" && record.expiresAt <= Date.now()
          ? ["This review expired. Review local preparation again."]
          : []),
        ...(profile.digest !== record.profileDigest ||
        record.owner.profileRevision !== profile.owner.profileRevision
          ? ["Your profile changed. Review this application again before preparing."]
          : []),
      ],
    });
  }
  async review(jobId: string) {
    await this.ready();
    const profile = await preparationProfile();
    const job = await this.discovery.localForPreparation(jobId, profile.owner);
    const current = await preparationProfile();
    if (
      current.digest !== profile.digest ||
      memoryOwnerKey(current.owner) !== memoryOwnerKey(profile.owner)
    )
      throw new Error("Profile changed during review. Try again.");
    let id: string = crypto.randomUUID();
    await this.repository.transact((store) => {
      const prior = store.records.find(
        (entry) =>
          sameMemoryOwner(entry.owner, profile.owner) &&
          entry.job.sourceJobId === job.sourceJobId &&
          entry.state !== "CANCELLED",
      );
      if (prior && prior.state !== "REVIEW_REQUIRED") {
        id = prior.id;
        return store;
      }
      if (prior) id = prior.id;
      const reviewedAt = Date.now();
      const record = PreparationRecordSchema.parse({
        id,
        revision: (prior?.revision ?? 0) + 1,
        owner: profile.owner,
        job,
        profileDigest: profile.digest,
        state: "REVIEW_REQUIRED",
        answers: null,
        submissionApproved: false,
        createdAt: reviewedAt,
        expiresAt: reviewedAt + 10 * 60_000,
        tabId: null,
        documentId: null,
        actions: [],
        reason:
          "Review these answers before preparing the local first screen. No résumé upload, Next or submission is authorized.",
        trackerRecorded: false,
      });
      return { ...store, records: [...store.records.filter((entry) => entry.id !== id), record] };
    });
    return this.view(id);
  }
  async cancel(id: string, revision: number) {
    const { profile, record: previous } = await this.owned(id);
    if (["SUBMITTING", "SUBMITTED", "OUTCOME_UNKNOWN"].includes(previous.state))
      throw new Error("Submission cannot be cancelled or retried. Check its receipt.");
    await this.repository.transact((store) => {
      const record = store.records.find(
        (entry) => entry.id === id && sameMemoryOwner(entry.owner, profile.owner),
      );
      if (!record || record.revision < revision)
        throw new Error("Preparation changed. Refresh it before cancelling.");
      return {
        ...store,
        records: store.records.map((entry) =>
          entry.id === id
            ? {
                ...entry,
                state: "CANCELLED",
                revision: entry.revision + 1,
                reason:
                  "Cancelled. An already dispatched action may finish. The existing tab and its values were not removed.",
              }
            : entry,
        ),
      };
    });
    if (previous.completeFlow) await this.executor.stop(previous, true);
    return this.view(id);
  }
  private async live(id: string) {
    const { profile, record } = await this.owned(id);
    if (record.state !== "PREPARING") throw new Error("Preparation stopped.");
    if (
      record.expiresAt <= Date.now() ||
      profile.digest !== record.profileDigest ||
      profile.owner.profileRevision !== record.owner.profileRevision ||
      profile.blockers.length
    )
      throw new Error("Profile or approval changed. Inspect the application manually.");
    return record;
  }
  async forget(id: string, revision: number) {
    const { profile } = await this.owned(id);
    await this.repository.transact((store) => {
      const record = store.records.find(
        (entry) => entry.id === id && sameMemoryOwner(entry.owner, profile.owner),
      );
      if (!record || record.revision !== revision || record.state !== "CANCELLED")
        throw new Error("Cancel and refresh this preparation before forgetting it.");
      return { ...store, records: store.records.filter((entry) => entry.id !== id) };
    });
    return PreparationForgottenSchema.parse({ kind: "JOB_PREPARATION_FORGOTTEN", id });
  }
  private async update(id: string, change: (record: PreparationRecord) => PreparationRecord) {
    await this.repository.transact((store) => ({
      ...store,
      records: store.records.map((record) => {
        if (record.id !== id) return record;
        if (record.state !== "PREPARING") throw new Error("Preparation stopped.");
        return { ...change(record), revision: record.revision + 1 };
      }),
    }));
  }
  async approve(
    id: string,
    revision: number,
    answers: Pick<PreparationAnswers, "currentLocation" | "workArrangement">,
    complete?: {
      extraAnswers: z.infer<typeof PreparationExtraAnswersSchema> | null;
      file: z.infer<typeof PreparationFileSchema> | null;
    },
  ) {
    const { profile, record } = await this.owned(id);
    if (profile.blockers.length) throw new Error(profile.blockers.join(" "));
    if (complete?.file) await validatePreparationFile(complete.file);
    const job = await this.discovery.localForPreparation(record.job.id, profile.owner);
    const current = await preparationProfile();
    if (
      current.digest !== profile.digest ||
      memoryOwnerKey(current.owner) !== memoryOwnerKey(profile.owner)
    )
      throw new Error("Profile changed. Review again.");
    await this.repository.transact((store) => {
      const claimed = claimPreparation(
        store,
        id,
        revision,
        profile.owner,
        profile.digest,
        job,
        { ...profile.contact, ...answers },
        Date.now(),
      );
      return {
        ...claimed,
        records: claimed.records.map((entry) =>
          entry.id === id && complete
            ? {
                ...entry,
                completeFlow: true,
                startedAt: Date.now(),
                extraAnswers: complete.extraAnswers,
                file: complete.file,
                reason: "Preparing the reviewed local application.",
              }
            : entry,
        ),
      };
    });
    if (complete) {
      await this.executor.launch(id);
      return this.view(id);
    }
    try {
      await this.live(id);
      const tab = await chrome.tabs.create({ url: preparationUrl(job), active: true });
      if (tab.id === undefined) throw new Error("Could not identify the new application tab.");
      const tabId = tab.id;
      await this.update(id, (entry) => ({ ...entry, tabId }));
      for (let count = 0; count < 50; count++) {
        await this.live(id);
        const opened = await chrome.tabs.get(tabId);
        if (
          !opened.active ||
          (opened.url && opened.url !== preparationUrl(job) && opened.url !== "about:blank")
        )
          throw new Error("Application tab changed. Inspect it manually.");
        if (opened.status === "complete" && opened.url === preparationUrl(job)) break;
        if (count === 49) throw new Error("Application did not finish loading.");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      for (const action of ["OPEN_FORM", "FILL_FIELDS"] as const) {
        const active = await this.live(id);
        const opened = await chrome.tabs.get(tabId);
        if (!opened.active || opened.url !== preparationUrl(job))
          throw new Error("Application tab changed. Inspect it manually.");
        await this.update(id, (entry) => {
          if (entry.actions.includes(action))
            throw new Error("Action was already dispatched; inspect the page.");
          return { ...entry, actions: [...entry.actions, action] };
        });
        await this.live(id);
        const target = active.documentId
          ? { tabId, documentIds: [active.documentId] }
          : { tabId, frameIds: [0] };
        const [result] = await chrome.scripting.executeScript({
          target,
          world: "ISOLATED",
          func: prepareNativeDocument,
          args: [
            { url: preparationUrl(job), jobId: job.sourceJobId, action, answers: active.answers! },
          ],
        });
        if (
          !result?.documentId ||
          result.frameId !== 0 ||
          (action === "FILL_FIELDS" && result.result?.prepared !== true)
        )
          throw new Error("Could not verify local preparation.");
        await this.update(id, (entry) => ({ ...entry, documentId: result.documentId }));
      }
      await this.live(id);
      await this.update(id, (entry) => ({
        ...entry,
        state: "PREPARED",
        reason:
          "First screen prepared and checked. Review the page; Next, résumé upload and submission remain manual.",
      }));
    } catch (error) {
      await this.repository.transact((store) => ({
        ...store,
        records: store.records.map((entry) =>
          entry.id === id && entry.state === "PREPARING"
            ? {
                ...entry,
                revision: entry.revision + 1,
                state: "NEEDS_REVIEW",
                reason:
                  error instanceof Error
                    ? error.message.slice(0, 500)
                    : "Preparation needs manual review. No action was retried.",
              }
            : entry,
        ),
      }));
    }
    return this.view(id);
  }
  private async claimState(
    id: string,
    revision: number,
    allowed: PreparationRecord["state"][],
    state: PreparationRecord["state"],
  ) {
    const { profile, record } = await this.owned(id);
    if (
      !record.completeFlow ||
      profile.digest !== record.profileDigest ||
      profile.owner.profileRevision !== record.owner.profileRevision ||
      profile.blockers.length
    )
      throw new Error("Profile changed. Cancel and review a new preparation.");
    await this.discovery.localForPreparation(record.job.id, profile.owner);
    const now = Date.now();
    await this.repository.transact((store) => ({
      ...store,
      records: store.records.map((entry) => {
        if (entry.id !== id) return entry;
        if (entry.revision !== revision || !allowed.includes(entry.state))
          throw new Error("Preparation changed. Refresh it.");
        if (state === "SUBMITTING" && entry.expiresAt <= now)
          throw new Error("Final review expired. Resume preparation to review again.");
        return {
          ...entry,
          state,
          revision: entry.revision + 1,
          createdAt: now,
          expiresAt: now + 600000,
        };
      }),
    }));
    return (await this.owned(id)).record;
  }
  async resume(
    id: string,
    revision: number,
    answers: { key: string; value: string; meaning: string | null; remember: boolean }[],
  ) {
    const prior = (await this.owned(id)).record;
    if (prior.questions.some((q) => q.kind === "file"))
      throw new Error("Cancel and restart with a reviewed résumé file.");
    // An interrupted command may still finish. Its short dispatch ticket must expire first.
    if (prior.runId) {
      const run = (await this.executor.repository.read()).runs.find((r) => r.id === prior.runId);
      if (
        run?.intents.some(
          (i) =>
            ["CLAIMED", "RECEIVED"].includes(i.status) && i.proposal.expiresAt + 6000 > Date.now(),
        )
      )
        throw new Error("Wait for the dispatched action to finish, then refresh and resume.");
    }
    const record = await this.claimState(
      id,
      revision,
      ["QUESTIONS", "NEEDS_REVIEW", "READY_TO_SUBMIT"],
      "PREPARING",
    );
    try {
      await this.executor.recover();
      if (record.runId)
        await this.executor.repository.dispatch({
          type: "RENEW_PREPARATION",
          runId: record.runId,
          expiresAt: record.expiresAt,
        });
      if (record.questions.length) await this.executor.saveAnswers(record, answers);
      else if (answers.length) throw new Error("No outstanding questions to answer.");
      else
        await this.repository.transact((store) => ({
          ...store,
          records: store.records.map((r) =>
            r.id === id ? { ...r, manualInterventions: r.manualInterventions + 1 } : r,
          ),
        }));
      await this.executor.launch(id);
    } catch (error) {
      await this.repository.transact((store) => ({
        ...store,
        records: store.records.map((r) =>
          r.id === id && r.state === "PREPARING"
            ? {
                ...r,
                state: "NEEDS_REVIEW",
                revision: r.revision + 1,
                reason: error instanceof Error ? error.message.slice(0, 500) : "Review required.",
              }
            : r,
        ),
      }));
    }
    return this.view(id);
  }
  async submit(id: string, revision: number) {
    const record = await this.claimState(id, revision, ["READY_TO_SUBMIT"], "SUBMITTING");
    try {
      await this.executor.submit(record);
      for (let n = 0; n < 5; n++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        try {
          await this.executor.reconcile((await this.owned(id)).record);
          return this.view(id);
        } catch {
          /* Read-only reconciliation; never repeat Submit. */
        }
      }
      throw new Error("Receipt not available yet. Check receipt; submission will not be retried.");
    } catch (error) {
      await this.repository.transact((store) => ({
        ...store,
        records: store.records.map((r) =>
          r.id === id && r.state === "SUBMITTING"
            ? {
                ...r,
                state: r.submitRunId ? "OUTCOME_UNKNOWN" : "NEEDS_REVIEW",
                revision: r.revision + 1,
                reason:
                  error instanceof Error
                    ? error.message.slice(0, 500)
                    : "Check the application receipt.",
              }
            : r,
        ),
      }));
    }
    return this.view(id);
  }
  async reconcile(id: string) {
    const { record } = await this.owned(id);
    if (!["SUBMITTED", "OUTCOME_UNKNOWN"].includes(record.state))
      throw new Error("No unresolved submission to check.");
    await this.executor.reconcile(record);
    return this.view(id);
  }
  async activateWorkflow(id: string) {
    const { record } = await this.owned(id);
    await this.executor.activateWorkflow(record);
    return this.view(id);
  }
  async clearPrivate(id: string, revision: number) {
    await this.owned(id);
    await this.repository.transact((store) => ({
      ...store,
      records: store.records.map((r) => {
        if (r.id !== id) return r;
        if (r.revision !== revision || !["SUBMITTED", "OUTCOME_UNKNOWN"].includes(r.state))
          throw new Error("Refresh the finished application before clearing its private data.");
        return {
          ...r,
          revision: r.revision + 1,
          answers: null,
          extraAnswers: null,
          file: null,
          questions: [],
          reviewedQuestions: [],
          reviewHash: null,
        };
      }),
    }));
    return this.view(id);
  }
  async pause(id: string, revision: number) {
    const { record } = await this.owned(id);
    await this.repository.transact((store) => ({
      ...store,
      records: store.records.map((r) => {
        if (r.id !== id) return r;
        if (!r.completeFlow || r.revision < revision || r.state !== "PREPARING")
          throw new Error("Preparation is no longer running. Refresh its status.");
        return {
          ...r,
          state: "NEEDS_REVIEW",
          revision: r.revision + 1,
          reason:
            "Paused for you to take over. An already dispatched action may finish. Review the page before resuming.",
        };
      }),
    }));
    await this.executor.stop(record, false);
    return this.view(id);
  }
}
