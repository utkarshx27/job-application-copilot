import { z } from "zod";
import { DiscoveryJobSchema, type DiscoveryJob } from "./discovery";
import { MemoryOwnerSchema, sameMemoryOwner, type MemoryOwner } from "./feedback-memory";

export function preparationUrl(job: DiscoveryJob): string {
  if (job.source !== "LOCAL_TEST_ATS" || !/^job-\d+-\d+$/.test(job.sourceJobId))
    throw new Error("Only the native local catalog demo supports preparation.");
  const url = `http://127.0.0.1:4173/portal.html?scenario=portal-01&jobId=${job.sourceJobId}`;
  if (job.applicationUrl !== url || job.availability !== "AVAILABLE")
    throw new Error("This job does not have an available native local preparation route.");
  return url;
}
export function preparationJobIdentity(job: DiscoveryJob) {
  return JSON.stringify([
    job.source,
    job.sourceJobId,
    job.applicationUrl,
    job.companyKey,
    job.company,
    job.title,
    job.location,
    job.salary,
  ]);
}
export const PreparationAnswersSchema = z
  .object({
    name: z.string().trim().min(1).max(300),
    email: z.email().max(300),
    phone: z.string().regex(/^\+[1-9]\d{6,14}$/),
    currentLocation: z.string().trim().min(1).max(300),
    workArrangement: z.enum(["Remote", "Hybrid", "On-site"]),
  })
  .strict();
export const PreparationRecordSchema = z
  .object({
    id: z.uuid(),
    revision: z.number().int().positive(),
    owner: MemoryOwnerSchema,
    job: DiscoveryJobSchema,
    profileDigest: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.enum(["REVIEW_REQUIRED", "PREPARING", "PREPARED", "NEEDS_REVIEW", "CANCELLED"]),
    answers: PreparationAnswersSchema.nullable(),
    submissionApproved: z.literal(false),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    tabId: z.number().int().nonnegative().nullable(),
    documentId: z.string().nullable(),
    actions: z.array(z.enum(["OPEN_FORM", "FILL_FIELDS"])).max(2),
    reason: z.string().max(500),
    trackerRecorded: z.boolean(),
  })
  .strict()
  .superRefine((record, context) => {
    try {
      preparationUrl(record.job);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Preparation must retain an allowed native local job.",
      });
    }
    if (record.expiresAt <= record.createdAt || record.expiresAt - record.createdAt > 600000)
      context.addIssue({
        code: "custom",
        message: "Preparation review must expire within ten minutes.",
      });
    if (["PREPARING", "PREPARED"].includes(record.state) && !record.answers)
      context.addIssue({ code: "custom", message: "Preparation requires approved answers." });
    if (
      new Set(record.actions).size !== record.actions.length ||
      (record.actions.includes("FILL_FIELDS") && record.actions[0] !== "OPEN_FORM")
    )
      context.addIssue({
        code: "custom",
        message: "Preparation actions must be ordered and unique.",
      });
    if (
      record.state === "PREPARED" &&
      (record.actions.length !== 2 || record.tabId === null || !record.documentId)
    )
      context.addIssue({
        code: "custom",
        message: "Prepared state requires document-bound verification.",
      });
  });
export const PreparationForgottenSchema = z
  .object({ kind: z.literal("JOB_PREPARATION_FORGOTTEN"), id: z.uuid() })
  .strict();
export const PreparationStoreSchema = z
  .object({ version: z.literal(1), records: z.array(PreparationRecordSchema).max(100) })
  .strict();
export type PreparationRecord = z.infer<typeof PreparationRecordSchema>;
export type PreparationStore = z.infer<typeof PreparationStoreSchema>;
export type PreparationAnswers = z.infer<typeof PreparationAnswersSchema>;
export const emptyPreparations = (): PreparationStore => ({ version: 1, records: [] });
export const PreparationViewSchema = z
  .object({
    kind: z.literal("JOB_PREPARATION"),
    record: PreparationRecordSchema,
    contact: z
      .object({
        name: z.string(),
        email: z.string(),
        phone: z.string(),
        currentLocation: z.string(),
      })
      .strict(),
    blockers: z.array(z.string()),
  })
  .strict();

export function claimPreparation(
  store: PreparationStore,
  id: string,
  revision: number,
  owner: MemoryOwner,
  digest: string,
  job: DiscoveryJob,
  answers: PreparationAnswers,
  now: number,
): PreparationStore {
  const record = store.records.find(
    (entry) => entry.id === id && sameMemoryOwner(entry.owner, owner),
  );
  if (!record || record.revision !== revision || record.state !== "REVIEW_REQUIRED")
    throw new Error("Preparation changed or was already approved. Refresh its status.");
  preparationUrl(job);
  if (
    record.owner.profileRevision !== owner.profileRevision ||
    record.profileDigest !== digest ||
    preparationJobIdentity(record.job) !== preparationJobIdentity(job)
  )
    throw new Error("Job or profile changed. Review this application again.");
  if (record.expiresAt <= now || record.createdAt > now)
    throw new Error("Approval review expired. Review this application again.");
  return PreparationStoreSchema.parse({
    ...store,
    records: store.records.map((entry) =>
      entry.id === id
        ? {
            ...record,
            revision: revision + 1,
            answers: PreparationAnswersSchema.parse(answers),
            state: "PREPARING",
          }
        : entry,
    ),
  });
}
