import {
  CandidateProfileSchema,
  CareerPreferencesSchema,
  SavedResponseSchema,
  type CandidateProfile,
  type FactStatus,
  type SavedResponse,
  type Sensitivity,
} from "@copilot/candidate-schema";
import { z } from "zod";

const ISODateTimeSchema = z.iso.datetime({ offset: true });

export const ProfileSourceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["MANUAL", "RESUME_PDF", "RESUME_DOCX", "JSON_IMPORT", "NARRATIVE"]),
  displayName: z.string().min(1),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  importedAt: ISODateTimeSchema,
});

export const ProfileConflictSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  existingValue: z.unknown(),
  importedValue: z.unknown(),
  sourceId: z.string().min(1),
  createdAt: ISODateTimeSchema,
});

export const ProfileVaultSchema = z
  .object({
    vaultSchemaVersion: z.union([z.literal(1), z.literal(2)]),
    id: z.string().min(1),
    createdAt: ISODateTimeSchema,
    updatedAt: ISODateTimeSchema,
    currentProfile: CandidateProfileSchema,
    history: z.array(CandidateProfileSchema),
    sources: z.array(ProfileSourceSchema),
    conflicts: z.array(ProfileConflictSchema),
  })
  .refine(
    (vault) =>
      vault.vaultSchemaVersion === 2 ||
      (vault.currentProfile.schemaVersion === 1 &&
        vault.history.every((profile) => profile.schemaVersion === 1) &&
        vault.sources.every((source) => source.kind !== "NARRATIVE")),
    "Version 2 data requires vault version 2",
  );

export const ProfileBackupSchema = z
  .object({
    format: z.literal("job-application-copilot-profile"),
    backupVersion: z.union([z.literal(1), z.literal(2)]),
    exportedAt: ISODateTimeSchema,
    vault: ProfileVaultSchema,
  })
  .refine(
    (backup) => backup.backupVersion >= backup.vault.vaultSchemaVersion,
    "Backup version cannot omit the vault's compatibility requirement",
  );

const WorkDraftSchema = z.object({
  id: z.string().min(1),
  employer: z.string(),
  title: z.string(),
  location: z.string(),
  start: z.string(),
  end: z.string(),
  current: z.boolean(),
  description: z.string(),
});

const EducationDraftSchema = z.object({
  id: z.string().min(1),
  institution: z.string(),
  degree: z.string(),
  fieldOfStudy: z.string(),
  start: z.string(),
  end: z.string(),
  current: z.boolean(),
});

export const ResumeDraftSchema = z.object({
  identity: z
    .object({ full: z.string().min(1), given: z.string().min(1), family: z.string().nullable() })
    .optional(),
  email: z.email().optional(),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/)
    .optional(),
  portfolio: z.url().optional(),
  github: z.url().optional(),
  linkedin: z.url().optional(),
  workHistory: z.array(WorkDraftSchema).default([]),
  education: z.array(EducationDraftSchema).default([]),
  skills: z.array(z.string().min(1)).default([]),
  warnings: z.array(z.string()).default([]),
});

const WorkAuthorizationDraftSchema = z.object({
  id: z.string().min(1),
  countryCode: z.string().length(2),
  currentlyAuthorized: z.enum(["YES", "NO", "UNKNOWN"]),
  currentSponsorshipRequired: z.enum(["YES", "NO", "UNKNOWN"]),
  futureSponsorshipRequired: z.enum(["YES", "NO", "UNKNOWN"]),
});

export const ProfileDraftSchema = z.object({
  identity: z.object({
    full: z.string(),
    given: z.string(),
    family: z.string(),
  }),
  email: z.string(),
  phone: z.string(),
  portfolio: z.string(),
  github: z.string(),
  linkedin: z.string(),
  workHistory: z.array(WorkDraftSchema),
  education: z.array(EducationDraftSchema),
  skills: z.array(z.string()),
  workAuthorization: z.array(WorkAuthorizationDraftSchema),
});

const LegacyBackupSchema = z.object({
  schemaVersion: z.literal(0),
  profile: CandidateProfileSchema,
});

