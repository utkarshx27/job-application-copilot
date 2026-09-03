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
import type { CanonicalQuestion } from "@copilot/form-schema";
import { AtsDetectionSchema, ConfirmationEvidenceSchema } from "@copilot/job-schema";

const FIELD_RULES: Array<[RegExp, CanonicalQuestion]> = [
  [/\b(first_?name|firstname|given_?name)\b/, "IDENTITY.legal_name.given"],
  [/\b(last_?name|lastname|family_?name|surname)\b/, "IDENTITY.legal_name.family"],
  [/\b(full_?name|fullname)\b/, "IDENTITY.legal_name.full"],
  [/\b(email|email_?address)\b/, "CONTACT.email"],
  [/\b(phone|phone_?number|mobile)\b/, "CONTACT.phone"],
  [/\b(linkedin|linkedin_?url)\b/, "LINKS.linkedin"],
  [/\b(portfolio|website)\b/, "LINKS.portfolio"],
  [/\b(resume|resume_?file|cv)\b/, "APPLICATION.resume"],
  [/\b(current_?company|company_?name|employer)\b/, "WORK_HISTORY.0.employer"],
  [/\b(current_?title|job_?title|position_?title)\b/, "WORK_HISTORY.0.title"],
  [/\b(school|institution|university)\b/, "EDUCATION.0.institution"],
  [/\bdegree\b/, "EDUCATION.0.degree"],
];

function hostMatches(url: URL): boolean {
  return /(^|\.)jobs\.smartrecruiters\.com$/i.test(url.hostname);
}

function postingId(targetDocument: Document, url: URL): string {
  const json = jsonLdJob(targetDocument);
  const identifier =
    typeof json?.identifier === "string" ? json.identifier : compactText(json?.identifier?.value);
  const segments = url.pathname.split("/").filter(Boolean);
  const jobSegment = segments.findIndex((segment) => segment.toLocaleLowerCase() === "job");
  const routeId = jobSegment >= 0 ? segments[jobSegment + 1] : segments.at(-1);
  return (
    compactText(identifier) ||
    metaContent(targetDocument, "copilot-requisition-id") ||
    compactText(targetDocument.querySelector<HTMLElement>("[data-job-id]")?.dataset.jobId) ||
    compactText(routeId)
  );
}

export const smartRecruitersAdapter: AtsAdapter = {
  id: "SMARTRECRUITERS",
  version: "1",

  detect(targetDocument) {
    const url = new URL(targetDocument.location.href);
    const evidence: string[] = [];
    if (hostMatches(url)) evidence.push(`host:${url.hostname}`);
    if (metaContent(targetDocument, "copilot-ats").toLocaleLowerCase() === "smartrecruiters")
      evidence.push("meta:copilot-ats=smartrecruiters");
    if (
      targetDocument.querySelector(
        "[data-smartrecruiters-job], [data-ats='smartrecruiters'], [data-testid='smartrecruiters-job']",
      )
    )
      evidence.push("dom:smartrecruiters-job");
    return AtsDetectionSchema.parse({
      adapter: "SMARTRECRUITERS",
      adapterVersion: this.version,
      confidence: evidence.some((item) => item.startsWith("host:"))
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
    const titleParts = compactText(targetDocument.title).split(/\s+(?:-|–|—|\|)\s+/);
    const title =
      compactText(json?.title) ||
      selectorText(targetDocument, [
        "[data-testid='job-title']",
        "[data-test='job-title']",
        "[class*='job-title' i]",
        "h1",
      ]) ||
      titleParts[0];
    const company =
      compactText(json?.hiringOrganization?.name) ||
      metaContent(targetDocument, "copilot-company") ||
      selectorText(targetDocument, [
        "[data-testid='company-name']",
        "[data-company-name]",
        ".company-title",
      ]) ||
      metaContent(targetDocument, "og:site_name") ||
      titleParts[1];
    if (!title || !company) return null;
    const externalRequisitionId = postingId(targetDocument, url);
    const description =
      jsonLdDescription(json) ||
      selectorText(targetDocument, [
        "[data-testid='job-description']",
        "[data-test='job-description']",
        "[data-job-description]",
        "[itemprop='description']",
        ".job-description",
      ]) ||
      metaContent(targetDocument, "description");
    const location =
      jsonLdLocation(json) ||
      selectorText(targetDocument, [
        "[data-testid='job-location']",
        "[data-test='job-location']",
        "[data-job-location]",
        "[itemprop='jobLocation']",
        ".job-location",
      ]);
    const employmentType = compactText(json?.employmentType);
    return normalizedJob({
      id: stableJobId("SMARTRECRUITERS", externalRequisitionId, url.href),
      ats: "SMARTRECRUITERS",
      ...(externalRequisitionId ? { externalRequisitionId } : {}),
      title,
      company,
      description,
      ...(location ? { location } : {}),
      remotePolicy: /\bremote\b/i.test(location)
        ? "REMOTE"
        : /\bhybrid\b/i.test(location)
          ? "HYBRID"
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
      ".smartrecruiters-application-confirmation, [data-testid='application-success'], [data-application-confirmation='true']",
    );
    const heading = selectorText(targetDocument, [
      ".smartrecruiters-application-confirmation h1",
      ".smartrecruiters-application-confirmation h2",
      "[data-testid='application-success'] h1",
      "[data-testid='application-success'] h2",
      "[data-application-confirmation='true'] h1",
      "[data-application-confirmation='true'] h2",
    ]);
    const text = compactText(container?.textContent);
    if (
      !container ||
      !/thank you|application (was )?(received|submitted)/i.test(`${heading} ${text}`)
    )
      return noConfirmation();
    const referenceId = compactText(
      targetDocument.querySelector("[data-confirmation-id]")?.textContent,
    );
    return ConfirmationEvidenceSchema.parse({
      confirmed: true,
      heading: heading || "Application received",
      ...(referenceId ? { referenceId } : {}),
      evidence: ["dom:smartrecruiters-confirmation"],
    });
  },

  classifyField(field) {
    const label = compactText(
      [field.accessibleName, field.labelText, field.ariaLabel, field.placeholder].join(" "),
    ).toLocaleLowerCase();
    if (/^(country code|phone country code)\b/.test(label))
      return atsFieldRule(field, "SMARTRECRUITERS", "CONTACT.phone", label);
    if (/^city\b/.test(label)) return atsFieldRule(field, "SMARTRECRUITERS", "ADDRESS.city", label);
    if (/\binterest\b.*\bworking\b.*\bthere\b/.test(label))
      return atsFieldRule(field, "SMARTRECRUITERS", "ESSAY.why_company", label);
    const machine = `${field.name} ${field.domId}`.toLocaleLowerCase();
    const match = FIELD_RULES.find(([pattern]) => pattern.test(machine));
    return match ? atsFieldRule(field, "SMARTRECRUITERS", match[1], machine) : null;
  },
};
