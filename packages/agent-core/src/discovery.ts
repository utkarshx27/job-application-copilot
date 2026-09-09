import { z } from "zod";
import { MemoryOwnerSchema, sameMemoryOwner, type MemoryOwner } from "./feedback-memory";
const WebUrl = z.url().refine((value) => {
  const url = new URL(value);
  return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
}, "Use a public HTTP(S) URL without credentials");
export const DiscoveryJobSchema = z
  .object({
    id: z.string().min(1).max(200),
    source: z.enum(["LOCAL_TEST_ATS", "IMPORT"]),
    sourceUrl: WebUrl,
    sourceJobId: z.string().min(1).max(200),
    title: z.string().min(1).max(300),
    description: z.string().max(20000).default(""),
    companyKey: z.string().min(1).max(200),
    company: z.string().min(1).max(300),
    location: z.string().max(300),
    applicationUrl: WebUrl.nullable(),
    availability: z.enum(["AVAILABLE", "EXPIRED", "UNKNOWN"]),
    observedAt: z.number().int().nonnegative(),
    salary: z
      .object({
        amount: z.number().finite().nonnegative(),
        currency: z.string().regex(/^[A-Z]{3}$/),
        period: z.enum(["HOUR", "MONTH", "YEAR"]),
      })
      .strict()
      .nullable(),
    provenance: z.array(WebUrl).max(20),
  })
  .strict();
export const CompanyRecordSchema = z
  .object({
    key: z.string().min(1).max(200),
    name: z.string().min(1).max(300),
    location: z.string().max(300),
    sourceUrl: WebUrl,
    observedAt: z.number().int().nonnegative(),
    ratings: z
      .array(
        z
          .object({
            source: z.string().min(1).max(300),
            value: z.number().finite().nonnegative().nullable(),
            scale: z.number().finite().positive().max(100),
            count: z.number().int().nonnegative(),
            retrievedAt: z.iso.date(),
            sourceUrl: WebUrl,
          })
          .strict()
          .refine((rating) => rating.value === null || rating.value <= rating.scale),
      )
      .max(20),
  })
  .strict();
