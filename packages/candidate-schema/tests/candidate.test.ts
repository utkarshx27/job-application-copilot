import { describe, expect, it } from "vitest";

import { CandidateProfileSchema, candidateFactSchema, PersonNameSchema } from "../src/index";

const verifiedAt = "2026-08-26T12:00:00.000Z";

function fact<T>(path: string, value: T) {
  return {
    id: `fact-${path}`,
    path,
    value,
    status: "VERIFIED_USER" as const,
    sensitivity: "PERSONAL" as const,
    sourceIds: ["manual"],
    confidence: 1,
    verifiedAt,
    reuseScope: "GLOBAL" as const,
    version: 1,
  };
}

function minimalProfile() {
  return {
    schemaVersion: 1 as const,
    id: "profile-1",
    profileVersion: 1,
    createdAt: verifiedAt,
    updatedAt: verifiedAt,
    identity: {
      legalName: fact("identity.legalName", {
        full: "Arun",
        given: "Arun",
        family: null,
      }),
    },
    contact: {
      emails: [fact("contact.emails.0", { address: "arun@example.com", primary: true })],
      phones: [fact("contact.phones.0", { e164: "+919876543210", primary: true })],
      addresses: [],
    },
    links: { other: [] },
    workHistory: [],
    education: [],
    skills: [],
    certifications: [],
    languages: [],
    workAuthorization: [],
    compensationPreferences: [],
    jobPreferences: [],
    answerLibrary: [],
    sensitivePreferences: [],
    exclusionRules: [],
  };
}

describe("CandidateProfileSchema", () => {
  it("represents a Unicode single-name candidate without inventing a surname", () => {
    const profile = minimalProfile();
    profile.identity.legalName.value = { full: "அருண்", given: "அருண்", family: null };

    expect(CandidateProfileSchema.parse(profile).identity.legalName.value?.family).toBeNull();
  });

  it("normalizes email and phone defaults", () => {
    const parsed = CandidateProfileSchema.parse(minimalProfile());

    expect(parsed.contact.emails[0]?.value?.kind).toBe("PERSONAL");
    expect(parsed.contact.phones[0]?.value?.kind).toBe("MOBILE");
  });

  it("rejects an unknown fact that carries a value", () => {
    const schema = candidateFactSchema(PersonNameSchema);
    const candidate = {
      ...fact("identity.legalName", { full: "Arun", given: "Arun", family: null }),
      status: "UNKNOWN",
    };

    expect(schema.safeParse(candidate).success).toBe(false);
  });
});
