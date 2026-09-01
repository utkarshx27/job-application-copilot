import {
  atsFieldRule,
  compactText,
  jsonLdDescription,
  jsonLdJob,
  jsonLdLocation,
  metaContent,
  noConfirmation,
  normalizedJob,
  selectorText,
  stableJobId,
  type AtsAdapter,
} from "@copilot/ats-core";
import type { CanonicalQuestion, RawField } from "@copilot/form-schema";
import {
  AtsDetectionSchema,
  ConfirmationEvidenceSchema,
  WorkdayWorkflowPageSchema,
  type WorkdayAuthBoundary,
  type WorkdayPageType,
} from "@copilot/job-schema";

const FIRST_RECORD = String.raw`(?:0|1|\[0\]|\[1\])`;

const FIELD_RULES: Array<[RegExp, CanonicalQuestion]> = [
  [
    /\b(?:legalname|legal_name|legalnamesection)[-_]?(?:first|given)name\b/,
    "IDENTITY.legal_name.given",
  ],
  [
    /\b(?:legalname|legal_name|legalnamesection)[-_]?(?:last|family)name\b/,
    "IDENTITY.legal_name.family",
  ],
  [/(?:^| )(?:email|emailaddress|email_address)(?: |$)/, "CONTACT.email"],
  [/(?:^| )(?:phone|phonenumber|phone_number)(?: |$)/, "CONTACT.phone"],
  [/(?:^| )(?:country|countryregion|country_region)(?: |$)/, "ADDRESS.country"],
  [
    /\b(?:resume|resumeupload|resume_upload|file-upload-input-ref|fileuploadinputref)\b/,
    "APPLICATION.resume",
  ],
  [
    new RegExp(`\\bworkexperience[-_]?${FIRST_RECORD}[-_]?(?:company|employer)\\b`),
    "WORK_HISTORY.0.employer",
  ],
  [
    new RegExp(`\\bworkexperience[-_]?${FIRST_RECORD}[-_]?(?:jobtitle|job_title|title)\\b`),
    "WORK_HISTORY.0.title",
  ],
  [new RegExp(`\\bworkexperience[-_]?${FIRST_RECORD}[-_]?location\\b`), "WORK_HISTORY.0.location"],
  [
    new RegExp(`\\bworkexperience[-_]?${FIRST_RECORD}[-_]?(?:startdate|start_date)\\b`),
    "WORK_HISTORY.0.start_date",
  ],
  [
    new RegExp(`\\bworkexperience[-_]?${FIRST_RECORD}[-_]?(?:enddate|end_date)\\b`),
    "WORK_HISTORY.0.end_date",
  ],
  [
    new RegExp(`\\bworkexperience[-_]?${FIRST_RECORD}[-_]?(?:current|currentlyworkhere)\\b`),
    "WORK_HISTORY.0.current",
  ],
  [
    new RegExp(`\\bworkexperience[-_]?${FIRST_RECORD}[-_]?(?:description|roledescription)\\b`),
    "WORK_HISTORY.0.description",
  ],
  [
    new RegExp(`\\beducation[-_]?${FIRST_RECORD}[-_]?(?:school|institution|university)\\b`),
    "EDUCATION.0.institution",
  ],
  [new RegExp(`\\beducation[-_]?${FIRST_RECORD}[-_]?degree\\b`), "EDUCATION.0.degree"],
  [
    new RegExp(`\\beducation[-_]?${FIRST_RECORD}[-_]?(?:fieldofstudy|field_of_study|major)\\b`),
    "EDUCATION.0.field_of_study",
  ],
  [
    new RegExp(`\\beducation[-_]?${FIRST_RECORD}[-_]?(?:startdate|start_date)\\b`),
    "EDUCATION.0.start_date",
  ],
  [
    new RegExp(`\\beducation[-_]?${FIRST_RECORD}[-_]?(?:enddate|end_date|graduationdate)\\b`),
    "EDUCATION.0.end_date",
  ],
  [/(?:^| )(?:skill|skills|skillsummary|skill_summary)(?: |$)/, "PROFILE.skills"],
];

