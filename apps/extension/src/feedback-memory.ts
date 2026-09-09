import {
  emptyMemory,
  forgetCorrection,
  MemoryStoreSchema,
  MemoryViewSchema,
  retrieveCorrection,
  sameMemoryOwner,
  saveCorrection,
  type MemoryOwner,
  type MemoryScope,
  type MemoryStore,
  type MemoryCorrection,
} from "@copilot/agent-core";
import {
  CanonicalQuestionSchema,
  FieldMappingSchema,
  type FieldMapping,
  type RawField,
} from "@copilot/form-schema";
import type { ApplicationPageAnalysis } from "@copilot/job-schema";
import type { ProfileVault } from "@copilot/profile-core";
import type { CandidateProfile } from "@copilot/candidate-schema";

export class MemoryRepository {
  constructor(
    private readonly factory: IDBFactory = indexedDB,
    private readonly name = "copilot-feedback-v1",
  ) {}
  async transact(change?: (store: MemoryStore) => MemoryStore): Promise<MemoryStore> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(this.name, 1);
      let abandoned = false;
      request.onupgradeneeded = () => request.result.createObjectStore("memory");
      request.onerror = () => reject(new Error("Memory storage unavailable."));
      request.onblocked = () => {
        abandoned = true;
        reject(new Error("Close older views before opening memory."));
      };
      request.onsuccess = () => {
        if (abandoned) request.result.close();
        else resolve(request.result);
      };
    });
    return new Promise((resolve, reject) => {
      const tx = db.transaction("memory", change ? "readwrite" : "readonly");
      const table = tx.objectStore("memory");
      const get = table.get("state");
      let result: MemoryStore;
      let error: unknown;
      get.onsuccess = () => {
        try {
          const stored: unknown = get.result;
          result = stored === undefined ? emptyMemory() : MemoryStoreSchema.parse(stored);
          if (change) {
            result = MemoryStoreSchema.parse(change(result));
            table.put(result, "state");
          }
        } catch (cause) {
          error = cause;
          tx.abort();
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onabort = () => {
        db.close();
        reject(error instanceof Error ? error : new Error("Memory transaction failed."));
      };
      tx.onerror = () => {
        error ??= new Error("Memory storage failed.");
      };
    });
  }
  async view(owner: MemoryOwner) {
    const store = await this.transact();
    return MemoryViewSchema.parse({
      kind: "MEMORY_VIEW",
      owner,
      revision: store.revision,
      corrections: store.corrections.filter((entry) => sameMemoryOwner(entry.owner, owner)),
      workflows: store.workflows.filter((entry) => sameMemoryOwner(entry.owner, owner)),
    });
  }
  async save(record: MemoryCorrection, revision: number) {
    return this.transact((store) => saveCorrection(store, record, revision));
  }
  async forget(owner: MemoryOwner, id: string, revision: number) {
    return this.transact((store) => forgetCorrection(store, owner, id, revision));
  }
}
export function memoryOwner(vault: ProfileVault): MemoryOwner {
  return {
    ownerId: vault.id,
    profileId: vault.currentProfile.id,
    profileRevision: vault.currentProfile.profileVersion,
  };
}
export function memoryScope(
  analysis: Pick<ApplicationPageAnalysis, "snapshot" | "ats">,
  field: RawField,
): MemoryScope {
  return {
    origin: new URL(analysis.snapshot.url).origin,
    adapter: analysis.ats.adapter,
    adapterVersion: analysis.ats.adapterVersion,
    locale: "und",
    control: field.controlKind,
    question: field.accessibleName || field.labelText || field.name,
    group: field.groupLabel,
  };
}
export function correctedMapping(
  base: FieldMapping,
  field: RawField,
  store: MemoryStore,
  owner: MemoryOwner,
  scope: MemoryScope,
  profile: CandidateProfile,
  now = Date.now(),
): FieldMapping {
  if (!scope.question.trim() || scope.question.length > 500 || scope.group.length > 500)
    return base;
  // A correction cannot turn sensitive page wording into an ordinary contact field.
  if (
    /consent|agree|citizenship|authorization|sponsor|disability|gender|veteran|password|social security/i.test(
      `${scope.question} ${scope.group}`,
    )
  )
    return base;
  const retrieved = retrieveCorrection(store, owner, scope, now);
  if (retrieved.status === "NONE") return base;
  const record = retrieved.records[0]!;
  const parsed = CanonicalQuestionSchema.safeParse(record.accepted);
  const facts: Record<
    string,
    | {
        status: string;
        value: unknown;
        expiresAt?: string | undefined;
        refreshAfter?: string | undefined;
      }
    | undefined
  > = {
    "IDENTITY.legal_name.full": profile.identity.legalName,
    "IDENTITY.legal_name.given": profile.identity.legalName,
    "IDENTITY.legal_name.family": profile.identity.legalName,
    "CONTACT.email": profile.contact.emails[0],
    "CONTACT.phone": profile.contact.phones[0],
    "ADDRESS.city": profile.contact.addresses[0],
    "ADDRESS.country": profile.contact.addresses[0],
    "LINKS.portfolio": profile.links.portfolio,
    "LINKS.linkedin": profile.links.linkedin,
    "LINKS.github": profile.links.github,
  };
  const fact = facts[record.accepted];
  const verified =
    fact &&
    fact.value !== null &&
    ["VERIFIED_USER", "VERIFIED_DOCUMENT"].includes(fact.status) &&
    (!fact.expiresAt || Date.parse(fact.expiresAt) > now) &&
    (!fact.refreshAfter || Date.parse(fact.refreshAfter) > now);
  const manual = retrieved.status === "CONFLICT" || !parsed.success || !verified;
  return FieldMappingSchema.parse({
    fieldId: field.fieldId,
    canonicalQuestion: manual ? null : parsed.data,
    tier: manual ? "UNMAPPED" : "R1",
    confidence: manual ? 0 : 1,
    fillable: false,
    evidence: [
      `memory:${record.id}:${record.revision}`,
      `Reviewed field meaning: ${record.accepted}`,
    ],
    ...(manual
      ? {
          blockedReason:
            retrieved.status === "CONFLICT"
              ? "Conflicting corrections require review in Correction memory."
              : !verified && parsed.success
                ? "Verify the corresponding profile fact before reusing this correction."
                : "Your correction requires manual completion.",
        }
      : {}),
  });
}