export type ProfileVault = z.infer<typeof ProfileVaultSchema>;
export type ProfileBackup = z.infer<typeof ProfileBackupSchema>;
export type ProfileDraft = z.infer<typeof ProfileDraftSchema>;
export type ProfileSource = z.infer<typeof ProfileSourceSchema>;
export type ProfileConflict = z.infer<typeof ProfileConflictSchema>;
export type ResumeDraft = z.infer<typeof ResumeDraftSchema>;

export const CareerSetupDraftSchema = z
  .object({
    expectedProfileVersion: z.number().int().positive(),
    identity: z
      .object({
        full: z.string().trim().min(1),
        given: z.string().trim().min(1),
        family: z.string().trim(),
      })
      .strict(),
    email: z.email(),
    phone: z.union([z.literal(""), z.string().regex(/^\+[1-9]\d{6,14}$/)]),
    preferences: CareerPreferencesSchema,
    backgroundNotes: z.string().max(20_000),
    reviewed: z.literal(true),
  })
  .strict();
export type CareerSetupDraft = z.infer<typeof CareerSetupDraftSchema>;

export function saveCareerSetup(
  vaultInput: ProfileVault,
  input: CareerSetupDraft,
  now = new Date().toISOString(),
): ProfileVault {
  const vault = ProfileVaultSchema.parse(vaultInput);
  const draft = CareerSetupDraftSchema.parse(input);
  const previous = vault.currentProfile;
  if (draft.expectedProfileVersion !== previous.profileVersion)
    throw new Error("Your profile changed in another view. Reload setup before saving.");
  if (vault.conflicts.length)
    throw new Error("Resolve your import conflicts in the full profile before saving setup.");
  const version = previous.profileVersion + 1;
  const sourceId = id("setup");
  const currentProfile = CandidateProfileSchema.parse({
    ...previous,
    schemaVersion: 2,
    profileVersion: version,
    updatedAt: now,
    identity: {
      ...previous.identity,
      legalName: fact({
        path: "identity.legalName",
        value: { ...draft.identity, family: draft.identity.family || null },
        sensitivity: "PERSONAL",
        now,
        version,
        sourceId,
      }),
    },
    contact: {
      ...previous.contact,
      emails: [
        fact({
          path: "contact.emails.0",
          value: { address: draft.email, kind: "PERSONAL", primary: true },
          sensitivity: "PERSONAL",
          now,
          version,
          sourceId,
        }),
        ...previous.contact.emails.slice(1),
      ],
      phones: draft.phone
        ? [
            fact({
              path: "contact.phones.0",
              value: { e164: draft.phone, kind: "MOBILE", primary: true },
              sensitivity: "PERSONAL",
              now,
              version,
              sourceId,
            }),
            ...previous.contact.phones.slice(1),
          ]
        : previous.contact.phones.slice(1),
    },
    careerSetup: {
      setupVersion: 1,
      preferences: draft.preferences,
      backgroundNotes: draft.backgroundNotes,
      notesUse: "CONTEXT_ONLY",
      reviewedAt: now,
      sourceIds: [sourceId],
    },
  });
  return ProfileVaultSchema.parse({
    ...vault,
    vaultSchemaVersion: 2,
    updatedAt: now,
    currentProfile,
    history: [...vault.history, previous],
    sources: [
      ...vault.sources,
      { id: sourceId, kind: "MANUAL", displayName: "Reviewed career setup", importedAt: now },
    ],
  });
}

export function careerReadiness(vault: ProfileVault): { ready: boolean; missing: string[] } {
  const profile = vault.currentProfile;
  const preferences = profile.careerSetup?.preferences;
  const missing: string[] = [];
  if (profile.identity.legalName.status !== "VERIFIED_USER") missing.push("Review your name");
  if (!profile.contact.emails.some((email) => email.status === "VERIFIED_USER" && email.value))
    missing.push("Add and review your email");
  if (!preferences?.targetRoles.length) missing.push("Choose at least one target role");
  if (!preferences?.targetLocations.length && !preferences?.workArrangements.includes("REMOTE"))
    missing.push("Choose a target location or remote work");
  if (!preferences?.workArrangements.length) missing.push("Choose your work arrangements");
  if (countFactsByStatus(profile, "VERIFIED_DOCUMENT")) missing.push("Review imported facts");
  if (vault.conflicts.length) missing.push("Resolve conflicting imported details");
  return { ready: missing.length === 0, missing };
}

