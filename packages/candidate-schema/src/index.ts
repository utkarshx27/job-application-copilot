import { z } from "zod";

export const ISODateTimeSchema = z.iso.datetime({ offset: true });
export const ISODateSchema = z.iso.date();

export const FactStatusSchema = z.enum([
  "VERIFIED_USER",
  "VERIFIED_DOCUMENT",
  "DERIVED",
  "GENERATED",
  "UNKNOWN",
  "CONFLICTED",
  "STALE",
]);

export const SensitivitySchema = z.enum([
  "PUBLIC",
  "PROFESSIONAL",
  "PERSONAL",
  "SENSITIVE",
  "HIGHLY_SENSITIVE",
]);

export const ReuseScopeSchema = z.enum(["APPLICATION", "COMPANY", "COUNTRY", "ROLE", "GLOBAL"]);

const CandidateFactBaseSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  status: FactStatusSchema,
  sensitivity: SensitivitySchema,
  sourceIds: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
  verifiedAt: ISODateTimeSchema.optional(),
  refreshAfter: ISODateTimeSchema.optional(),
  expiresAt: ISODateTimeSchema.optional(),
  reuseScope: ReuseScopeSchema,
  version: z.number().int().positive(),
});

export const candidateFactSchema = <T extends z.ZodTypeAny>(valueSchema: T) =>
  CandidateFactBaseSchema.extend({ value: valueSchema.nullable() }).superRefine((fact, context) => {
    const checked = fact as unknown as {
      status: z.infer<typeof FactStatusSchema>;
      value: unknown;
      verifiedAt?: string;
    };

    if (checked.status === "VERIFIED_USER" && checked.value !== null && !checked.verifiedAt) {
      context.addIssue({
        code: "custom",
        path: ["verifiedAt"],
        message: "A user-verified value requires verifiedAt",
      });
    }

    if (checked.status === "UNKNOWN" && checked.value !== null) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "An unknown fact cannot carry a value",
      });
    }
  });

export const PersonNameSchema = z
  .object({
    full: z.string().min(1),
    given: z.string().min(1),
    middle: z.string().optional(),
    family: z.string().min(1).nullable(),
    suffix: z.string().optional(),
  })
  .strict();

export const EmailSchema = z.object({
  address: z.email(),
  kind: z.enum(["PERSONAL", "WORK", "OTHER"]).default("PERSONAL"),
  primary: z.boolean().default(false),
});

export const PhoneSchema = z.object({
  e164: z.string().regex(/^\+[1-9]\d{6,14}$/, "Expected an E.164 phone number"),
  kind: z.enum(["MOBILE", "HOME", "WORK", "OTHER"]).default("MOBILE"),
  primary: z.boolean().default(false),
});

export const AddressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  region: z.string().optional(),
  postalCode: z.string().optional(),
  countryCode: z.string().length(2).toUpperCase(),
  kind: z.enum(["HOME", "MAILING", "OTHER"]).default("HOME"),
});

export const DateRangeSchema = z
  .object({
    start: ISODateSchema,
    end: ISODateSchema.nullable(),
    current: z.boolean(),
  })
  .superRefine((range, context) => {
    if (range.current !== (range.end === null)) {
      context.addIssue({
        code: "custom",
        path: ["end"],
        message: "Current ranges must have a null end date; completed ranges require an end date",
      });
    }
    if (range.end && range.end < range.start) {
      context.addIssue({ code: "custom", path: ["end"], message: "End date precedes start date" });
    }
  });

export const WorkExperienceSchema = z.object({
  id: z.string().min(1),
  employer: candidateFactSchema(z.string().min(1)),
  title: candidateFactSchema(z.string().min(1)),
  location: candidateFactSchema(z.string().min(1)).optional(),
  dates: candidateFactSchema(DateRangeSchema),
  description: candidateFactSchema(z.string()).optional(),
  skills: z.array(z.string()).default([]),
});

export const EducationRecordSchema = z.object({
  id: z.string().min(1),
  institution: candidateFactSchema(z.string().min(1)),
  degree: candidateFactSchema(z.string().min(1)),
  fieldOfStudy: candidateFactSchema(z.string().min(1)).optional(),
  gpa: candidateFactSchema(z.string().min(1)).optional(),
  dates: candidateFactSchema(DateRangeSchema).optional(),
});

