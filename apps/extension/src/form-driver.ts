import {
  FillPlanSchema,
  FillResultSchema,
  HighlightResultSchema,
  type FillPlan,
} from "@copilot/form-schema";

import { inspectVisibleForm, type SupportedControl } from "./scanner";

const USER_EDITED_ATTRIBUTE = "data-job-copilot-user-edited";
const FILLED_ATTRIBUTE = "data-job-copilot-filled";
const HIGHLIGHT_ATTRIBUTE = "data-job-copilot-highlight";
const STYLE_ID = "job-application-copilot-highlight-style";
const USER_EDIT_VERSION_ATTRIBUTE = "data-job-copilot-user-edit-version";
const trackedDocuments = new WeakSet<Document>();
const automatedControls = new WeakSet<SupportedControl>();

function isSupportedControl(value: EventTarget | null): value is SupportedControl {
  return (
    value instanceof HTMLInputElement ||
    value instanceof HTMLSelectElement ||
    value instanceof HTMLTextAreaElement
  );
}

export function installUserEditTracking(targetDocument: Document = document): void {
  if (trackedDocuments.has(targetDocument)) return;
  const markEdited = (event: Event) => {
    if (!isSupportedControl(event.target) || automatedControls.has(event.target)) return;
    event.target.setAttribute(USER_EDITED_ATTRIBUTE, "true");
    event.target.removeAttribute(FILLED_ATTRIBUTE);
    const root = event.target.ownerDocument.documentElement;
    const current = Number(root.getAttribute(USER_EDIT_VERSION_ATTRIBUTE) ?? "0");
    root.setAttribute(
      USER_EDIT_VERSION_ATTRIBUTE,
      String(Number.isFinite(current) ? current + 1 : 1),
    );
  };
  targetDocument.addEventListener("input", markEdited, true);
  targetDocument.addEventListener("change", markEdited, true);
  trackedDocuments.add(targetDocument);
}

function nativeSetter(
  control: SupportedControl,
  property: "value" | "checked",
  value: unknown,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), property);
  if (!descriptor?.set) throw new Error(`The ${property} property cannot be updated safely.`);
  descriptor.set.call(control, value);
}

function emitFrameworkEvents(control: SupportedControl): void {
  control.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  control.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

function controlHasExistingValue(control: SupportedControl): boolean {
  if (control instanceof HTMLSelectElement) return Boolean(control.value);
  if (control instanceof HTMLTextAreaElement) return Boolean(control.value.trim());
  if (control.type === "checkbox" || control.type === "radio") return control.checked;
  if (control.type === "file") return (control.files?.length ?? 0) > 0;
  return Boolean(control.value.trim());
}

function applyOperation(control: SupportedControl, item: FillPlan["items"][number]): string | null {
  if (item.operation.kind === "check") {
    if (
      !(control instanceof HTMLInputElement) ||
      (control.type !== "checkbox" && control.type !== "radio")
    ) {
      return "The reviewed check operation no longer matches this control.";
    }
    nativeSetter(control, "checked", item.operation.checked);
  } else if (item.operation.kind === "select") {
    if (!(control instanceof HTMLSelectElement)) {
      return "The reviewed select operation no longer matches this control.";
    }
    const selectedValue = item.operation.value;
    const option = Array.from(control.options).find(
      (candidate) => candidate.value === selectedValue && !candidate.disabled,
    );
    if (!option) return "The reviewed option is no longer available.";
    nativeSetter(control, "value", selectedValue);
  } else {
    if (
      control instanceof HTMLSelectElement ||
      (control instanceof HTMLInputElement && ["checkbox", "radio", "file"].includes(control.type))
    ) {
      return "The reviewed text operation no longer matches this control.";
    }
    nativeSetter(control, "value", item.operation.value);
  }

  automatedControls.add(control);
  try {
    emitFrameworkEvents(control);
  } finally {
    automatedControls.delete(control);
  }
  control.removeAttribute(USER_EDITED_ATTRIBUTE);
  control.setAttribute(FILLED_ATTRIBUTE, "true");
  return null;
}

export function applyFillPlan(untrustedPlan: FillPlan, targetDocument: Document = document) {
  installUserEditTracking(targetDocument);
  const plan = FillPlanSchema.parse(untrustedPlan);
  const { controlsByFieldId } = inspectVisibleForm(targetDocument);
  const filledFieldIds: string[] = [];
  const skipped: Array<{ fieldId: string; reason: string }> = [];

  for (const item of plan.items) {
    const control = controlsByFieldId.get(item.fieldId);
    if (!control) {
      skipped.push({ fieldId: item.fieldId, reason: "The field is no longer visible." });
      continue;
    }
    if (
      !isSupportedControl(control) ||
      ["combobox", "listbox", "checkbox", "radio"].includes(control.getAttribute("role") ?? "")
    ) {
      skipped.push({
        fieldId: item.fieldId,
        reason: "This custom ATS control requires manual completion.",
      });
      continue;
    }
    if (control.disabled || ("readOnly" in control && control.readOnly)) {
      skipped.push({ fieldId: item.fieldId, reason: "The field is disabled or read-only." });
      continue;
    }
    if (control.getAttribute(USER_EDITED_ATTRIBUTE) === "true") {
      skipped.push({ fieldId: item.fieldId, reason: "A user edit is protecting this field." });
      continue;
    }
    if (!control.hasAttribute(FILLED_ATTRIBUTE) && controlHasExistingValue(control)) {
      skipped.push({
        fieldId: item.fieldId,
        reason: "Existing application or résumé-parsed data is protecting this field.",
      });
      continue;
    }
    const error = applyOperation(control, item);
    if (error) skipped.push({ fieldId: item.fieldId, reason: error });
    else filledFieldIds.push(item.fieldId);
  }
  return FillResultSchema.parse({ analysisId: plan.analysisId, filledFieldIds, skipped });
}

export function highlightFields(fieldIds: string[], targetDocument: Document = document) {
  targetDocument.querySelectorAll(`[${HIGHLIGHT_ATTRIBUTE}]`).forEach((element) => {
    element.removeAttribute(HIGHLIGHT_ATTRIBUTE);
  });
  if (!targetDocument.getElementById(STYLE_ID)) {
    const style = targetDocument.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `[${HIGHLIGHT_ATTRIBUTE}="true"] { outline: 3px solid #2f8f55 !important; outline-offset: 3px !important; background-color: #effbf2 !important; }`;
    (targetDocument.head ?? targetDocument.documentElement).append(style);
  }
  const { controlsByFieldId } = inspectVisibleForm(targetDocument);
  const highlightedFieldIds: string[] = [];
  for (const fieldId of fieldIds) {
    const control = controlsByFieldId.get(fieldId);
    if (!control) continue;
    control.setAttribute(HIGHLIGHT_ATTRIBUTE, "true");
    highlightedFieldIds.push(fieldId);
  }
  return HighlightResultSchema.parse({ highlightedFieldIds });
}
