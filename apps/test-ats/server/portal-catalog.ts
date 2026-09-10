import type {
  CompanyEvidence,
  PortalField,
  PortalListing,
  PublicScenario,
} from "../src/portal-contract";

// Runner/server data: this module must never be bundled into the public directory.
export const SYNTHETIC_CANDIDATE = {
  name: "Priya Sharma",
  email: "priya@example.test",
  phone: "+919876543210",
  currentLocation: "Bengaluru",
  workArrangement: "Remote",
  experienceMonths: "36",
  noticeDays: "30",
  currentSalary: "900000",
  expectedSalary: "1500000",
  currency: "INR",
  salaryPeriod: "Year",
  motivation: "I enjoy building accessible developer tools.",
  equity: "Open to discussion",
  employer: "Example Labs",
  previousEmployer: "Earlier Labs",
};
export const SYNTHETIC_RESUME =
  "Synthetic resume: Priya Sharma; Example Labs; 36 months of experience.";
type Fault =
  | "NONE"
  | "VALIDATION"
  | "MISSING_ANSWER"
  | "LOST_RESPONSE"
  | "FALSE_CONFIRMATION"
  | "WRONG_CONFIRMATION"
  | "CLOSED_TAB"
  | "EXTERNAL_HANDOFF"
  | "DUPLICATE"
  | "SESSION_EXPIRED";
export type Scenario = PublicScenario & { fault: Fault; publicId: string };
const base: PortalField[] = [
  { key: "name", label: "Full name", kind: "text", required: true },
  { key: "email", label: "Email", kind: "email", required: true },
  { key: "phone", label: "Phone number", kind: "text", required: true },
  { key: "currentLocation", label: "Current city", kind: "text", required: true },
  {
    key: "workArrangement",
    label: "Work arrangement",
    kind: "select",
    required: true,
    options: ["Remote", "Hybrid", "On-site"],
  },
];
const screen: PortalField[] = [
  { key: "experienceMonths", label: "Total experience in months", kind: "number", required: true },
  { key: "noticeDays", label: "Notice period in days", kind: "number", required: true },
  { key: "currentSalary", label: "Current compensation", kind: "number", required: true },
  { key: "expectedSalary", label: "Expected compensation", kind: "number", required: true },
  {
    key: "currency",
    label: "Compensation currency",
    kind: "select",
    required: true,
    options: ["INR", "USD", "EUR"],
  },
  {
    key: "salaryPeriod",
    label: "Compensation period",
    kind: "select",
    required: true,
    options: ["Year", "Month", "Hour"],
  },
];