function hostMatches(url: URL): boolean {
  return /(^|\.)(?:myworkdayjobs|myworkdaysite)\.com$/i.test(url.hostname);
}

function tenantAndSite(targetDocument: Document, url: URL): { tenant: string; site: string } {
  const metaTenant = metaContent(targetDocument, "copilot-workday-tenant");
  const metaSite = metaContent(targetDocument, "copilot-workday-site");
  const hostTenant = url.hostname.split(".")[0] ?? "unknown-tenant";
  const segments = url.pathname.split("/").filter(Boolean);
  const recruitingIndex = segments.findIndex(
    (segment) => segment.toLocaleLowerCase() === "recruiting",
  );
  const routeSite =
    recruitingIndex >= 0
      ? segments[recruitingIndex + 2]
      : segments.find((segment, index) => index > 0 && !/^(job|apply|login)$/i.test(segment));
  return {
    tenant: compactText(metaTenant || hostTenant || "unknown-tenant"),
    site: compactText(metaSite || routeSite || "external"),
  };
}

function postingId(targetDocument: Document, url: URL): string {
  const json = jsonLdJob(targetDocument);
  const identifier =
    typeof json?.identifier === "string" ? json.identifier : compactText(json?.identifier?.value);
  const routeId = url.pathname.match(/(?:_|\/)(R-?\d{3,}|JR-?\d{3,})(?:\/|$)/i)?.[1];
  return (
    compactText(identifier) ||
    metaContent(targetDocument, "copilot-requisition-id") ||
    compactText(targetDocument.querySelector<HTMLElement>("[data-job-id]")?.dataset.jobId) ||
    compactText(routeId)
  );
}

function normalizedMachine(field: RawField): string {
  return `${field.automationId ?? ""} ${field.name} ${field.domId}`
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_[\]-]+/g, " ")
    .trim();
}

function exactButton(targetDocument: Document, label: RegExp): HTMLButtonElement | undefined {
  return Array.from(targetDocument.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
    label.test(compactText(button.textContent)),
  );
}

function pageTypeFor(targetDocument: Document, heading: string): WorkdayPageType {
  const override = metaContent(targetDocument, "copilot-workday-page").toLocaleUpperCase();
  const allowed = [
    "JOB",
    "AUTH",
    "INTRO",
    "MY_INFORMATION",
    "MY_EXPERIENCE",
    "APPLICATION_QUESTIONS",
    "VOLUNTARY_DISCLOSURES",
    "TERMS",
    "REVIEW",
    "CONFIRMATION",
    "UNKNOWN",
  ] as const;
  if (allowed.some((candidate) => candidate === override)) return override as WorkdayPageType;
  const text = `${heading} ${targetDocument.location.pathname}`.toLocaleLowerCase();
  if (/thank you|application (?:received|submitted)|confirmation/.test(text)) return "CONFIRMATION";
  if (/sign in|create account|candidate home|login/.test(text)) return "AUTH";
  if (/my information|contact information/.test(text)) return "MY_INFORMATION";
  if (/my experience|work experience|education and skills/.test(text)) return "MY_EXPERIENCE";
  if (/application questions|questionnaire/.test(text)) return "APPLICATION_QUESTIONS";
  if (/voluntary|self.identification|disclosure/.test(text)) return "VOLUNTARY_DISCLOSURES";
  if (/terms|conditions/.test(text)) return "TERMS";
  if (/review/.test(text)) return "REVIEW";
  if (/apply|application/.test(text)) return "INTRO";
  if (/job/.test(text)) return "JOB";
  return "UNKNOWN";
}

function authBoundaryFor(targetDocument: Document, pageType: WorkdayPageType): WorkdayAuthBoundary {
  const bodyText = compactText(targetDocument.body?.textContent).toLocaleLowerCase();
  if (/session (?:has )?expired|sign in again/.test(bodyText)) return "SESSION_EXPIRED";
  if (/verification code|multi.factor|two.factor/.test(bodyText)) return "VERIFICATION_REQUIRED";
  if (pageType !== "AUTH") return "NONE";
  if (/create (?:an )?account|register/.test(bodyText)) return "ACCOUNT_REQUIRED";
  if (targetDocument.querySelector("input[type='password']") || /sign in/.test(bodyText))
    return "SIGN_IN_REQUIRED";
  return "UNKNOWN";
}

