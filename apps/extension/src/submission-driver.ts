import {
  ControlledSubmitClickResultSchema,
  ControlledSubmitPlanSchema,
  isControlledSubmissionUrl,
  type ControlledSubmitPlan,
} from "@copilot/submission-core";

import { inspectApplicationPage } from "./ats-page";
import { isInspectable } from "./scanner";

const SUBMITTED_INTENT_ATTRIBUTE = "data-job-copilot-submit-intent";
const SUBMIT_SELECTOR = "button[data-automation-id='submit'][data-controlled-submit='true']";

function text(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function requiredResolved(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
): boolean {
  if (!control.required || control.disabled) return true;
  if (!control.checkValidity()) return false;
  if (control instanceof HTMLInputElement && control.type === "checkbox") return control.checked;
  if (control instanceof HTMLInputElement && control.type === "radio") {
    return Array.from(
      control.ownerDocument.querySelectorAll<HTMLInputElement>("input[type='radio']"),
    )
      .filter((candidate) => candidate.name === control.name)
      .some((candidate) => candidate.checked);
  }
  return Boolean(control.value.trim());
}

function executionBlock(targetDocument: Document): string | null {
  const controls = Array.from(
    targetDocument.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      "input, select, textarea",
    ),
  ).filter(isInspectable);
  if (controls.some((control) => !requiredResolved(control))) {
    return "A visible required review control is incomplete or invalid.";
  }
  if (
    Array.from(targetDocument.querySelectorAll<HTMLElement>("[aria-invalid='true']")).some(
      isInspectable,
    )
  ) {
    return "A visible review control reports a validation error.";
  }
  if (
    Array.from(targetDocument.querySelectorAll<HTMLElement>("[role='alert']")).some(
      (candidate) => isInspectable(candidate) && Boolean(text(candidate.textContent)),
    )
  ) {
    return "The review page contains a visible validation alert.";
  }
  const humanGate = targetDocument.querySelector<HTMLElement>(
    "input[type='password'], iframe[src*='captcha' i], [data-captcha], [class*='captcha' i], [data-assessment]",
  );
  if (humanGate && isInspectable(humanGate)) return "A human-only gate blocks submission.";
  return null;
}

export function executeControlledSubmit(
  planInput: ControlledSubmitPlan,
  targetDocument: Document = document,
) {
  const plan = ControlledSubmitPlanSchema.parse(planInput);
  if (Date.parse(plan.expiresAt) <= Date.now()) throw new Error("The submission intent expired.");
  if (!isControlledSubmissionUrl(targetDocument.location.href)) {
    throw new Error("Controlled submission is not allowed on this origin.");
  }
  if (targetDocument.location.href !== plan.sourceUrl) {
    throw new Error("The review URL changed after submission approval.");
  }
  if (targetDocument.documentElement.getAttribute(SUBMITTED_INTENT_ATTRIBUTE) === plan.intentId) {
    throw new Error("This submission intent was already dispatched.");
  }

  const report = inspectApplicationPage(targetDocument).atsReport;
  const workflow = report.workflow;
  if (
    report.detection.adapter !== "WORKDAY" ||
    report.detection.adapterVersion !== plan.adapterVersion ||
    !workflow ||
    workflow.pageType !== "REVIEW" ||
    workflow.pageKey !== plan.sourcePageKey ||
    workflow.fingerprint !== plan.sourceFingerprint ||
    workflow.userEditVersion !== plan.sourceUserEditVersion ||
    workflow.navigation.mode !== "CONTROLLED_TEST_ONLY" ||
    workflow.navigation.submitConfidence < 0.995 ||
    workflow.authBoundary !== "NONE" ||
    workflow.errorState ||
    workflow.navigation.nextVisible ||
    !workflow.navigation.submitVisible
  ) {
    throw new Error("The controlled review page changed after final approval.");
  }
  const block = executionBlock(targetDocument);
  if (block) throw new Error(block);

  const candidates = Array.from(
    targetDocument.querySelectorAll<HTMLButtonElement>(SUBMIT_SELECTOR),
  ).filter(isInspectable);
  if (candidates.length !== 1) throw new Error("The exact Test ATS Submit control is not unique.");
  const submit = candidates[0]!;
  if (
    submit.disabled ||
    submit.getAttribute("aria-disabled") === "true" ||
    submit.type === "submit" ||
    text(submit.textContent).toLocaleLowerCase() !== "submit application"
  ) {
    throw new Error("The approved Test ATS Submit control is no longer safe.");
  }

  targetDocument.documentElement.setAttribute(SUBMITTED_INTENT_ATTRIBUTE, plan.intentId);
  submit.click();
  return ControlledSubmitClickResultSchema.parse({
    intentId: plan.intentId,
    clicked: true,
    sourcePageKey: plan.sourcePageKey,
    sourceFingerprint: plan.sourceFingerprint,
  });
}
