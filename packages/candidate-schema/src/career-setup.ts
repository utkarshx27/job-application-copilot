import { z } from "zod";

const Labels = z.array(z.string().trim().min(1).max(160)).max(40);
export const CompensationSchema = z
  .object({
    amount: z.number().finite().nonnegative().max(1_000_000_000),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, "Use a three-letter currency code, such as INR or USD"),
    period: z.enum(["HOUR", "MONTH", "YEAR"]),
  })
  .strict();

export const CareerPreferencesSchema = z
  .object({
    targetRoles: Labels,
    targetLocations: Labels,
    workArrangements: z.array(z.enum(["REMOTE", "HYBRID", "ONSITE"])).max(3),
    currentLocation: z.string().trim().max(200),
    totalExperienceMonths: z.number().int().min(0).max(960).nullable(),
    noticePeriodDays: z.number().int().min(0).max(730).nullable(),
    currentCompensation: CompensationSchema.nullable(),
    expectedCompensation: CompensationSchema.nullable(),
    excludedCompanies: Labels,
    excludedKeywords: Labels,
  })
  .strict();

export const CareerSetupSchema = z
  .object({
    setupVersion: z.literal(1),
    preferences: CareerPreferencesSchema,
    // Context supplied by the person, never evidence of a skill or eligibility.
    backgroundNotes: z.string().max(20_000),
    notesUse: z.literal("CONTEXT_ONLY"),
    sourceIds: z.array(z.string().min(1)).min(1),
    reviewedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type CareerPreferences = z.infer<typeof CareerPreferencesSchema>;
export type CareerSetup = z.infer<typeof CareerSetupSchema>;

export function emptyCareerPreferences(): CareerPreferences {
  return {
    targetRoles: [],
    targetLocations: [],
    workArrangements: [],
    currentLocation: "",
    totalExperienceMonths: null,
    noticePeriodDays: null,
    currentCompensation: null,
    expectedCompensation: null,
    excludedCompanies: [],
    excludedKeywords: [],
  };
}
