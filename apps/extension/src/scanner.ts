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

function text(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function isInspectable(control: SupportedControl): boolean {
  if (control instanceof HTMLInputElement) {
    if (control.type === "password" || control.type === "hidden") return false;
    if (!SUPPORTED_INPUT_TYPES.has(control.type)) return false;
  }

  if (control.hidden || control.closest("[hidden], [aria-hidden='true']")) return false;
  const style = window.getComputedStyle(control);
  return style.display !== "none" && style.visibility !== "hidden";
}

function referencedText(control: SupportedControl, attribute: string): string {
  return text(
    control
      .getAttribute(attribute)
      ?.split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" "),
  );
}

function labelText(control: SupportedControl): string {
  const nativeLabels = "labels" in control ? Array.from(control.labels ?? []) : [];
  const labels = nativeLabels.map((label) => label.textContent ?? "").join(" ");
  return text(labels || control.closest("label")?.textContent);
}

function accessibleName(control: SupportedControl): string {
  return (
    text(control.getAttribute("aria-label")) ||
    referencedText(control, "aria-labelledby") ||
    labelText(control) ||
    text(control.getAttribute("placeholder")) ||
    text(control.getAttribute("name")) ||
    text(control.id)
  );
}

function groupLabel(control: SupportedControl): string {
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

function controlKind(control: SupportedControl): RawField["controlKind"] {
  if (control instanceof HTMLTextAreaElement) return "textarea";
  if (control instanceof HTMLSelectElement)
    return control.multiple ? "select-multiple" : "select-one";
  return SUPPORTED_INPUT_TYPES.has(control.type)
    ? (control.type as RawField["controlKind"])
    : "other";
}

function stableFieldId(
  control: SupportedControl,
  index: number,
  occurrences: Map<string, number>,
): string {
  const base = text(control.id) || text(control.getAttribute("name")) || `field-${index + 1}`;
  const occurrence = occurrences.get(base) ?? 0;
  occurrences.set(base, occurrence + 1);
  return occurrence === 0 ? base : `${base}-${occurrence + 1}`;
}

export function scanVisibleForm(targetDocument: Document = document): PageSnapshot {
  return inspectVisibleForm(targetDocument).snapshot;
}

export function inspectVisibleForm(targetDocument: Document = document): {
  snapshot: PageSnapshot;
  controlsByFieldId: Map<string, SupportedControl>;
} {
  const controls = Array.from(
    targetDocument.querySelectorAll<SupportedControl>("input, select, textarea"),
  ).filter(isInspectable);
  const fieldIdOccurrences = new Map<string, number>();
  const controlsByFieldId = new Map<string, SupportedControl>();

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
      required: control.required || control.getAttribute("aria-required") === "true",
      disabled: control.disabled,
      readOnly: "readOnly" in control && control.readOnly,
      autocomplete: text(control.getAttribute("autocomplete")),
      groupLabel: groupLabel(control),
      optionValue: control instanceof HTMLInputElement ? control.value : "",
      checked: control instanceof HTMLInputElement && control.checked,
      userEdited: control.getAttribute("data-job-copilot-user-edited") === "true",
      options:
        control instanceof HTMLSelectElement
          ? Array.from(control.options).map((option) => ({
              value: option.value,
              text: text(option.textContent),
              disabled: option.disabled,
            }))
          : [],
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
