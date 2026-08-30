import { PageSnapshotSchema, type PageSnapshot, type RawField } from "@copilot/form-schema";

const SUPPORTED_INPUT_TYPES = new Set([
  "text",
  "email",
  "tel",
  "url",
  "number",
  "date",
  "month",
  "radio",
  "checkbox",
  "file",
]);

export type SupportedControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
export type InspectableControl = HTMLElement;

export function isSupportedControl(control: InspectableControl): control is SupportedControl {
  return (
    control instanceof HTMLInputElement ||
    control instanceof HTMLSelectElement ||
    control instanceof HTMLTextAreaElement
  );
}

function text(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function isInspectable(control: InspectableControl): boolean {
  if (control instanceof HTMLInputElement) {
    if (control.type === "password" || control.type === "hidden") return false;
    if (!SUPPORTED_INPUT_TYPES.has(control.type)) return false;
  }

  if (control.hidden || control.closest("[hidden], [aria-hidden='true']")) return false;
  const style = window.getComputedStyle(control);
  return style.display !== "none" && style.visibility !== "hidden";
}

function referencedText(control: InspectableControl, attribute: string): string {
  return text(
    control
      .getAttribute(attribute)
      ?.split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" "),
  );
}

function labelText(control: InspectableControl): string {
  const nativeLabels = isSupportedControl(control) ? Array.from(control.labels ?? []) : [];
  const labels = nativeLabels.map((label) => label.textContent ?? "").join(" ");
  return text(labels || control.closest("label")?.textContent);
}

function accessibleName(control: InspectableControl): string {
  return (
    text(control.getAttribute("aria-label")) ||
    referencedText(control, "aria-labelledby") ||
    labelText(control) ||
    text(control.getAttribute("placeholder")) ||
    text(control.getAttribute("name")) ||
    text(control.id)
  );
}

function groupLabel(control: InspectableControl): string {
  const fieldset = control.closest("fieldset");
  const legend = text(fieldset?.querySelector("legend")?.textContent);
  if (legend) return legend;

  const applicationQuestion = control.closest(".application-question");
  if (!applicationQuestion) return "";
  const context = applicationQuestion.cloneNode(true) as HTMLElement;
  context
    .querySelectorAll(".application-field, .application-dropdown, input, select, textarea")
    .forEach((element) => element.remove());
  return text(context.textContent);
}

function controlKind(control: InspectableControl): RawField["controlKind"] {
  if (control.getAttribute("role") === "combobox") return "other";
  if (control instanceof HTMLTextAreaElement) return "textarea";
  if (control instanceof HTMLSelectElement)
    return control.multiple ? "select-multiple" : "select-one";
  if (control instanceof HTMLInputElement)
    return SUPPORTED_INPUT_TYPES.has(control.type)
      ? (control.type as RawField["controlKind"])
      : "other";
  return "other";
}

function stableFieldId(
  control: InspectableControl,
  index: number,
  occurrences: Map<string, number>,
): string {
  const base = text(control.id) || text(control.getAttribute("name")) || `field-${index + 1}`;
  const occurrence = occurrences.get(base) ?? 0;
  occurrences.set(base, occurrence + 1);
  return occurrence === 0 ? base : `${base}-${occurrence + 1}`;
}

function controlOptions(
  control: InspectableControl,
  targetDocument: Document,
): RawField["options"] {
  if (control instanceof HTMLSelectElement)
    return Array.from(control.options).map((option) => ({
      value: option.value,
      text: text(option.textContent),
      disabled: option.disabled,
    }));
  const role = control.getAttribute("role");
  if (role !== "combobox" && role !== "listbox") return [];
  const controlledId = text(control.getAttribute("aria-controls"));
  const optionContainer =
    role === "listbox" ? control : targetDocument.getElementById(controlledId);
  if (!optionContainer) return [];
  return Array.from(optionContainer.querySelectorAll<HTMLElement>("[role='option']"))
    .filter(isInspectable)
    .map((option) => ({
      value:
        text(option.dataset.value) ||
        text(option.getAttribute("aria-label")) ||
        text(option.textContent),
      text: text(option.textContent) || text(option.getAttribute("aria-label")),
      disabled: option.getAttribute("aria-disabled") === "true",
    }));
}

export function scanVisibleForm(targetDocument: Document = document): PageSnapshot {
  return inspectVisibleForm(targetDocument).snapshot;
}

export function inspectVisibleForm(targetDocument: Document = document): {
  snapshot: PageSnapshot;
  controlsByFieldId: Map<string, InspectableControl>;
} {
  const controls = Array.from(
    targetDocument.querySelectorAll<InspectableControl>(
      "input, select, textarea, [role='combobox'], [role='listbox'], [role='checkbox'], [role='radio']",
    ),
  ).filter(isInspectable);
  const fieldIdOccurrences = new Map<string, number>();
  const controlsByFieldId = new Map<string, InspectableControl>();

  const fields = controls.map((control, index): RawField => {
    const fieldId = stableFieldId(control, index, fieldIdOccurrences);
    controlsByFieldId.set(fieldId, control);
    return {
      fieldId,
      controlKind: controlKind(control),
      accessibleName: accessibleName(control),
      labelText: labelText(control),
      ariaLabel: text(control.getAttribute("aria-label")),
      placeholder: text(control.getAttribute("placeholder")),
      name: text(control.getAttribute("name")),
      domId: text(control.id),
      required:
        (isSupportedControl(control) && control.required) ||
        control.getAttribute("aria-required") === "true",
      disabled:
        (isSupportedControl(control) && control.disabled) ||
        control.getAttribute("aria-disabled") === "true",
      readOnly: isSupportedControl(control) && "readOnly" in control && control.readOnly,
      autocomplete: text(control.getAttribute("autocomplete")),
      ...(!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) ||
      control.maxLength <= 0
        ? {}
        : { maxLength: Math.min(control.maxLength, 20_000) }),
      groupLabel: groupLabel(control),
      optionValue:
        control instanceof HTMLInputElement && ["radio", "checkbox"].includes(control.type)
          ? control.value
          : "",
      checked:
        control instanceof HTMLInputElement
          ? control.checked
          : control.getAttribute("aria-checked") === "true",
      userEdited: control.getAttribute("data-job-copilot-user-edited") === "true",
      options: controlOptions(control, targetDocument),
    };
  });

  const snapshot = PageSnapshotSchema.parse({
    schemaVersion: 1,
    url: targetDocument.location.href,
    title: targetDocument.title,
    capturedAt: new Date().toISOString(),
    fields,
  });
  return { snapshot, controlsByFieldId };
}
