import { z } from "zod";
import {
  DiscoveryStoreSchema,
  DiscoveryViewSchema,
  CompanyRecordSchema,
  DiscoveryJobSchema,
  discoveryOwner,
  putDiscoveryOwner,
  emptyDiscovery,
  mergeDiscoveredJobs,
  rankDiscoveredJob,
  companyEvidenceFor,
  memoryOwnerKey,
  type DiscoveryJob,
  type CompanyRecord,
  type DiscoveryStore,
  type MemoryOwner,
} from "@copilot/agent-core";
import { emptyCareerPreferences } from "@copilot/candidate-schema";
import { getProfileVault } from "./profile-storage";
import { memoryOwner } from "./feedback-memory";
import { PrivateRepository } from "./private-repository";
const origin = "http://127.0.0.1:4173";
const listing = z.object({
  id: z.string(),
  title: z.string(),
  companyId: z.string(),
  company: z.string(),
  location: z.string(),
  destination: z.string().nullable(),
  expired: z.boolean(),
  salary: DiscoveryJobSchema.shape.salary,
});
const company = z.object({
  id: z.string(),
  name: z.string(),
  location: z.string(),
  demo: z.literal(true),
  ratings: z.array(
    z.object({
      source: z.string(),
      value: z.number().nullable(),
      scale: z.number(),
      count: z.number(),
      retrievedAt: z.string(),
    }),
  ),
});
export class DiscoveryController {
  private readonly repository = new PrivateRepository(
    "copilot-discovery-v1",
    DiscoveryStoreSchema,
    emptyDiscovery,
  );
  private readonly searches = new Map<string, AbortController>();
  async view() {
    const vault = await getProfileVault();
    const owner = memoryOwner(vault);
    const now = Date.now();
    const store = await this.repository.transact();
    const data = discoveryOwner(store, owner, now);
    const preferences = vault.currentProfile.careerSetup?.preferences ?? emptyCareerPreferences();
    return DiscoveryViewSchema.parse({
      kind: "DISCOVERY_VIEW",
      owner,
      revision: store.revision,
      sourceStatus: data.sourceStatus,
      remainingReads: 50 - data.reads,
      jobs: data.jobs
        .map((job) => ({
          job,
          ...rankDiscoveredJob(job, preferences, now),
          dismissed: data.dismissed.includes(job.id),
          evidence: companyEvidenceFor(job, data.companies, now),
        }))
        .sort((a, b) => b.score - a.score),
    });
  }
  private async mutate(
    owner: MemoryOwner,
    change: (data: DiscoveryStore["owners"][number]) => DiscoveryStore["owners"][number],
  ) {
    return this.repository.transact((store) =>
      putDiscoveryOwner(store, change(discoveryOwner(store, owner, Date.now()))),
    );
  }
  async cancel() {
    const owner = memoryOwner(await getProfileVault());
    this.searches.get(memoryOwnerKey(owner))?.abort();
    return this.view();
  }
  async search(query: string) {
    const owner = memoryOwner(await getProfileVault());
    const key = memoryOwnerKey(owner);
    if (this.searches.has(key))
      throw new Error("A search is already running. Cancel it before starting another.");
    const controller = new AbortController();
    this.searches.set(key, controller);
    const jobs: DiscoveryJob[] = [];
    const companies: CompanyRecord[] = [];
    const read = async (path: string) => {
      controller.signal.throwIfAborted();
      await this.mutate(owner, (data) => {
        if (data.reads >= 50) throw new Error("Daily local catalog read budget exhausted.");
        return { ...data, reads: data.reads + 1 };
      });
      const response = await fetch(origin + path, {
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      });
      if (!response.ok) throw new Error(`Local catalog returned HTTP ${response.status}.`);
      const text = await response.text();
      if (text.length > 1_000_000) throw new Error("Catalog response too large.");
      return JSON.parse(text) as unknown;
    };
    try {
      for (let page = 0; page < 5; page++) {
        const path = `/api/portal/jobs?q=${encodeURIComponent(query)}&page=${page}`;
        const result = z
          .object({ jobs: z.array(listing).max(100), hasMore: z.boolean() })
          .parse(await read(path));
        for (const entry of result.jobs) {
          const destination = entry.destination ? new URL(entry.destination, origin) : null;
          if (destination && destination.origin !== origin)
            throw new Error("The local catalog returned an external destination.");
          jobs.push(
            DiscoveryJobSchema.parse({
              id: `local:${entry.id}`,
              source: "LOCAL_TEST_ATS",
              sourceJobId: entry.id,
              sourceUrl: origin + path,
              title: entry.title,
              description: "Synthetic local catalog listing",
              companyKey: `local:${entry.companyId}`,
              company: entry.company,
              location: entry.location,
              applicationUrl: destination?.href ?? null,
              availability: entry.expired ? "EXPIRED" : destination ? "AVAILABLE" : "UNKNOWN",
              observedAt: Date.now(),
              salary: entry.salary,
              provenance: [origin + path],
            }),
          );
        }
        if (!result.hasMore) break;
        if (page === 4) throw new Error("Local catalog exceeded the five-page search limit.");
      }
      for (const entry of z
        .array(company)
        .max(200)
        .parse(await read("/api/portal/companies")))
        companies.push(
          CompanyRecordSchema.parse({
            key: `local:${entry.id}`,
            name: entry.name,
            location: entry.location,
            sourceUrl: origin + "/api/portal/companies",
            observedAt: Date.now(),
            ratings: entry.ratings.map((rating) => ({
              ...rating,
              sourceUrl: origin + "/api/portal/companies",
            })),
          }),
        );
      controller.signal.throwIfAborted();
      const current = memoryOwner(await getProfileVault());
      if (memoryOwnerKey(current) !== key || current.profileRevision !== owner.profileRevision)
        throw new Error("Profile changed during search. Search again.");
      await this.mutate(owner, (data) => ({
        ...data,
        jobs: mergeDiscoveredJobs(data.jobs, jobs),
        companies: [
          ...data.companies.filter((entry) => !entry.key.startsWith("local:")),
          ...companies,
        ],
        sourceStatus: "READY",
      }));
      return this.view();
    } catch (error) {
      await this.mutate(owner, (data) => ({
        ...data,
        sourceStatus: controller.signal.aborted
          ? "CANCELLED"
          : data.reads >= 50
            ? "BUDGET_EXHAUSTED"
            : "ERROR",
      }));
      throw error;
    } finally {
      this.searches.delete(key);
    }
  }
  async importListing(input: {
    title: string;
    company: string;
    location: string;
    url: string;
    description: string;
  }) {
    const owner = memoryOwner(await getProfileVault());
    const id = crypto.randomUUID();
    // A tuple hash avoids delimiter collisions such as ("A:B", "C") and ("A", "B:C").
    const identity = JSON.stringify(
      [input.company, input.location].map((value) =>
        value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim(),
      ),
    );
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
    const companyKey = `import:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    const job = DiscoveryJobSchema.parse({
      id,
      source: "IMPORT",
      sourceJobId: id,
      sourceUrl: input.url,
      title: input.title,
      company: input.company,
      companyKey,
      location: input.location,
      description: input.description,
      applicationUrl: input.url,
      availability: "UNKNOWN",
      observedAt: Date.now(),
      salary: null,
      provenance: [input.url],
    });
    await this.mutate(owner, (data) => ({ ...data, jobs: mergeDiscoveredJobs(data.jobs, [job]) }));
    return this.view();
  }
  async dismiss(id: string, dismissed: boolean) {
    const owner = memoryOwner(await getProfileVault());
    await this.mutate(owner, (data) => {
      if (!data.jobs.some((job) => job.id === id))
        throw new Error("Job unavailable for this profile.");
      return {
        ...data,
        dismissed: dismissed
          ? [...new Set([...data.dismissed, id])]
          : data.dismissed.filter((jobId) => jobId !== id),
      };
    });
    return this.view();
  }
  async forget(id: string) {
    const owner = memoryOwner(await getProfileVault());
    await this.mutate(owner, (data) => {
      const job = data.jobs.find((entry) => entry.id === id);
      if (!job) throw new Error("Job unavailable for this profile.");
      const jobs = data.jobs.filter((entry) => entry.id !== id);
      return {
        ...data,
        jobs,
        dismissed: data.dismissed.filter((entry) => entry !== id),
        companies: data.companies.filter(
          (entry) =>
            entry.key !== job.companyKey || jobs.some((other) => other.companyKey === entry.key),
        ),
      };
    });
    return this.view();
  }
  async evidence(id: string, rating: CompanyRecord["ratings"][number] | null) {
    const owner = memoryOwner(await getProfileVault());
    await this.mutate(owner, (data) => {
      const job = data.jobs.find((entry) => entry.id === id);
      if (!job || job.source !== "IMPORT")
        throw new Error("Manual evidence is only available for an imported listing.");
      const prior = data.companies.find((entry) => entry.key === job.companyKey);
      const companies = data.companies.filter((entry) => entry.key !== job.companyKey);
      if (rating) {
        if (Date.parse(rating.retrievedAt) > Date.now())
          throw new Error("A source retrieval date cannot be in the future.");
        companies.push(
          CompanyRecordSchema.parse({
            key: job.companyKey,
            name: job.company,
            location: job.location,
            sourceUrl: rating.sourceUrl,
            observedAt: Date.now(),
            ratings: [
              ...(prior?.ratings ?? []).filter((entry) => entry.sourceUrl !== rating.sourceUrl),
              rating,
            ],
          }),
        );
      }
      return { ...data, companies };
    });
    return this.view();
  }
}
