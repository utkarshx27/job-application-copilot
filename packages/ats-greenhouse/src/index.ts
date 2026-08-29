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
import { AtsDetectionSchema, ConfirmationEvidenceSchema } from "@copilot/job-schema";
import type { CanonicalQuestion } from "@copilot/form-schema";

const FIELD_RULES: Array<[RegExp, CanonicalQuestion]> = [
  [/\bfirst.?name\b/, "IDENTITY.legal_name.given"],
  [/\blast.?name\b/, "IDENTITY.legal_name.family"],
  [/\bemail\b/, "CONTACT.email"],
  [/\bphone\b/, "CONTACT.phone"],
  [/\blinkedin\b/, "LINKS.linkedin"],
  [/\bportfolio|website\b/, "LINKS.portfolio"],
  [/\bresume|cv\b/, "APPLICATION.resume"],
  [/\bemployer|company.?name\b/, "WORK_HISTORY.0.employer"],
  [/\bjob.?title|position.?title\b/, "WORK_HISTORY.0.title"],
  [/\bschool|university|institution\b/, "EDUCATION.0.institution"],
  [/\bdegree\b/, "EDUCATION.0.degree"],
];

function hostMatches(url: URL): boolean {
  return /(^|\.)((job-)?boards)(\.eu)?\.greenhouse\.io$/i.test(url.hostname);
}

function externalId(targetDocument: Document, url: URL): string {
  const json = jsonLdJob(targetDocument);
  const identifier =
    typeof json?.identifier === "string" ? json.identifier : compactText(json?.identifier?.value);
  return (
    compactText(identifier) ||
    metaContent(targetDocument, "copilot-requisition-id") ||
    compactText(new URLSearchParams(url.search).get("gh_jid")) ||
    compactText(targetDocument.querySelector<HTMLElement>("[data-job-id]")?.dataset.jobId)
  );
}

export const greenhouseAdapter: AtsAdapter = {
  id: "GREENHOUSE",
  version: "1",

  detect(targetDocument) {
    const url = new URL(targetDocument.location.href);
    const evidence: string[] = [];
    if (hostMatches(url)) evidence.push(`host:${url.hostname}`);
    if (metaContent(targetDocument, "copilot-ats").toLocaleLowerCase() === "greenhouse")
      evidence.push("meta:copilot-ats=greenhouse");
    if (targetDocument.querySelector("#application_form, [data-ats='greenhouse']"))
      evidence.push("dom:greenhouse-application");
    return AtsDetectionSchema.parse({
      adapter: "GREENHOUSE",
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
    const title = compactText(json?.title) || selectorText(targetDocument, ["h1.app-title", "h1"]);
    const company =
      compactText(json?.hiringOrganization?.name) ||
      metaContent(targetDocument, "copilot-company") ||
      selectorText(targetDocument, [".company-name", "[data-company-name]"]);
    if (!title || !company) return null;
    const requisitionId = externalId(targetDocument, url);
    const description =
      jsonLdDescription(json) ||
      selectorText(targetDocument, ["#content", "[data-job-description]"]) ||
      metaContent(targetDocument, "description");
    const location =
      jsonLdLocation(json) || selectorText(targetDocument, [".location", "[data-job-location]"]);
    return normalizedJob({
      id: stableJobId("GREENHOUSE", requisitionId, url.href),
      ats: "GREENHOUSE",
      ...(requisitionId ? { externalRequisitionId: requisitionId } : {}),
      title,
      company,
      description,
      ...(location ? { location } : {}),
      remotePolicy: /\bremote\b/i.test(location) ? "REMOTE" : "UNKNOWN",
      ...(compactText(json?.employmentType)
        ? { employmentType: compactText(json?.employmentType) }
        : {}),
      requiredSkills: [],
      preferredSkills: [],
      sourceUrl: url.href,
      applicationUrl: url.href,
      snapshotAt: new Date().toISOString(),
    });
  },

  detectConfirmation(targetDocument) {
    const container = targetDocument.querySelector(
      ".application-confirmation, [data-application-confirmation='true']",
    );
    const heading = selectorText(targetDocument, [
      ".application-confirmation h1",
      ".application-confirmation h2",
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
      evidence: ["dom:greenhouse-confirmation"],
    });
  },

  classifyField(field) {
    const machine = `${field.name} ${field.domId}`.toLocaleLowerCase();
    const match = FIELD_RULES.find(([pattern]) => pattern.test(machine));
    return match ? atsFieldRule(field, "GREENHOUSE", match[1], machine) : null;
  },
};
