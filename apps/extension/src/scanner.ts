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

function tagName(value: EventTarget | null | undefined): string {
  return typeof (value as { tagName?: unknown } | null)?.tagName === "string"
    ? (value as unknown as { tagName: string }).tagName.toLocaleUpperCase()
    : "";
}

export function isInputControl(
  control: EventTarget | null | undefined,
): control is HTMLInputElement {
  return tagName(control) === "INPUT";
}

export function isSelectControl(
  control: EventTarget | null | undefined,
): control is HTMLSelectElement {
  return tagName(control) === "SELECT";
}

export function isTextAreaControl(
  control: EventTarget | null | undefined,
): control is HTMLTextAreaElement {
  return tagName(control) === "TEXTAREA";
}

export function isSupportedControl(
  control: EventTarget | null | undefined,
): control is SupportedControl {
  return isInputControl(control) || isSelectControl(control) || isTextAreaControl(control);
}

function text(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function isInspectable(control: InspectableControl): boolean {
  if (isInputControl(control)) {
    if (control.type === "password" || control.type === "hidden") return false;
    if (!SUPPORTED_INPUT_TYPES.has(control.type)) return false;
  }

  if (control.hidden || control.closest("[hidden], [aria-hidden='true']")) return false;
  const style = (control.ownerDocument.defaultView ?? window).getComputedStyle(control);
  return style.display !== "none" && style.visibility !== "hidden";
}

function tree(targetDocument: Document): {
  roots: Array<Document | ShadowRoot>;
  documents: Document[];
} {
  const roots: Array<Document | ShadowRoot> = [];
  const documents: Document[] = [];
  const visitedRoots = new Set<Document | ShadowRoot>();
  const visitedDocuments = new Set<Document>();

  const visitRoot = (root: Document | ShadowRoot) => {
    if (visitedRoots.has(root)) return;
    visitedRoots.add(root);
    roots.push(root);

    for (const element of root.querySelectorAll<HTMLElement>("*")) {
      if (element.shadowRoot) visitRoot(element.shadowRoot);
    }

    for (const frame of root.querySelectorAll<HTMLIFrameElement | HTMLFrameElement>(
      "iframe, frame",
    )) {
      try {
        if (frame.contentDocument) visitDocument(frame.contentDocument);
      } catch {
        // Cross-origin frames stay outside the extension's site-scoped access boundary.
      }
    }
  };

  const visitDocument = (target: Document) => {
    if (visitedDocuments.has(target)) return;
    visitedDocuments.add(target);
    documents.push(target);
    visitRoot(target);
  };

  visitDocument(targetDocument);
  return { roots, documents };
}

export function reachableDocuments(targetDocument: Document = document): Document[] {
  return tree(targetDocument).documents;
}

function elementById(control: InspectableControl, id: string): HTMLElement | null {
  const root = control.getRootNode() as Document | ShadowRoot;
  const rootWithLookup = root as DocumentOrShadowRoot & {
    getElementById?: (elementId: string) => HTMLElement | null;
  };
  return rootWithLookup.getElementById?.(id) ?? control.ownerDocument.getElementById(id);
}

function referencedText(control: InspectableControl, attribute: string): string {
  return text(
    control
      .getAttribute(attribute)
      ?.split(/\s+/)
      .map((id) => elementById(control, id)?.textContent ?? "")
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
  if (isTextAreaControl(control)) return "textarea";
  if (isSelectControl(control)) return control.multiple ? "select-multiple" : "select-one";
  if (isInputControl(control))
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
  if (isSelectControl(control))
    return Array.from(control.options).map((option) => ({
      value: option.value,
      text: text(option.textContent),
      disabled: option.disabled,
    }));
  const role = control.getAttribute("role");
  if (role !== "combobox" && role !== "listbox") return [];
  const controlledId = text(control.getAttribute("aria-controls"));
  const optionContainer =
    role === "listbox"
      ? control
      : (elementById(control, controlledId) ?? targetDocument.getElementById(controlledId));
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

function nativeControlHasValue(control: InspectableControl): boolean {
  if (isSelectControl(control)) return control.selectedIndex >= 0 && Boolean(control.value);
  if (isTextAreaControl(control)) return Boolean(control.value.trim());
  if (!isInputControl(control)) return false;
  if (control.type === "checkbox" || control.type === "radio") return control.checked;
  if (control.type === "file") return (control.files?.length ?? 0) > 0;
  return Boolean(control.value.trim());
}

function valueState(control: InspectableControl): RawField["valueState"] {
  if (control.getAttribute("data-job-copilot-user-edited") === "true") return "USER_EDITED";
  if (control.getAttribute("data-job-copilot-filled") === "true") return "COPILOT_FILLED";
  return nativeControlHasValue(control) ? "PREFILLED" : "EMPTY";
}

export function scanVisibleForm(targetDocument: Document = document): PageSnapshot {
  return inspectVisibleForm(targetDocument).snapshot;
}

export function inspectVisibleForm(targetDocument: Document = document): {
  snapshot: PageSnapshot;
  controlsByFieldId: Map<string, InspectableControl>;
} {
  const candidates = tree(targetDocument).roots.flatMap((root) =>
    Array.from(
      root.querySelectorAll<InspectableControl>(
        "input, select, textarea, [role='combobox'], [role='listbox'], [role='checkbox'], [role='radio']",
      ),
    ).filter(isInspectable),
  );
  const controlledListboxes = new Set(
    candidates.flatMap((control) => {
      if (control.getAttribute("role") !== "combobox") return [];
      const controlledId = text(control.getAttribute("aria-controls"));
      const controlled = controlledId ? elementById(control, controlledId) : null;
      return controlled?.getAttribute("role") === "listbox" ? [controlled] : [];
    }),
  );
  const controls = candidates.filter((control) => {
    const listbox = control.closest("[role='listbox']");
    return !listbox || !controlledListboxes.has(listbox as HTMLElement);
  });
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
      automationId: text(control.getAttribute("data-automation-id")),
      valueState: valueState(control),
      ...(!(isInputControl(control) || isTextAreaControl(control)) || control.maxLength <= 0
        ? {}
        : { maxLength: Math.min(control.maxLength, 20_000) }),
      groupLabel: groupLabel(control),
      optionValue:
        isInputControl(control) && ["radio", "checkbox"].includes(control.type)
          ? control.value
          : "",
      checked: isInputControl(control)
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