export function portalScenarios(seed = 7): Scenario[] {
  const make = (id: string, family: string, changes: Partial<Scenario> = {}): Scenario => ({
    id,
    publicId: "",
    family,
    title: `${family} application demo`,
    mode: "NATIVE",
    fields: structuredClone(base),
    modal: false,
    repeatHistory: false,
    delayMs: 0,
    replaceOnFocus: false,
    evidenceOnly: false,
    applicationAvailable: true,
    access: "AVAILABLE",
    fault: "NONE",
    seed,
    ...changes,
  });
  return [
    make("greenhouse-native", "Greenhouse"),
    make("lever-upload", "Lever", {
      fields: [...base, { key: "resume", label: "Resume document", kind: "file", required: true }],
    }),
    make("ashby-labels", "Ashby", { mode: "LABELLED" }),
    make("smartrecruiters-shadow", "SmartRecruiters", { mode: "SHADOW" }),
    make("workday-steps", "Workday", { mode: "FRAME", fields: [...base, ...screen] }),
    make("icims-nested-frame", "iCIMS", { mode: "NESTED_FRAME" }),
    make("taleo-validation", "Taleo", { fault: "VALIDATION" }),
    make("workable-history", "Workable", { repeatHistory: true }),
    make("bamboohr-renamed", "BambooHR", { mode: "LABELLED", replaceOnFocus: true }),
    make("jobvite-combobox", "Jobvite", { mode: "COMBOBOX" }),
    make("comeet-shadow", "Comeet", { mode: "SHADOW", delayMs: 200 }),
    make("linkedin-modal", "LinkedIn", { modal: true, repeatHistory: true }),
    make("naukri-screening", "Naukri", { modal: true, fields: [...base, ...screen] }),
    make("wellfound-startup", "Wellfound", {
      fields: [
        ...base,
        {
          key: "motivation",
          label: "Why are you interested in this startup?",
          kind: "text",
          required: true,
        },
        { key: "equity", label: "Equity expectations", kind: "text", required: true },
      ],
    }),
    make("indeed-dialog", "Indeed", { modal: true, mode: "COMBOBOX" }),
    make("glassdoor-evidence", "Glassdoor", { evidenceOnly: true }),
    make("generic-delayed", "Generic", { delayMs: 500 }),
    make("generic-stale", "Generic", { replaceOnFocus: true }),
    make("generic-challenge", "Generic", { access: "CHALLENGE_PRESENT" }),
    make("generic-session", "Generic", { access: "LOGIN_REQUIRED" }),
    make("generic-missing-answer", "Generic", {
      fault: "MISSING_ANSWER",
      fields: [
        ...base,
        {
          key: "clearance",
          label: "Active security clearance identifier",
          kind: "text",
          required: true,
        },
      ],
    }),
    make("generic-lost-response", "Generic", { fault: "LOST_RESPONSE" }),
    make("generic-false-confirmation", "Generic", { fault: "FALSE_CONFIRMATION" }),
    make("generic-wrong-confirmation", "Generic", { fault: "WRONG_CONFIRMATION" }),
    make("generic-closed-shadow", "Generic", { mode: "CLOSED_SHADOW" }),
    make("generic-external-handoff", "Generic", { fault: "EXTERNAL_HANDOFF" }),
    make("generic-closed-tab", "Generic", { fault: "CLOSED_TAB", delayMs: 400 }),
    make("generic-duplicate", "Generic", { fault: "DUPLICATE" }),
    make("generic-expired-step", "Generic", { fault: "SESSION_EXPIRED" }),
    make("complete-native", "Complete local", {
      fields: [
        ...base,
        ...screen,
        { key: "resume", label: "Resume document", kind: "file", required: true },
      ],
    }),
    make("complete-renamed", "Complete local renamed", {
      mode: "LABELLED",
      fields: [
        ...base,
        ...screen.map((field) =>
          field.key === "currentSalary" ? { ...field, label: "Annual earnings" } : field,
        ),
        { key: "resume", label: "Resume document", kind: "file", required: true },
      ],
    }),
    make("complete-lost-response", "Complete local recovery", { fault: "LOST_RESPONSE" }),
    make("complete-false-confirmation", "Complete local verification", {
      fault: "FALSE_CONFIRMATION",
    }),
    make("complete-wrong-confirmation", "Complete local receipt", { fault: "WRONG_CONFIRMATION" }),
  ].map((scenario, index) => ({
    ...scenario,
    publicId: `portal-${String(index + 1).padStart(2, "0")}`,
  }));
}
export function publicScenario(scenario: Scenario): PublicScenario {
  return {
    id: scenario.publicId,
    family: scenario.family,
    title: scenario.title,
    mode: scenario.mode,
    fields: scenario.fields,
    modal: scenario.modal,
    repeatHistory: scenario.repeatHistory,
    delayMs: scenario.delayMs,
    replaceOnFocus: scenario.replaceOnFocus,
    evidenceOnly: scenario.evidenceOnly,
    access: scenario.access,
    seed: scenario.seed,
    applicationAvailable: scenario.fault !== "EXTERNAL_HANDOFF",
  };
}
export function listings(seed = 7): PortalListing[] {
  const jobs = Array.from({ length: 14 }, (_, index) => ({
    id: `job-${seed}-${index === 5 ? 0 : index}`,
    title: index % 2 ? "Frontend Engineer" : "Platform Engineer",
    companyId: index % 2 ? "company-b" : "company-a",
    company: "Example Labs",
    location: index % 2 ? "London" : "Bengaluru",
    destination:
      index === 7
        ? null
        : `/portal.html?scenario=portal-${index < 8 ? "01" : index === 13 ? "31" : String(index + 22)}&jobId=job-${seed}-${index === 5 ? 0 : index}`,
    expired: index === 6,
    salary: index % 3 ? { amount: 1_500_000, currency: "INR", period: "YEAR" } : null,
  }));
  if (jobs[0]) jobs[5] = { ...jobs[0] };
  return jobs;
}
export const companies: CompanyEvidence[] = [
  {
    id: "company-a",
    name: "Example Labs",
    location: "Bengaluru",
    demo: true,
    ratings: [
      {
        source: "Synthetic employee reviews",
        value: 4.2,
        scale: 5,
        count: 140,
        retrievedAt: "2026-09-01",
      },
      {
        source: "Synthetic workplace survey",
        value: 2.8,
        scale: 5,
        count: 3,
        retrievedAt: "2024-01-01",
      },
    ],
  },
  {
    id: "company-b",
    name: "Example Labs",
    location: "London",
    demo: true,
    ratings: [
      {
        source: "Synthetic employee reviews",
        value: null,
        scale: 5,
        count: 0,
        retrievedAt: "2026-09-01",
      },
    ],
  },
];