type FactOptions = {
  path: string;
  value: unknown;
  sensitivity: Sensitivity;
  now: string;
  version: number;
  sourceId?: string;
  status?: FactStatus;
};

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function fact(options: FactOptions) {
  const status = options.status ?? "VERIFIED_USER";
  return {
    id: `fact:${options.path}`,
    path: options.path,
    value: options.value,
    status,
    sensitivity: options.sensitivity,
    sourceIds: [options.sourceId ?? "manual"],
    confidence: status === "VERIFIED_USER" ? 1 : 0.9,
    ...(status === "VERIFIED_USER" ? { verifiedAt: options.now } : {}),
    reuseScope: "GLOBAL" as const,
    version: options.version,
  };
}

function unknownNameFact(now: string) {
  return {
    id: "fact:identity.legalName",
    path: "identity.legalName",
    value: null,
    status: "UNKNOWN" as const,
    sensitivity: "PERSONAL" as const,
    sourceIds: ["manual"],
    confidence: 0,
    reuseScope: "GLOBAL" as const,
    version: 1,
    refreshAfter: now,
  };
}

export function createEmptyProfile(now = new Date().toISOString()): CandidateProfile {
  return CandidateProfileSchema.parse({
    schemaVersion: 1,
    id: id("profile"),
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
    identity: { legalName: unknownNameFact(now) },
    contact: { emails: [], phones: [], addresses: [] },
    links: { other: [] },
    workHistory: [],
    education: [],
    projects: [],
    publications: [],
    skills: [],
    certifications: [],
    languages: [],
    workAuthorization: [],
    compensationPreferences: [],
    jobPreferences: [],
    answerLibrary: [],
    sensitivePreferences: [],
    exclusionRules: [],
  });
}

export function createEmptyVault(now = new Date().toISOString()): ProfileVault {
  const profile = createEmptyProfile(now);
  return ProfileVaultSchema.parse({
    vaultSchemaVersion: 1,
    id: id("vault"),
    createdAt: now,
    updatedAt: now,
    currentProfile: profile,
    history: [],
    sources: [{ id: "manual", kind: "MANUAL", displayName: "Profile editor", importedAt: now }],
    conflicts: [],
  });
}

function factValue<T>(candidate: { value: T | null } | undefined, fallback: T): T {
  return candidate?.value ?? fallback;
}

export function profileToDraft(profile: CandidateProfile): ProfileDraft {
  const name = profile.identity.legalName.value;
  return ProfileDraftSchema.parse({
    identity: {
      full: name?.full ?? "",
      given: name?.given ?? "",
      family: name?.family ?? "",
    },
    email: profile.contact.emails[0]?.value?.address ?? "",
    phone: profile.contact.phones[0]?.value?.e164 ?? "",
    portfolio: profile.links.portfolio?.value ?? "",
    github: profile.links.github?.value ?? "",
    linkedin: profile.links.linkedin?.value ?? "",
    workHistory: profile.workHistory.map((work) => ({
      id: work.id,
      employer: factValue(work.employer, ""),
      title: factValue(work.title, ""),
      location: factValue(work.location, ""),
      start: work.dates.value?.start ?? "",
      end: work.dates.value?.end ?? "",
      current: work.dates.value?.current ?? false,
      description: factValue(work.description, ""),
    })),
    education: profile.education.map((education) => ({
      id: education.id,
      institution: factValue(education.institution, ""),
      degree: factValue(education.degree, ""),
      fieldOfStudy: factValue(education.fieldOfStudy, ""),
      start: education.dates?.value?.start ?? "",
      end: education.dates?.value?.end ?? "",
      current: education.dates?.value?.current ?? false,
    })),
    skills: profile.skills.flatMap((skill) => (skill.value ? [skill.value] : [])),
    workAuthorization: profile.workAuthorization.map((authorization) => ({
      id: authorization.id,
      countryCode: authorization.countryCode,
      currentlyAuthorized: factValue(authorization.currentlyAuthorized, "UNKNOWN"),
      currentSponsorshipRequired: factValue(authorization.currentSponsorshipRequired, "UNKNOWN"),
      futureSponsorshipRequired: factValue(authorization.futureSponsorshipRequired, "UNKNOWN"),
    })),
  });
}

