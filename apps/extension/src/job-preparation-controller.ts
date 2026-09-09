import {
  PreparationStoreSchema,
  PreparationViewSchema,
  PreparationForgottenSchema,
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
  constructor(
    private readonly discovery: Pick<DiscoveryController, "localForPreparation">,
    private readonly prepared: (record: PreparationRecord) => Promise<void>,
  ) {}
  private async ready() {
    this.recovery ??= this.repository.transact((store) => ({
      ...store,
      records: store.records.map((record) =>
        record.state === "PREPARING"
          ? {
              ...record,
              revision: record.revision + 1,
              state: "NEEDS_REVIEW",
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
        if (current.record.state === "PREPARED" && !current.record.trackerRecorded) {
          await this.prepared(current.record);
          await this.repository.transact((store) => ({
            ...store,
            records: store.records.map((entry) =>
              entry.id === id ? { ...entry, trackerRecorded: true } : entry,
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
      const record: PreparationRecord = {
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
      };
      return { ...store, records: [...store.records.filter((entry) => entry.id !== id), record] };
    });
    return this.view(id);
  }
  async cancel(id: string, revision: number) {
    const { profile } = await this.owned(id);
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
  ) {
    const { profile, record } = await this.owned(id);
    if (profile.blockers.length) throw new Error(profile.blockers.join(" "));
    const job = await this.discovery.localForPreparation(record.job.id, profile.owner);
    const current = await preparationProfile();
    if (
      current.digest !== profile.digest ||
      memoryOwnerKey(current.owner) !== memoryOwnerKey(profile.owner)
    )
      throw new Error("Profile changed. Review again.");
    await this.repository.transact((store) =>
      claimPreparation(
        store,
        id,
        revision,
        profile.owner,
        profile.digest,
        job,
        { ...profile.contact, ...answers },
        Date.now(),
      ),
    );
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
}