function visibleSections(targetDocument: Document): string[] {
  const candidates = targetDocument.querySelectorAll<HTMLElement>(
    "[data-automation-id='sectionHeading'], main h2",
  );
  return [
    ...new Set(
      Array.from(candidates)
        .map((item) => compactText(item.textContent))
        .filter(Boolean),
    ),
  ].slice(0, 30);
}

function prefilledFieldCount(targetDocument: Document): number {
  return Array.from(
    targetDocument.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      "input, select, textarea",
    ),
  ).filter((control) => {
    if (control.disabled || control.closest("[hidden], [aria-hidden='true']")) return false;
    if (control instanceof HTMLInputElement) {
      if (["hidden", "password", "file"].includes(control.type)) return false;
      if (["checkbox", "radio"].includes(control.type)) return control.checked;
    }
    return Boolean(control.value.trim());
  }).length;
}

function fingerprint(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `workday:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function stepDetails(targetDocument: Document): {
  label?: string;
  index?: number;
  count?: number;
} {
  const steps = Array.from(
    targetDocument.querySelectorAll<HTMLElement>("[data-automation-id='progressBarStep']"),
  );
  const active =
    steps.find(
      (step) =>
        step.getAttribute("aria-current") === "step" || step.getAttribute("data-active") === "true",
    ) ?? targetDocument.querySelector<HTMLElement>("[aria-current='step']");
  const label = compactText(
    active?.getAttribute("aria-label") ||
      active?.textContent ||
      metaContent(targetDocument, "copilot-workday-step-label"),
  );
  const metaIndex = Number(metaContent(targetDocument, "copilot-workday-step-index"));
  const metaCount = Number(metaContent(targetDocument, "copilot-workday-step-count"));
  const activeIndex = active && steps.includes(active) ? steps.indexOf(active) + 1 : undefined;
  return {
    ...(label ? { label } : {}),
    ...(activeIndex || metaIndex > 0 ? { index: activeIndex ?? metaIndex } : {}),
    ...(steps.length || metaCount > 0 ? { count: steps.length || metaCount } : {}),
  };
}

function workflowError(targetDocument: Document, authBoundary: WorkdayAuthBoundary) {
  const alert = compactText(
    targetDocument.querySelector<HTMLElement>(
      "[role='alert'], [data-automation-id='errorMessage'], [data-workday-error]",
    )?.textContent,
  );
  if (authBoundary === "SESSION_EXPIRED") {
    return {
      kind: "SESSION_EXPIRED" as const,
      message: alert || "The Workday session expired. Sign in again, then rescan this page.",
      recoverable: true,
    };
  }
  if (!alert) return null;
  return { kind: "VALIDATION" as const, message: alert, recoverable: true };
}

function controlledTestNavigation(targetDocument: Document): boolean {
  const url = new URL(targetDocument.location.href);
  return (
    url.protocol === "http:" &&
    url.hostname === "127.0.0.1" &&
    url.port === "4173" &&
    url.pathname === "/workday.html"
  );
}

export const workdayAdapter: AtsAdapter = {
  id: "WORKDAY",
  version: "1",

  detect(targetDocument) {
    const url = new URL(targetDocument.location.href);
    const evidence: string[] = [];
    if (hostMatches(url)) evidence.push(`host:${url.hostname}`);
    if (metaContent(targetDocument, "copilot-ats").toLocaleLowerCase() === "workday")
      evidence.push("meta:copilot-ats=workday");
    if (
      targetDocument.querySelector(
        "[data-automation-id='jobPostingPage'], [data-automation-id='applicationPage'], [data-workday-application]",
      )
    )
      evidence.push("dom:workday-application");
    return AtsDetectionSchema.parse({
      adapter: "WORKDAY",
      adapterVersion: this.version,
      confidence: controlledTestNavigation(targetDocument)
        ? 0.999
        : evidence.some((item) => item.startsWith("host:"))
          ? 0.999
          : evidence.length
            ? 0.98
            : 0,
      supported: evidence.length > 0,
      evidence,
    });
  },

  extractJob(targetDocument, detection) {
    if (!detection.supported) return null;
    const url = new URL(targetDocument.location.href);
    const json = jsonLdJob(targetDocument);
    const title =
      compactText(json?.title) ||
      selectorText(targetDocument, [
        "[data-automation-id='jobPostingHeader'] h1",
        "[data-automation-id='jobTitle']",
        "[data-automation-id='jobPostingName']",
        "[data-job-title]",
      ]) ||
      metaContent(targetDocument, "copilot-job-title");
    const company =
      compactText(json?.hiringOrganization?.name) ||
      metaContent(targetDocument, "copilot-company") ||
      selectorText(targetDocument, ["[data-automation-id='company']", "[data-company-name]"]) ||
      metaContent(targetDocument, "og:site_name");
    if (!title || !company) return null;
    const externalRequisitionId = postingId(targetDocument, url);
    const description =
      jsonLdDescription(json) ||
      selectorText(targetDocument, [
        "[data-automation-id='jobPostingDescription']",
        "[data-job-description]",
      ]) ||
      metaContent(targetDocument, "description");
    const location =
      jsonLdLocation(json) ||
      selectorText(targetDocument, ["[data-automation-id='locations']", "[data-job-location]"]);
    const employmentType = compactText(json?.employmentType);
    return normalizedJob({
      id: stableJobId("WORKDAY", externalRequisitionId, url.href),
      ats: "WORKDAY",
      ...(externalRequisitionId ? { externalRequisitionId } : {}),
      title,
      company,
      description,
      ...(location ? { location } : {}),
      remotePolicy: /\bremote\b/i.test(location)
        ? "REMOTE"
        : /\bhybrid\b/i.test(location)
          ? "HYBRID"
          : location
            ? "ONSITE"
            : "UNKNOWN",
      ...(employmentType ? { employmentType } : {}),
      requiredSkills: [],
      preferredSkills: [],
      sourceUrl: url.href,
      applicationUrl: url.href,
      snapshotAt: new Date().toISOString(),
    });
  },

  detectConfirmation(targetDocument) {
    const container = targetDocument.querySelector(
      "[data-automation-id='applicationConfirmation'], [data-workday-confirmation='true']",
    );
    const heading = selectorText(targetDocument, [
      "[data-automation-id='applicationConfirmation'] h1",
      "[data-automation-id='applicationConfirmation'] h2",
      "[data-workday-confirmation='true'] h1",
      "[data-workday-confirmation='true'] h2",
    ]);
    const text = compactText(container?.textContent);
    if (
      !container ||
      !/thank you|application (?:was )?(?:received|submitted)/i.test(`${heading} ${text}`)
    )
      return noConfirmation();
    const referenceId = compactText(
      targetDocument.querySelector("[data-confirmation-id]")?.textContent,
    );
    return ConfirmationEvidenceSchema.parse({
      confirmed: true,
      heading: heading || "Application received",
      ...(referenceId ? { referenceId } : {}),
      evidence: ["dom:workday-confirmation"],
    });
  },

  classifyField(field) {
    const machine = normalizedMachine(field);
    const match = FIELD_RULES.find(([pattern]) => pattern.test(machine));
    return match ? atsFieldRule(field, "WORKDAY", match[1], machine) : null;
  },

  inspectWorkflow(targetDocument, detection) {
    if (!detection.supported) return null;
    const url = new URL(targetDocument.location.href);
    const { tenant, site } = tenantAndSite(targetDocument, url);
    const heading = selectorText(targetDocument, [
      "[data-automation-id='applicationPage'] h1",
      "main h1",
      "h1",
    ]);
    const pageType = pageTypeFor(targetDocument, heading);
    const authBoundary = authBoundaryFor(targetDocument, pageType);
    const step = stepDetails(targetDocument);
    const sections = visibleSections(targetDocument);
    const prefilled = prefilledFieldCount(targetDocument);
    const pageKey = `${tenant}:${site}:${pageType}:${step.label ?? "unlabelled"}`;
    const controlKeys = Array.from(
      targetDocument.querySelectorAll<HTMLElement>("input, select, textarea, [role='combobox']"),
    )
      .map(
        (control) =>
          control.getAttribute("data-automation-id") || control.getAttribute("name") || control.id,
      )
      .filter(Boolean)
      .join("|");
    const next =
      targetDocument.querySelector<HTMLButtonElement>(
        "button[data-automation-id='bottom-navigation-next-button']",
      ) ?? exactButton(targetDocument, /^next$/i);
    const back =
      targetDocument.querySelector<HTMLButtonElement>(
        "button[data-automation-id='bottom-navigation-back-button']",
      ) ?? exactButton(targetDocument, /^(back|previous)$/i);
    const submit =
      targetDocument.querySelector<HTMLButtonElement>(
        "button[data-automation-id='bottom-navigation-next-button'][data-submit='true'], button[data-automation-id='submit']",
      ) ?? exactButton(targetDocument, /^submit$/i);
    const controlledNavigation = controlledTestNavigation(targetDocument);
    const rawUserEditVersion = Number(
      targetDocument.documentElement.getAttribute("data-job-copilot-user-edit-version") ?? "0",
    );
    const userEditVersion =
      Number.isInteger(rawUserEditVersion) && rawUserEditVersion >= 0 ? rawUserEditVersion : 0;
    const exactNext = Boolean(
      next?.matches("button[data-automation-id='bottom-navigation-next-button']") &&
      compactText(next.textContent).toLocaleLowerCase() === "next" &&
      next.getAttribute("type") !== "submit" &&
      next.getAttribute("data-submit") !== "true",
    );
    const exactSubmit = Boolean(
      controlledNavigation &&
      pageType === "REVIEW" &&
      submit?.matches("button[data-automation-id='submit']") &&
      compactText(submit.textContent).toLocaleLowerCase() === "submit application" &&
      submit.getAttribute("type") !== "submit" &&
      submit.getAttribute("data-controlled-submit") === "true",
    );
    const blockedReason =
      authBoundary !== "NONE"
        ? "Complete the Workday account or authentication step manually, then rescan."
        : pageType === "UNKNOWN"
          ? "This Workday page is not recognized. Continue manually and rescan after the page changes."
          : undefined;
    return WorkdayWorkflowPageSchema.parse({
      schemaVersion: 1,
      tenant,
      site,
      pageType,
      pageKey,
      fingerprint: fingerprint(`${pageKey}:${controlKeys}`),
      heading,
      ...(step.label ? { stepLabel: step.label } : {}),
      ...(step.index ? { stepIndex: step.index } : {}),
      ...(step.count ? { stepCount: step.count } : {}),
      visibleSections: sections,
      authBoundary,
      prefilledFieldCount: prefilled,
      userEditVersion,
      resumeReconciliationRequired: pageType === "MY_EXPERIENCE" && prefilled > 0,
      navigation: {
        mode: controlledNavigation ? "CONTROLLED_TEST_ONLY" : "MANUAL_ONLY",
        backVisible: Boolean(back && !back.disabled),
        nextVisible: Boolean(next && !next.disabled && next !== submit),
        submitVisible: Boolean(submit && !submit.disabled),
        nextConfidence: controlledNavigation && exactNext ? 0.999 : 0,
        nextEvidence:
          controlledNavigation && exactNext
            ? [
                "controlled-origin:http://127.0.0.1:4173/workday.html",
                "automation-id:bottom-navigation-next-button",
                "exact-text:Next",
                "not-submit",
              ]
            : [],
        submitConfidence: exactSubmit ? 0.999 : 0,
        submitEvidence: exactSubmit
          ? [
              "controlled-origin:http://127.0.0.1:4173/workday.html",
              "review-page",
              "automation-id:submit",
              "exact-text:Submit application",
              "controlled-submit-marker",
            ]
          : [],
        ...(blockedReason ? { blockedReason } : {}),
      },
      errorState: workflowError(targetDocument, authBoundary),
    });
  },
};