function optionalFact(
  path: string,
  value: string,
  sensitivity: Sensitivity,
  now: string,
  version: number,
) {
  return value.trim() ? fact({ path, value: value.trim(), sensitivity, now, version }) : undefined;
}

export function saveProfileDraft(
  vaultInput: ProfileVault,
  draftInput: ProfileDraft,
  now = new Date().toISOString(),
): ProfileVault {
  const vault = ProfileVaultSchema.parse(vaultInput);
  const draft = ProfileDraftSchema.parse(draftInput);
  const previous = vault.currentProfile;
  const version = previous.profileVersion + 1;
  const fullName = draft.identity.full.trim();
  const givenName = draft.identity.given.trim();
  const familyName = draft.identity.family.trim();
  const hasName = Boolean(fullName && givenName);

  const portfolio = optionalFact("links.portfolio", draft.portfolio, "PUBLIC", now, version);
  const github = optionalFact("links.github", draft.github, "PUBLIC", now, version);
  const linkedin = optionalFact("links.linkedin", draft.linkedin, "PUBLIC", now, version);

  const candidate = {
    ...previous,
    profileVersion: version,
    updatedAt: now,
    identity: {
      ...previous.identity,
      legalName: hasName
        ? fact({
            path: "identity.legalName",
            value: { full: fullName, given: givenName, family: familyName || null },
            sensitivity: "PERSONAL",
            now,
            version,
          })
        : { ...unknownNameFact(now), version },
    },
    contact: {
      ...previous.contact,
      emails: draft.email.trim()
        ? [
            fact({
              path: "contact.emails.0",
              value: { address: draft.email.trim(), kind: "PERSONAL", primary: true },
              sensitivity: "PERSONAL",
              now,
              version,
            }),
          ]
        : [],
      phones: draft.phone.trim()
        ? [
            fact({
              path: "contact.phones.0",
              value: { e164: draft.phone.trim(), kind: "MOBILE", primary: true },
              sensitivity: "PERSONAL",
              now,
              version,
            }),
          ]
        : [],
    },
    links: {
      ...(portfolio ? { portfolio } : {}),
      ...(github ? { github } : {}),
      ...(linkedin ? { linkedin } : {}),
      other: previous.links.other,
    },
    workHistory: draft.workHistory
      .filter((work) => work.employer.trim() && work.title.trim() && work.start)
      .map((work, index) => ({
        id: work.id,
        employer: fact({
          path: `workHistory.${index}.employer`,
          value: work.employer.trim(),
          sensitivity: "PROFESSIONAL",
          now,
          version,
        }),
        title: fact({
          path: `workHistory.${index}.title`,
          value: work.title.trim(),
          sensitivity: "PROFESSIONAL",
          now,
          version,
        }),
        dates: fact({
          path: `workHistory.${index}.dates`,
          value: { start: work.start, end: work.current ? null : work.end, current: work.current },
          sensitivity: "PROFESSIONAL",
          now,
          version,
        }),
        ...(optionalFact(
          `workHistory.${index}.location`,
          work.location,
          "PROFESSIONAL",
          now,
          version,
        )
          ? {
              location: optionalFact(
                `workHistory.${index}.location`,
                work.location,
                "PROFESSIONAL",
                now,
                version,
              ),
            }
          : {}),
        ...(optionalFact(
          `workHistory.${index}.description`,
          work.description,
          "PROFESSIONAL",
          now,
          version,
        )
          ? {
              description: optionalFact(
                `workHistory.${index}.description`,
                work.description,
                "PROFESSIONAL",
                now,
                version,
              ),
            }
          : {}),
        skills: [],
      })),
    education: draft.education
      .filter((education) => education.institution.trim() && education.degree.trim())
      .map((education, index) => ({
        id: education.id,
        institution: fact({
          path: `education.${index}.institution`,
          value: education.institution.trim(),
          sensitivity: "PROFESSIONAL",
          now,
          version,
        }),
        degree: fact({
          path: `education.${index}.degree`,
          value: education.degree.trim(),
          sensitivity: "PROFESSIONAL",
          now,
          version,
        }),
        ...(optionalFact(
          `education.${index}.fieldOfStudy`,
          education.fieldOfStudy,
          "PROFESSIONAL",
          now,
          version,
        )
          ? {
              fieldOfStudy: optionalFact(
                `education.${index}.fieldOfStudy`,
                education.fieldOfStudy,
                "PROFESSIONAL",
                now,
                version,
              ),
            }
          : {}),
        ...(education.start
          ? {
              dates: fact({
                path: `education.${index}.dates`,
                value: {
                  start: education.start,
                  end: education.current ? null : education.end,
                  current: education.current,
                },
                sensitivity: "PROFESSIONAL",
                now,
                version,
              }),
            }
          : {}),
      })),
    skills: draft.skills
      .map((skill) => skill.trim())
      .filter(Boolean)
      .map((skill, index) =>
        fact({
          path: `skills.${index}`,
          value: skill,
          sensitivity: "PROFESSIONAL",
          now,
          version,
        }),
      ),
    workAuthorization: draft.workAuthorization.map((authorization, index) => ({
      id: authorization.id,
      countryCode: authorization.countryCode.toUpperCase(),
      currentlyAuthorized: fact({
        path: `workAuthorization.${index}.currentlyAuthorized`,
        value: authorization.currentlyAuthorized,
        sensitivity: "SENSITIVE",
        now,
        version,
      }),
      currentSponsorshipRequired: fact({
        path: `workAuthorization.${index}.currentSponsorshipRequired`,
        value: authorization.currentSponsorshipRequired,
        sensitivity: "SENSITIVE",
        now,
        version,
      }),
      futureSponsorshipRequired: fact({
        path: `workAuthorization.${index}.futureSponsorshipRequired`,
        value: authorization.futureSponsorshipRequired,
        sensitivity: "SENSITIVE",
        now,
        version,
      }),
    })),
  };

  const currentProfile = CandidateProfileSchema.parse(candidate);
  return ProfileVaultSchema.parse({
    ...vault,
    updatedAt: now,
    currentProfile,
    history: [...vault.history, previous],
  });
}

