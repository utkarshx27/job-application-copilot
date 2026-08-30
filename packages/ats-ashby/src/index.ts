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
  [/_systemfield_(first_?name|given_?name)\b/, "IDENTITY.legal_name.given"],
  [/_systemfield_(last_?name|family_?name)\b/, "IDENTITY.legal_name.family"],
  [/_systemfield_(name|full_?name)\b/, "IDENTITY.legal_name.full"],
  [/_systemfield_email\b/, "CONTACT.email"],
  [/_systemfield_(phone|phone_?number)\b/, "CONTACT.phone"],
  [/_systemfield_(linkedin|linkedin_?url)\b/, "LINKS.linkedin"],
  [/_systemfield_(portfolio|website)\b/, "LINKS.portfolio"],
  [/_systemfield_(resume|cv)\b/, "APPLICATION.resume"],
  [/_systemfield_(company|employer)\b/, "WORK_HISTORY.0.employer"],
  [/_systemfield_(job_?title|current_?title)\b/, "WORK_HISTORY.0.title"],
  [/_systemfield_(school|institution|university)\b/, "EDUCATION.0.institution"],
  [/_systemfield_degree\b/, "EDUCATION.0.degree"],
];

function hostMatches(url: URL): boolean {
  return /(^|\.)jobs\.ashbyhq\.com$/i.test(url.hostname);
}

function postingId(targetDocument: Document, url: URL): string {
  const json = jsonLdJob(targetDocument);
  const identifier =
    typeof json?.identifier === "string" ? json.identifier : compactText(json?.identifier?.value);
  const uuid = url.pathname.match(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
  )?.[0];
  return (
    compactText(identifier) ||
    metaContent(targetDocument, "copilot-requisition-id") ||
    compactText(targetDocument.querySelector<HTMLElement>("[data-job-id]")?.dataset.jobId) ||
    compactText(uuid)
  );
}

export const ashbyAdapter: AtsAdapter = {
  id: "ASHBY",
  version: "1",

  detect(targetDocument) {
    const url = new URL(targetDocument.location.href);
    const evidence: string[] = [];
    if (hostMatches(url)) evidence.push(`host:${url.hostname}`);
    if (metaContent(targetDocument, "copilot-ats").toLocaleLowerCase() === "ashby")
      evidence.push("meta:copilot-ats=ashby");
    if (
      targetDocument.querySelector(
        "[data-ashby-job-posting], [data-ats='ashby'], form[data-testid='application-form']",
      )
    )
      evidence.push("dom:ashby-job-posting");
    return AtsDetectionSchema.parse({
      adapter: "ASHBY",
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
    const title =
      compactText(json?.title) || selectorText(targetDocument, ["[data-testid='job-title']", "h1"]);
    const company =
      compactText(json?.hiringOrganization?.name) ||
      metaContent(targetDocument, "copilot-company") ||
      selectorText(targetDocument, ["[data-testid='company-name']", "[data-company-name]"]) ||
      metaContent(targetDocument, "og:site_name");
    if (!title || !company) return null;
    const externalRequisitionId = postingId(targetDocument, url);
    const description =
      jsonLdDescription(json) ||
      selectorText(targetDocument, [
        "[data-testid='job-description']",
        "[data-job-description]",
        ".ashby-job-posting-description",
      ]) ||
      metaContent(targetDocument, "description");
    const location =
      jsonLdLocation(json) ||
      selectorText(targetDocument, [
        "[data-testid='job-location']",
        "[data-job-location]",
        ".ashby-job-posting-location",
      ]);
    const workplaceType = selectorText(targetDocument, [
      "[data-testid='job-workplace-type']",
      "[data-job-workplace-type]",
    ]);
    const employmentType =
      compactText(json?.employmentType) ||
      selectorText(targetDocument, ["[data-testid='job-employment-type']"]);
    return normalizedJob({
      id: stableJobId("ASHBY", externalRequisitionId, url.href),
      ats: "ASHBY",
      ...(externalRequisitionId ? { externalRequisitionId } : {}),
      title,
      company,
      description,
      ...(location ? { location } : {}),
      remotePolicy: /\bremote\b/i.test(`${location} ${workplaceType}`)
        ? "REMOTE"
        : /\bhybrid\b/i.test(workplaceType)
          ? "HYBRID"
          : /\bon.?site\b/i.test(workplaceType)
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
      ".ashby-application-confirmation, [data-testid='application-success'], [data-application-confirmation='true']",
    );
    const heading = selectorText(targetDocument, [
      ".ashby-application-confirmation h1",
      ".ashby-application-confirmation h2",
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
      evidence: ["dom:ashby-confirmation"],
    });
  },

  classifyField(field) {
    const machine = `${field.name} ${field.domId}`.toLocaleLowerCase();
    const match = FIELD_RULES.find(([pattern]) => pattern.test(machine));
    return match ? atsFieldRule(field, "ASHBY", match[1], machine) : null;
  },
};
