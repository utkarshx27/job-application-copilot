import { z } from "zod";
import { DiscoveryJobSchema, type DiscoveryJob } from "./discovery";
import { MemoryOwnerSchema, sameMemoryOwner, type MemoryOwner } from "./feedback-memory";
import { isPreparationExecutionUrl } from "./local-portal-url";

export function preparationUrl(job: DiscoveryJob): string {
  if (job.source !== "LOCAL_TEST_ATS" || !/^job-\d+-\d+$/.test(job.sourceJobId))
    throw new Error("Only the native local catalog demo supports preparation.");
  const url = job.applicationUrl;
  if (
    !url ||
    !isPreparationExecutionUrl(url) ||
    !url.endsWith(`&jobId=${job.sourceJobId}`) ||
    job.availability !== "AVAILABLE"
  )
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
export const PreparationFileSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(150)
      .regex(/^[^/\\]+\.(?:txt|pdf|docx)$/i),
    base64: z
      .string()
      .min(4)
      .max(666668)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const PreparationExtraAnswersSchema = z
  .object({
    experienceMonths: z.string().regex(/^\d{1,4}$/),
    noticeDays: z.string().regex(/^\d{1,4}$/),
    currentSalary: z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/),
    expectedSalary: z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/),
    currency: z.enum(["INR", "USD", "EUR"]),
    salaryPeriod: z.enum(["Year", "Month", "Hour"]),
  })
  .strict();
export const PreparationQuestionSchema = z
  .object({
    key: z.string().min(1).max(100),
    label: z.string().min(1).max(300),
    kind: z.enum(["text", "email", "number", "select", "file"]),
    options: z.array(z.string().max(300)).max(30),
    value: z.string().max(5000),
    required: z.boolean(),
  })
  .strict();
export const PreparationRecordSchema = z
  .object({
    id: z.uuid(),
    revision: z.number().int().positive(),
    owner: MemoryOwnerSchema,
    job: DiscoveryJobSchema,
    profileDigest: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.enum([
      "REVIEW_REQUIRED",
      "PREPARING",
      "PREPARED",
      "NEEDS_REVIEW",
      "CANCELLED",
      "QUESTIONS",
      "READY_TO_SUBMIT",
      "SUBMITTING",
      "OUTCOME_UNKNOWN",
      "SUBMITTED",
    ]),
    answers: PreparationAnswersSchema.nullable(),
    submissionApproved: z.literal(false),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    tabId: z.number().int().nonnegative().nullable(),
    documentId: z.string().nullable(),
    actions: z.array(z.enum(["OPEN_FORM", "FILL_FIELDS"])).max(2),
    reason: z.string().max(500),
    trackerRecorded: z.boolean(),
    completeFlow: z.boolean().default(false),
    extraAnswers: PreparationExtraAnswersSchema.nullable().default(null),
    file: PreparationFileSchema.nullable().default(null),
    applicationId: z.uuid().nullable().default(null),
    runId: z.uuid().nullable().default(null),
    submitRunId: z.uuid().nullable().default(null),
    questions: z.array(PreparationQuestionSchema).max(30).default([]),
    reviewedQuestions: z
      .array(
        z
          .object({
            key: z.string(),
            label: z.string(),
            value: z.string().max(5000),
            meaning: z.string().nullable(),
            memoryRef: z
              .object({ id: z.uuid(), revision: z.number().int().positive() })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(30)
      .default([]),
    reviewHash: z.string().nullable().default(null),
    receipt: z
      .object({ applicationId: z.uuid(), jobId: z.string(), status: z.literal("ACCEPTED") })
      .strict()
      .nullable()
      .default(null),
    confirmationRecorded: z.boolean().default(false),
    completedAt: z.number().nullable().default(null),
    manualInterventions: z.number().int().nonnegative().default(0),
    memoryUses: z.number().int().nonnegative().default(0),
    workflowId: z.uuid().nullable().default(null),
    startedAt: z.number().nullable().default(null),
    actionCount: z.number().int().nonnegative().default(0),
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
      !record.completeFlow &&
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