function sameResponseSlot(left: SavedResponse, right: SavedResponse): boolean {
  const leftQuestion = left.canonicalQuestion ?? left.normalizedQuestion;
  const rightQuestion = right.canonicalQuestion ?? right.normalizedQuestion;
  return (
    Boolean(leftQuestion) &&
    leftQuestion === rightQuestion &&
    left.reuseScope === right.reuseScope &&
    JSON.stringify(left.scopeKey ?? {}) === JSON.stringify(right.scopeKey ?? {})
  );
}

export function saveProfileResponses(
  vaultInput: ProfileVault,
  responseInputs: SavedResponse[],
  now = new Date().toISOString(),
): ProfileVault {
  const vault = ProfileVaultSchema.parse(vaultInput);
  const responses = responseInputs.map((response) => SavedResponseSchema.parse(response));
  if (!responses.length) return vault;
  const answerLibrary = [...vault.currentProfile.answerLibrary];
  for (const response of responses) {
    const index = answerLibrary.findIndex((candidate) => sameResponseSlot(candidate, response));
    if (index >= 0) answerLibrary[index] = response;
    else answerLibrary.push(response);
  }
  const previous = vault.currentProfile;
  const currentProfile = CandidateProfileSchema.parse({
    ...previous,
    profileVersion: previous.profileVersion + 1,
    updatedAt: now,
    answerLibrary,
  });
  return ProfileVaultSchema.parse({
    ...vault,
    updatedAt: now,
    currentProfile,
    history: [...vault.history, previous],
  });
}

