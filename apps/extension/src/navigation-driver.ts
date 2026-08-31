import {
  ControlledNextClickResultSchema,
  ControlledNextPlanSchema,
  isControlledAutoNextUrl,
  type ControlledNextPlan,
} from "@copilot/navigation-core";

import { inspectApplicationPage } from "./ats-page";
import { isInspectable } from "./scanner";

const CLICKED_INTENT_ATTRIBUTE = "data-job-copilot-next-intent";
const NEXT_SELECTOR = "button[data-automation-id='bottom-navigation-next-button']";

function text(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function nativeRequiredResolved(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
) {
  if (!control.required || control.disabled) return true;
  if (!control.checkValidity()) return false;
  if (control instanceof HTMLSelectElement) return Boolean(control.value);
  if (control instanceof HTMLTextAreaElement) return Boolean(control.value.trim());
  if (control.type === "checkbox") return control.checked;
  if (control.type === "radio") {
    if (!control.name) return control.checked;
    return Array.from(
      control.ownerDocument.querySelectorAll<HTMLInputElement>("input[type='radio']"),
    )
      .filter((candidate) => candidate.name === control.name)
      .some((candidate) => candidate.checked);
  }
  if (control.type === "file") return (control.files?.length ?? 0) > 0;
  return Boolean(control.value.trim());
}

function visibleValidationFailure(targetDocument: Document): string | null {
  const controls = Array.from(
    targetDocument.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      "input, select, textarea",
    ),
  ).filter(isInspectable);
  if (controls.some((control) => !nativeRequiredResolved(control))) {
    return "A visible required field is empty or invalid.";
  }
  const ariaInvalid = Array.from(
    targetDocument.querySelectorAll<HTMLElement>("[aria-invalid='true']"),
  ).find(isInspectable);
  if (ariaInvalid) return "A visible field reports an ARIA validation error.";
  const alert = Array.from(targetDocument.querySelectorAll<HTMLElement>("[role='alert']")).find(
    (candidate) => isInspectable(candidate) && Boolean(text(candidate.textContent)),
  );
  if (alert) return "The page contains a visible validation alert.";
  return null;
}

function humanGate(targetDocument: Document): string | null {
  const password = Array.from(
    targetDocument.querySelectorAll<HTMLInputElement>("input[type='password']"),
  ).find(isInspectable);
  if (password) return "Authentication must be completed manually.";
  const captcha = targetDocument.querySelector<HTMLElement>(
    "iframe[src*='captcha' i], [data-captcha], [class*='captcha' i]",
  );
  if (captcha && isInspectable(captcha)) return "A CAPTCHA requires manual completion.";
  const assessment = targetDocument.querySelector<HTMLElement>(
    "[data-automation-id*='assessment' i], [data-assessment]",
  );
  if (assessment && isInspectable(assessment)) return "An assessment requires manual completion.";
  return null;
}

export function executeControlledNext(
  planInput: ControlledNextPlan,
  targetDocument: Document = document,
) {
  const plan = ControlledNextPlanSchema.parse(planInput);
  if (Date.parse(plan.expiresAt) <= Date.now()) throw new Error("The navigation intent expired.");
  if (!isControlledAutoNextUrl(targetDocument.location.href)) {
    throw new Error("Controlled auto-next is not allowed on this origin.");
  }
  if (targetDocument.location.href !== plan.sourceUrl) {
    throw new Error("The page URL changed after navigation approval.");
  }
  if (targetDocument.documentElement.getAttribute(CLICKED_INTENT_ATTRIBUTE) === plan.intentId) {
    throw new Error("A navigation intent was already dispatched on this document.");
  }

  const report = inspectApplicationPage(targetDocument).atsReport;
  const workflow = report.workflow;
  if (
    report.detection.adapter !== "WORKDAY" ||
    report.detection.adapterVersion !== plan.adapterVersion ||
    !workflow ||
    workflow.pageKey !== plan.sourcePageKey ||
    workflow.fingerprint !== plan.sourceFingerprint ||
    workflow.userEditVersion !== plan.sourceUserEditVersion
  ) {
    throw new Error("The Workday page changed after navigation approval.");
  }
  if (
    workflow.navigation.mode !== "CONTROLLED_TEST_ONLY" ||
    workflow.authBoundary !== "NONE" ||
    workflow.errorState ||
    workflow.resumeReconciliationRequired ||
    !workflow.navigation.nextVisible ||
    workflow.navigation.submitVisible
  ) {
    throw new Error("The current Workday step requires manual navigation.");
  }
  const validationFailure = visibleValidationFailure(targetDocument) ?? humanGate(targetDocument);
  if (validationFailure) throw new Error(validationFailure);

  const candidates = Array.from(
    targetDocument.querySelectorAll<HTMLButtonElement>(NEXT_SELECTOR),
  ).filter(isInspectable);
  if (candidates.length !== 1) throw new Error("The exact Workday Next control is not unique.");
  const next = candidates[0]!;
  if (
    next.disabled ||
    next.getAttribute("aria-disabled") === "true" ||
    next.type === "submit" ||
    next.getAttribute("data-submit") === "true" ||
    text(next.textContent).toLocaleLowerCase() !== "next"
  ) {
    throw new Error("The approved navigation control is not a safe enabled Next button.");
  }

  targetDocument.documentElement.setAttribute(CLICKED_INTENT_ATTRIBUTE, plan.intentId);
  next.click();
  const observed = inspectApplicationPage(targetDocument).atsReport.workflow;
  return ControlledNextClickResultSchema.parse({
    intentId: plan.intentId,
    clicked: true,
    sourcePageKey: plan.sourcePageKey,
    sourceFingerprint: plan.sourceFingerprint,
    observedPageKey: observed?.pageKey ?? plan.sourcePageKey,
    observedFingerprint: observed?.fingerprint ?? plan.sourceFingerprint,
  });
}