export const DiscoveryStoreSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    owners: z
      .array(
        z
          .object({
            owner: MemoryOwnerSchema,
            jobs: z.array(DiscoveryJobSchema).max(500),
            companies: z.array(CompanyRecordSchema).max(200),
            dismissed: z.array(z.string()).max(500),
            reads: z.number().int().min(0).max(50),
            day: z.string(),
            sourceStatus: z.enum(["IDLE", "READY", "ERROR", "CANCELLED", "BUDGET_EXHAUSTED"]),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type DiscoveryJob = z.infer<typeof DiscoveryJobSchema>;
export type CompanyRecord = z.infer<typeof CompanyRecordSchema>;
export type DiscoveryStore = z.infer<typeof DiscoveryStoreSchema>;
export const emptyDiscovery = (): DiscoveryStore => ({ version: 1, revision: 0, owners: [] });
export function discoveryOwner(store: DiscoveryStore, owner: MemoryOwner, now: number) {
  const day = new Date(now).toISOString().slice(0, 10);
  const prior = store.owners.find((entry) => sameMemoryOwner(entry.owner, owner));
  return prior
    ? { ...prior, owner, reads: prior.day === day ? prior.reads : 0, day }
    : {
        owner,
        jobs: [],
        companies: [],
        dismissed: [],
        reads: 0,
        day,
        sourceStatus: "IDLE" as const,
      };
}
export function putDiscoveryOwner(store: DiscoveryStore, entry: DiscoveryStore["owners"][number]) {
  return DiscoveryStoreSchema.parse({
    ...store,
    revision: store.revision + 1,
    owners: [...store.owners.filter((prior) => !sameMemoryOwner(prior.owner, entry.owner)), entry],
  });
}
function normalize(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}
function identity(job: DiscoveryJob) {
  if (job.source === "LOCAL_TEST_ATS" || !job.applicationUrl)
    return `${job.source}:${job.sourceJobId}`;
  const url = new URL(job.applicationUrl);
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (/^utm_|^ref$|^source$/.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return JSON.stringify([url.href, job.companyKey, normalize(job.title), normalize(job.location)]);
}
export function mergeDiscoveredJobs(existing: DiscoveryJob[], incoming: DiscoveryJob[]) {
  const result = new Map<string, DiscoveryJob>();
  for (const input of [...existing, ...incoming]) {
    const job = DiscoveryJobSchema.parse(input);
    const key = identity(job);
    const previous = result.get(key);
    const current = previous && previous.observedAt > job.observedAt ? previous : job;
    result.set(key, {
      ...current,
      id: previous?.id ?? job.id,
      provenance: [
        ...new Set([...(previous?.provenance ?? []), ...job.provenance, job.sourceUrl]),
      ].slice(0, 20),
    });
  }
  return [...result.values()];
}
export type DiscoveryPreferences = {
  targetRoles: string[];
  targetLocations: string[];
  excludedCompanies: string[];
  excludedKeywords: string[];
  expectedCompensation: { amount: number; currency: string; period: string } | null;
};
export function rankDiscoveredJob(
  job: DiscoveryJob,
  preferences: DiscoveryPreferences,
  now: number,
) {
  const text = normalize(`${job.title} ${job.description}`);
  const reasons: string[] = [];
  const excluded =
    preferences.excludedCompanies.some(
      (company) => normalize(company) === normalize(job.company),
    ) ||
    preferences.excludedKeywords.some(
      (keyword) => normalize(keyword) && text.includes(normalize(keyword)),
    );
  let score = 0;
  if (
    preferences.targetRoles.some(
      (role) => normalize(role) && normalize(job.title).includes(normalize(role)),
    )
  ) {
    score += 60;
    reasons.push(`Title matches a preferred role: ${job.title}`);
  }
  if (
    preferences.targetLocations.some(
      (location) => normalize(location) && normalize(job.location).includes(normalize(location)),
    )
  ) {
    score += 30;
    reasons.push(`Location matches your preference: ${job.location}`);
  }
  const expected = preferences.expectedCompensation;
  if (!job.salary) reasons.push("Salary unavailable");
  else if (
    expected &&
    job.salary.currency === expected.currency &&
    job.salary.period === expected.period
  ) {
    if (job.salary.amount >= expected.amount) {
      score += 10;
      reasons.push("Listed compensation meets your stated expectation");
    } else reasons.push("Listed compensation is below your stated expectation");
  } else reasons.push("Compensation is not directly comparable to your expectation");
  const stale = now < job.observedAt || now - job.observedAt > 86400_000;
  if (stale) reasons.push("Availability needs a fresh check");
  if (excluded) reasons.push("Excluded by your preferences");
  return { score, reasons, excluded, stale };
}
export function companyEvidenceFor(job: DiscoveryJob, companies: CompanyRecord[], now: number) {
  const matches = companies.filter(
    (company) =>
      company.key === job.companyKey &&
      normalize(company.name) === normalize(job.company) &&
      normalize(company.location) === normalize(job.location),
  );
  if (matches.length !== 1) return { status: "UNAVAILABLE" as const, ratings: [] };
  return {
    status: "AVAILABLE" as const,
    ratings: matches[0]!.ratings.map((rating) => ({
      ...rating,
      stale:
        Date.parse(rating.retrievedAt) > now ||
        now - Date.parse(rating.retrievedAt) > 180 * 86400_000,
      smallSample: rating.count < 10,
    })),
  };
}
export const DiscoveryViewSchema = z
  .object({
    kind: z.literal("DISCOVERY_VIEW"),
    owner: MemoryOwnerSchema,
    revision: z.number().int().nonnegative(),
    sourceStatus: z.string(),
    remainingReads: z.number().int().nonnegative(),
    jobs: z.array(
      z.object({
        job: DiscoveryJobSchema,
        score: z.number(),
        reasons: z.array(z.string()),
        excluded: z.boolean(),
        stale: z.boolean(),
        dismissed: z.boolean(),
        evidence: z.object({
          status: z.enum(["AVAILABLE", "UNAVAILABLE"]),
          ratings: z.array(
            CompanyRecordSchema.shape.ratings.element.safeExtend({
              stale: z.boolean(),
              smallSample: z.boolean(),
            }),
          ),
        }),
      }),
    ),
  })
  .strict();