export function exportProfileBackup(vault: ProfileVault, now = new Date().toISOString()): string {
  const backup = ProfileBackupSchema.parse({
    format: "job-application-copilot-profile",
    backupVersion: vault.vaultSchemaVersion,
    exportedAt: now,
    vault,
  });
  return JSON.stringify(backup, null, 2);
}

export function migrateStoredProfile(input: unknown, now = new Date().toISOString()): ProfileVault {
  const current = ProfileVaultSchema.safeParse(input);
  if (current.success) return current.data;

  const directProfile = CandidateProfileSchema.safeParse(input);
  if (directProfile.success) {
    return ProfileVaultSchema.parse({
      vaultSchemaVersion: directProfile.data.schemaVersion,
      id: id("vault"),
      createdAt: directProfile.data.createdAt,
      updatedAt: now,
      currentProfile: directProfile.data,
      history: [],
      sources: [
        {
          id: "local-migration",
          kind: "MANUAL",
          displayName: "Migrated local profile",
          importedAt: now,
        },
      ],
      conflicts: [],
    });
  }
  throw new Error("The stored profile uses an unsupported schema.");
}

export function importProfileBackup(input: string, now = new Date().toISOString()): ProfileVault {
  let untrusted: unknown;
  try {
    untrusted = JSON.parse(input) as unknown;
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }

  const current = ProfileBackupSchema.safeParse(untrusted);
  if (current.success) return current.data.vault;

  const legacy = LegacyBackupSchema.safeParse(untrusted);
  if (legacy.success) {
    return ProfileVaultSchema.parse({
      vaultSchemaVersion: legacy.data.profile.schemaVersion,
      id: id("vault"),
      createdAt: legacy.data.profile.createdAt,
      updatedAt: now,
      currentProfile: legacy.data.profile,
      history: [],
      sources: [
        { id: "json-import", kind: "JSON_IMPORT", displayName: "Legacy JSON", importedAt: now },
      ],
      conflicts: [],
    });
  }

  throw new Error("This profile backup is malformed or uses an unsupported version.");
}

function sameText(left: string | null | undefined, right: string | null | undefined): boolean {
  return (left ?? "").trim().toLocaleLowerCase() === (right ?? "").trim().toLocaleLowerCase();
}

function markFactPaths(
  value: unknown,
  paths: ReadonlySet<string>,
  sourceId: string,
  status: "VERIFIED_DOCUMENT" | "VERIFIED_USER",
  now: string,
  version: number,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => markFactPaths(item, paths, sourceId, status, now, version));
  }
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const updated = Object.fromEntries(
    Object.entries(record).map(([key, item]) => [
      key,
      markFactPaths(item, paths, sourceId, status, now, version),
    ]),
  );
  if (typeof record.path === "string" && paths.has(record.path)) {
    updated.status = status;
    updated.sourceIds = [sourceId];
    updated.confidence = status === "VERIFIED_USER" ? 1 : 0.9;
    updated.version = version;
    if (status === "VERIFIED_USER") updated.verifiedAt = now;
    else delete updated.verifiedAt;
  }
  return updated;
}

function documentFactSources(profile: CandidateProfile): Map<string, string> {
  const sources = new Map<string, string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (
      record.status === "VERIFIED_DOCUMENT" &&
      typeof record.path === "string" &&
      Array.isArray(record.sourceIds) &&
      typeof record.sourceIds[0] === "string"
    ) {
      sources.set(record.path, record.sourceIds[0]);
    }
    Object.values(record).forEach(visit);
  };
  visit(profile);
  return sources;
}

function conflict(
  path: string,
  existingValue: unknown,
  importedValue: unknown,
  sourceId: string,
  now: string,
): ProfileConflict {
  return ProfileConflictSchema.parse({
    id: id("conflict"),
    path,
    existingValue,
    importedValue,
    sourceId,
    createdAt: now,
  });
}