export const WorkAuthorizationSchema = z.object({
  id: z.string().min(1),
  countryCode: z.string().length(2).toUpperCase(),
  currentlyAuthorized: candidateFactSchema(z.enum(["YES", "NO", "UNKNOWN"])),
  currentSponsorshipRequired: candidateFactSchema(z.enum(["YES", "NO", "UNKNOWN"])),
  futureSponsorshipRequired: candidateFactSchema(z.enum(["YES", "NO", "UNKNOWN"])),
  visaType: candidateFactSchema(z.string().min(1)).optional(),
  visaExpiration: candidateFactSchema(ISODateSchema).optional(),
});

export const AnswerValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
]);
export const TriStateAnswerSchema = z.enum([
  "YES",
  "NO",
  "UNKNOWN",
  "CONDITIONAL",
  "DECLINE",
  "NOT_APPLICABLE",
  "ASK_USER",
]);

export const SavedResponseSchema = z.object({
  id: z.string().min(1),
  canonicalQuestion: z.string().min(1).optional(),
  normalizedQuestion: z.string().min(1).optional(),
  keywords: z.array(z.string().min(1)).default([]),
  answer: AnswerValueSchema,
  source: z.enum(["USER_CONFIRMED", "PROFILE_FACT", "GENERATED_CONFIRMED"]),
  sensitivity: SensitivitySchema,
  reuseScope: ReuseScopeSchema,
  conditions: z.record(z.string(), z.unknown()).optional(),
  createdAt: ISODateTimeSchema,
  verifiedAt: ISODateTimeSchema,
  expiresAt: ISODateTimeSchema.optional(),
});

export const CandidateProfileSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  profileVersion: z.number().int().positive(),
  createdAt: ISODateTimeSchema,
  updatedAt: ISODateTimeSchema,
  identity: z.object({
    legalName: candidateFactSchema(PersonNameSchema),
    preferredName: candidateFactSchema(PersonNameSchema).optional(),
    pronunciation: candidateFactSchema(z.string()).optional(),
    pronouns: candidateFactSchema(z.string()).optional(),
  }),
  contact: z.object({
    emails: z.array(candidateFactSchema(EmailSchema)),
    phones: z.array(candidateFactSchema(PhoneSchema)),
    addresses: z.array(candidateFactSchema(AddressSchema)),
  }),
  links: z.object({
    portfolio: candidateFactSchema(z.url()).optional(),
    github: candidateFactSchema(z.url()).optional(),
    linkedin: candidateFactSchema(z.url()).optional(),
    other: z.array(candidateFactSchema(z.url())),
  }),
  workHistory: z.array(WorkExperienceSchema),
  education: z.array(EducationRecordSchema),
  projects: z.array(candidateFactSchema(z.string().min(1))).default([]),
  publications: z.array(candidateFactSchema(z.string().min(1))).default([]),
  skills: z.array(candidateFactSchema(z.string().min(1))),
  certifications: z.array(candidateFactSchema(z.string().min(1))),
  languages: z.array(candidateFactSchema(z.string().min(1))),
  workAuthorization: z.array(WorkAuthorizationSchema),
  compensationPreferences: z.array(candidateFactSchema(z.string().min(1))),
  relocationPreferences: candidateFactSchema(z.string()).optional(),
  travelPreferences: candidateFactSchema(z.string()).optional(),
  availability: candidateFactSchema(z.string()).optional(),
  jobPreferences: z.array(candidateFactSchema(z.string().min(1))),
  answerLibrary: z.array(SavedResponseSchema),
  sensitivePreferences: z.array(candidateFactSchema(z.string())),
  exclusionRules: z.array(z.string().min(1)),
});

export type CandidateProfile = z.infer<typeof CandidateProfileSchema>;
export type CandidateFact<T> = z.infer<ReturnType<typeof candidateFactSchema<z.ZodType<T>>>>;
export type FactStatus = z.infer<typeof FactStatusSchema>;
export type Sensitivity = z.infer<typeof SensitivitySchema>;
export type TriStateAnswer = z.infer<typeof TriStateAnswerSchema>;
