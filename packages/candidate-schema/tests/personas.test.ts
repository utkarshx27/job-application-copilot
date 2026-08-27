import { describe, expect, it } from "vitest";

import { CandidateProfileSchema, type Sensitivity } from "../src/index";
import type { z } from "zod";

const now = "2026-08-27T10:00:00.000Z";

function fact<T>(path: string, value: T, sensitivity: Sensitivity = "PROFESSIONAL") {
  return {
    id: `fact:${path}`,
    path,
    value,
    status: "VERIFIED_USER" as const,
    sensitivity,
    sourceIds: ["persona-fixture"],
    confidence: 1,
    verifiedAt: now,
    reuseScope: "GLOBAL" as const,
    version: 1,
  };
}

function baseProfile(id: string): z.input<typeof CandidateProfileSchema> {
  return {
    schemaVersion: 1,
    id,
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
    identity: {
      legalName: fact("identity.legalName", { full: id, given: id, family: null }, "PERSONAL"),
    },
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
  };
}

function work(id: string, start: string, end: string | null) {
  return {
    id,
    employer: fact(`workHistory.${id}.employer`, "Example Employer"),
    title: fact(`workHistory.${id}.title`, "Engineer"),
    dates: fact(`workHistory.${id}.dates`, { start, end, current: end === null }),
    skills: [],
  };
}

function authorization(id: string, current: "YES" | "NO", future: "YES" | "NO") {
  return {
    id,
    countryCode: "US",
    currentlyAuthorized: fact(`workAuthorization.${id}.currentlyAuthorized`, current, "SENSITIVE"),
    currentSponsorshipRequired: fact(
      `workAuthorization.${id}.currentSponsorshipRequired`,
      future,
      "SENSITIVE",
    ),
    futureSponsorshipRequired: fact(
      `workAuthorization.${id}.futureSponsorshipRequired`,
      future,
      "SENSITIVE",
    ),
  };
}

describe("Phase 1 synthetic personas", () => {
  it("represents all twelve blueprint personas with explicit facts", () => {
    const p01 = baseProfile("P01");
    p01.workHistory = [work("one", "2018-01-01", "2020-12-31"), work("two", "2021-01-01", null)];
    p01.compensationPreferences = [fact("compensationPreferences.0", "USD 150000 annual minimum")];

    const p02 = baseProfile("P02");
    p02.workAuthorization = [
      {
        ...authorization("opt", "YES", "YES"),
        visaType: fact("workAuthorization.opt.visaType", "F-1 OPT", "SENSITIVE"),
        visaExpiration: fact("workAuthorization.opt.visaExpiration", "2027-06-30", "SENSITIVE"),
      },
    ];
    p02.relocationPreferences = fact("relocationPreferences", "Conditional");

    const p03 = baseProfile("P03");
    p03.workAuthorization = [authorization("h1b", "YES", "YES")];

    const p04 = baseProfile("P04");
    p04.compensationPreferences = [
      fact("compensationPreferences.0", "INR current and expected CTC"),
    ];
    p04.availability = fact("availability", "60-day notice period");

    const p05 = baseProfile("P05");
    p05.languages = [fact("languages.0", "French"), fact("languages.1", "German")];
    p05.answerLibrary = [
      {
        id: "gdpr",
        canonicalQuestion: "GDPR consent",
        keywords: ["gdpr"],
        answer: true,
        source: "USER_CONFIRMED",
        sensitivity: "SENSITIVE",
        reuseScope: "GLOBAL",
        createdAt: now,
        verifiedAt: now,
      },
    ];

    const p06 = baseProfile("P06");
    p06.projects = [fact("projects.0", "Accessible capstone application")];
    p06.education = [
      {
        id: "degree",
        institution: fact("education.degree.institution", "Example University"),
        degree: fact("education.degree.degree", "BSc"),
        gpa: fact("education.degree.gpa", "3.8 / 4.0"),
        dates: fact("education.degree.dates", { start: "2022-08-01", end: null, current: true }),
      },
    ];

    const p07 = baseProfile("P07");
    p07.workHistory = [work("past", "2018-01-01", "2021-01-01")];
    p07.sensitivePreferences = [
      fact("sensitivePreferences.0", "Career-gap explanation", "SENSITIVE"),
    ];

    const p08 = baseProfile("P08");
    p08.identity.legalName = fact(
      "identity.legalName",
      { full: "Arun", given: "Arun", family: null },
      "PERSONAL",
    );

    const p09 = baseProfile("P09");
    p09.education = [
      {
        id: "bsc",
        institution: fact("education.bsc.institution", "Example University"),
        degree: fact("education.bsc.degree", "BSc"),
      },
      {
        id: "msc",
        institution: fact("education.msc.institution", "Example Institute"),
        degree: fact("education.msc.degree", "MSc"),
      },
      {
        id: "phd",
        institution: fact("education.phd.institution", "Example College"),
        degree: fact("education.phd.degree", "PhD"),
        dates: fact("education.phd.dates", { start: "2024-01-01", end: null, current: true }),
      },
    ];
    p09.publications = [fact("publications.0", "Synthetic research publication")];

    const p10 = baseProfile("P10");
    p10.skills = [fact("skills.0", "Transferable stakeholder communication")];

    const p11 = baseProfile("P11");
    p11.workHistory = [
      work("overlap-a", "2020-01-01", "2022-12-31"),
      work("overlap-b", "2021-01-01", "2023-12-31"),
    ];

    const p12 = baseProfile("P12");
    p12.identity.preferredName = fact(
      "identity.preferredName",
      { full: "Zoë 李", given: "Zoë", family: "李" },
      "PERSONAL",
    );
    p12.skills = [fact("skills.0", "Screen-reader accessibility")];

    const parsed = [p01, p02, p03, p04, p05, p06, p07, p08, p09, p10, p11, p12].map((persona) =>
      CandidateProfileSchema.parse(persona),
    );
    expect(parsed).toHaveLength(12);
    expect(parsed[8]?.publications).toHaveLength(1);
    expect(parsed[5]?.education[0]?.gpa?.value).toBe("3.8 / 4.0");
  });
});