export function importResumeDraft(
  vaultInput: ProfileVault,
  resumeInput: ResumeDraft,
  sourceInput: ProfileSource,
  now = new Date().toISOString(),
): ProfileVault {
  const vault = ProfileVaultSchema.parse(vaultInput);
  const resume = ResumeDraftSchema.parse(resumeInput);
  const source = ProfileSourceSchema.parse(sourceInput);
  if (
    countFactsByStatus(vault.currentProfile, "VERIFIED_DOCUMENT") > 0 ||
    vault.conflicts.length > 0
  ) {
    throw new Error("Review the pending résumé import before importing another file.");
  }
  if (
    source.kind !== "RESUME_PDF" &&
    source.kind !== "RESUME_DOCX" &&
    source.kind !== "NARRATIVE"
  ) {
    throw new Error("A résumé import requires a PDF or DOCX source.");
  }

  const draft = profileToDraft(vault.currentProfile);
  const documentPaths = new Set<string>();
  const conflicts: ProfileConflict[] = [];
  const currentName = vault.currentProfile.identity.legalName.value;
  if (resume.identity) {
    if (!currentName) {
      draft.identity = {
        full: resume.identity.full,
        given: resume.identity.given,
        family: resume.identity.family ?? "",
      };
      documentPaths.add("identity.legalName");
    } else if (!sameText(currentName.full, resume.identity.full)) {
      conflicts.push(conflict("identity.legalName", currentName, resume.identity, source.id, now));
    }
  }

  if (resume.email) {
    if (!draft.email) {
      draft.email = resume.email;
      documentPaths.add("contact.emails.0");
    } else if (!sameText(draft.email, resume.email)) {
      conflicts.push(conflict("contact.emails.0", draft.email, resume.email, source.id, now));
    }
  }
  if (resume.phone) {
    if (!draft.phone) {
      draft.phone = resume.phone;
      documentPaths.add("contact.phones.0");
    } else if (!sameText(draft.phone, resume.phone)) {
      conflicts.push(conflict("contact.phones.0", draft.phone, resume.phone, source.id, now));
    }
  }

  for (const [path, key] of [
    ["links.portfolio", "portfolio"],
    ["links.github", "github"],
    ["links.linkedin", "linkedin"],
  ] as const) {
    const imported = resume[key];
    if (!imported) continue;
    if (!draft[key]) {
      draft[key] = imported;
      documentPaths.add(path);
    } else if (!sameText(draft[key], imported)) {
      conflicts.push(conflict(path, draft[key], imported, source.id, now));
    }
  }

  for (const work of resume.workHistory) {
    const duplicate = draft.workHistory.some(
      (existing) =>
        sameText(existing.employer, work.employer) &&
        sameText(existing.title, work.title) &&
        existing.start === work.start,
    );
    if (!duplicate) draft.workHistory.push(work);
  }
  for (const education of resume.education) {
    const duplicate = draft.education.some(
      (existing) =>
        sameText(existing.institution, education.institution) &&
        sameText(existing.degree, education.degree),
    );
    if (!duplicate) draft.education.push(education);
  }

  const existingSkills = new Set(draft.skills.map((skill) => skill.toLocaleLowerCase()));
  for (const skill of resume.skills) {
    if (!existingSkills.has(skill.toLocaleLowerCase())) {
      draft.skills.push(skill);
      existingSkills.add(skill.toLocaleLowerCase());
    }
  }

  const firstImportedWork = vault.currentProfile.workHistory.length;
  for (let index = firstImportedWork; index < draft.workHistory.length; index += 1) {
    for (const field of ["employer", "title", "location", "dates", "description"]) {
      documentPaths.add(`workHistory.${index}.${field}`);
    }
  }
  const firstImportedEducation = vault.currentProfile.education.length;
  for (let index = firstImportedEducation; index < draft.education.length; index += 1) {
    for (const field of ["institution", "degree", "fieldOfStudy", "dates"]) {
      documentPaths.add(`education.${index}.${field}`);
    }
  }
  const previousSkillCount = vault.currentProfile.skills.length;
  for (let index = previousSkillCount; index < draft.skills.length; index += 1) {
    documentPaths.add(`skills.${index}`);
  }

  const saved = saveProfileDraft(vault, draft, now);
  const markedProfile = CandidateProfileSchema.parse(
    markFactPaths(
      saved.currentProfile,
      documentPaths,
      source.id,
      "VERIFIED_DOCUMENT",
      now,
      saved.currentProfile.profileVersion,
    ),
  );
  return ProfileVaultSchema.parse({
    ...saved,
    vaultSchemaVersion: source.kind === "NARRATIVE" ? 2 : saved.vaultSchemaVersion,
    currentProfile: markedProfile,
    sources: [...saved.sources.filter((item) => item.id !== source.id), source],
    conflicts: [...saved.conflicts, ...conflicts],
  });
}

export function verifyImportedFacts(
  vaultInput: ProfileVault,
  now = new Date().toISOString(),
): ProfileVault {
  const vault = ProfileVaultSchema.parse(vaultInput);
  const paths = new Set<string>();
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record.status === "VERIFIED_DOCUMENT" && typeof record.path === "string") {
      paths.add(record.path);
    }
    Object.values(record).forEach(collect);
  };
  collect(vault.currentProfile);
  if (paths.size === 0) return vault;

  const version = vault.currentProfile.profileVersion + 1;
  const marked = markFactPaths(
    vault.currentProfile,
    paths,
    "user-review",
    "VERIFIED_USER",
    now,
    version,
  ) as CandidateProfile;
  const currentProfile = CandidateProfileSchema.parse({
    ...marked,
    profileVersion: version,
    updatedAt: now,
  });
  return ProfileVaultSchema.parse({
    ...vault,
    updatedAt: now,
    currentProfile,
    history: [...vault.history, vault.currentProfile],
  });
}

export function countFactsByStatus(profile: CandidateProfile, status: FactStatus): number {
  let count = 0;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record.status === status && typeof record.path === "string") count += 1;
    Object.values(record).forEach(visit);
  };
  visit(profile);
  return count;
}

export function resolveProfileConflict(
  vaultInput: ProfileVault,
  conflictId: string,
  resolution: "KEEP_EXISTING" | "USE_IMPORTED",
  now = new Date().toISOString(),
): ProfileVault {
  const vault = ProfileVaultSchema.parse(vaultInput);
  const selected = vault.conflicts.find((item) => item.id === conflictId);
  if (!selected) throw new Error("The selected conflict no longer exists.");
  if (resolution === "KEEP_EXISTING") {
    return ProfileVaultSchema.parse({
      ...vault,
      updatedAt: now,
      conflicts: vault.conflicts.filter((item) => item.id !== conflictId),
    });
  }

  const pendingDocumentFacts = documentFactSources(vault.currentProfile);
  const draft = profileToDraft(vault.currentProfile);
  if (selected.path === "identity.legalName") {
    const parsed = z
      .object({ full: z.string(), given: z.string(), family: z.string().nullable() })
      .parse(selected.importedValue);
    draft.identity = { ...parsed, family: parsed.family ?? "" };
  } else if (selected.path === "contact.emails.0")
    draft.email = z.email().parse(selected.importedValue);
  else if (selected.path === "contact.phones.0")
    draft.phone = z.string().parse(selected.importedValue);
  else if (selected.path === "links.portfolio")
    draft.portfolio = z.url().parse(selected.importedValue);
  else if (selected.path === "links.github") draft.github = z.url().parse(selected.importedValue);
  else if (selected.path === "links.linkedin")
    draft.linkedin = z.url().parse(selected.importedValue);
  else throw new Error("This conflict path is not supported.");

  const saved = saveProfileDraft(vault, draft, now);
  let markedProfile: unknown = saved.currentProfile;
  for (const [path, sourceId] of pendingDocumentFacts) {
    markedProfile = markFactPaths(
      markedProfile,
      new Set([path]),
      sourceId,
      "VERIFIED_DOCUMENT",
      now,
      saved.currentProfile.profileVersion,
    );
  }
  markedProfile = markFactPaths(
    markedProfile,
    new Set([selected.path]),
    selected.sourceId,
    "VERIFIED_DOCUMENT",
    now,
    saved.currentProfile.profileVersion,
  );
  const currentProfile = CandidateProfileSchema.parse(markedProfile);
  return ProfileVaultSchema.parse({
    ...saved,
    currentProfile,
    conflicts: saved.conflicts.filter((item) => item.id !== conflictId),
  });
}
