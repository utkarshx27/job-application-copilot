import type { PreparationFileSchema, PreparationQuestionSchema } from "@copilot/agent-core";
import type { z } from "zod";

export type PortalSnapshot = {
  surfaceId?: string;
  applicationId: string | null;
  step: "start" | "contact" | "screening" | "review";
  fields: z.infer<typeof PreparationQuestionSchema>[];
  review: [string, string][];
  uploadRetained: boolean;
  uploadSha256?: string | null;
  hash: string;
};
export type PortalDocumentCommand = {
  surfaceId?: string;
  url: string;
  jobId: string;
  applicationId: string | null;
  action:
    "OBSERVE" | "OPEN_CONTROL" | "FILL_TEXT" | "SELECT_OPTION" | "UPLOAD_FILE" | "NEXT" | "SUBMIT";
  target?: string;
  value?: string;
  file?: z.infer<typeof PreparationFileSchema>;
  hash?: string;
  intentId?: string;
  expiresAt?: number;
};

// Serialized into the top document's isolated world. Nested access is restricted
// to exact same-origin local fixture routes, never arbitrary browser frames.
export async function portalPreparationDocument(
  input: PortalDocumentCommand,
): Promise<PortalSnapshot> {
  const visible = (element: Element) =>
    element.getClientRects().length > 0 &&
    element.ownerDocument.defaultView!.getComputedStyle(element).visibility !== "hidden";
  const local = globalThis as typeof globalThis & {
    __copilotPortalIntents?: Set<string>;
    __copilotPortalNodes?: WeakMap<Node, string>;
  };
  const identities = (local.__copilotPortalNodes ??= new WeakMap<Node, string>());
  const identity = (node: Node) => {
    let value = identities.get(node);
    if (!value) {
      value = crypto.randomUUID();
      identities.set(node, value);
    }
    return value;
  };
  let page = document;
  let frames: HTMLIFrameElement[] = [];
  function query<T extends Element = HTMLElement>(
    scope: Document | ShadowRoot | Element,
    selector: string,
  ): T[] {
    const roots: (Document | ShadowRoot | Element)[] = [scope];
    const found: T[] = [];
    for (let index = 0; index < roots.length; index++) {
      if (roots.length > 16) throw new Error("Too many embedded roots.");
      const root = roots[index]!;
      const elements = [...root.querySelectorAll("*")];
      if (elements.length > 2000) throw new Error("Application is too complex for this review.");
      found.push(...root.querySelectorAll<T>(selector));
      for (const element of elements) if (element.shadowRoot) roots.push(element.shadowRoot);
    }
    return found;
  }
  const isInput = (element: Element): element is HTMLInputElement => element.tagName === "INPUT";
  const isSelect = (element: Element): element is HTMLSelectElement => element.tagName === "SELECT";
  const isCombo = (element: Element): element is HTMLButtonElement =>
    element.tagName === "BUTTON" && element.getAttribute("role") === "combobox";
  function nativeKind(element: HTMLInputElement | HTMLSelectElement | HTMLButtonElement) {
    return isSelect(element) || isCombo(element) ? "select" : element.type;
  }
  function fieldKey(element: HTMLInputElement | HTMLSelectElement | HTMLButtonElement) {
    return isCombo(element) ? element.id : element.name;
  }
  function combo(element: HTMLButtonElement) {
    const root = element.getRootNode() as Document | ShadowRoot;
    const id = element.getAttribute("aria-controls");
    const lists = [...root.querySelectorAll<HTMLElement>('[role="listbox"]')].filter(
      (list) => !!id && list.id === id,
    );
    if (
      element.type !== "button" ||
      !["true", "false"].includes(element.getAttribute("aria-expanded") ?? "") ||
      lists.length !== 1 ||
      !query(application() ?? page, 'button[role="combobox"]').includes(element)
    )
      throw new Error("Ambiguous combobox ownership.");
    const list = lists[0]!;
    if (!list.parentElement || list.parentElement !== element.parentElement)
      throw new Error("Combobox list moved.");
    const options = [...list.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    const values = options.map((option) => option.textContent.trim());
    if (
      !options.length ||
      options.length > 30 ||
      options.some(
        (option) =>
          option.tagName !== "BUTTON" ||
          option.type !== "button" ||
          option.disabled ||
          option.getAttribute("aria-disabled") === "true",
      ) ||
      values.some((value) => !value) ||
      new Set(values).size !== values.length
    )
      throw new Error("Unsupported or ambiguous options.");
    const text = element.textContent.trim();
    const value = text === "Choose an option" ? "" : values.includes(text) ? text : null;
    if (value === null) throw new Error("Unrecognized combobox value.");
    return { list, options, values, value };
  }
  const digest = async (bytes: Uint8Array) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  function guard() {
    if (
      window.top !== window ||
      location.href !== input.url ||
      !/^http:\/\/127\.0\.0\.1:4173\/portal\.html\?scenario=portal-(?:01|02|30|31|32|33|34)&jobId=job-\d+-\d+$/.test(
        input.url,
      ) ||
      !input.url.endsWith(`&jobId=${input.jobId}`) ||
      document.visibilityState !== "visible"
    )
      throw new Error("Return to the unchanged local application tab.");
    page = document;
    frames = [];
    const scenario = new URL(input.url).searchParams.get("scenario")!;
    for (let depth = 0; ; depth++) {
      if (query(page, '[role="alert"]').some(visible))
        throw new Error("The page requires attention.");
      const nested = query<HTMLIFrameElement>(page, "iframe");
      if (!nested.length) break;
      if (
        depth >= 2 ||
        nested.length !== 1 ||
        query(page, "[data-application-id]").length ||
        query(page, "dialog[open]").length
      )
        throw new Error("Ambiguous application frame.");
      const frame = nested[0]!;
      const expected = `http://127.0.0.1:4173/portal-frame.html?scenario=${scenario}&jobId=${input.jobId}`;
      if (
        !visible(frame) ||
        frame.hasAttribute("srcdoc") ||
        frame.hasAttribute("sandbox") ||
        ![expected, `${expected}&nested=1`].includes(frame.src)
      )
        throw new Error("Unapproved application frame.");
      const child = frame.contentDocument;
      if (!child || child.URL !== frame.src || child.readyState === "loading")
        throw new Error("Application frame is not ready.");
      reachable(frame);
      frames.push(frame);
      page = child;
    }
    const form = application();
    const dialogs = query(page, 'dialog[open],[role="dialog"],[role="alertdialog"]').filter(
      visible,
    );
    if (
      dialogs.some(
        (dialog) =>
          dialog !== form ||
          dialog.tagName !== "DIALOG" ||
          dialog.getAttribute("aria-label") !== "Local application",
      )
    )
      throw new Error("Unexpected dialog requires manual review.");
    if (input.surfaceId && (!form || `${identity(page)}/${identity(form)}` !== input.surfaceId))
      throw new Error("Application document changed.");
  }
  function application() {
    const forms = query<HTMLElement>(page, "[data-application-id][data-job-id]");
    if (
      forms.length > 1 ||
      (forms[0] &&
        (forms[0].dataset.jobId !== input.jobId ||
          (input.applicationId && forms[0].dataset.applicationId !== input.applicationId)))
    )
      throw new Error("Application identity changed.");
    if (input.applicationId && !forms[0])
      throw new Error("Application disappeared. Do not open another one.");
    return forms[0];
  }
  function control(key: string) {
    const form = application();
    const controls = form
      ? query<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
          form,
          'input,select,button[role="combobox"]',
        ).filter((el) => fieldKey(el) === key && visible(el))
      : [];
    if (controls.length !== 1) throw new Error("Control changed or is ambiguous.");
    return controls[0]!;
  }
  function clickTarget(text: string) {
    const buttons = query<HTMLButtonElement>(application() ?? page, "button").filter(
      (el) => el.textContent?.trim() === text && visible(el) && !el.disabled,
    );
    if (buttons.length !== 1) throw new Error("Navigation changed or is unavailable.");
    return buttons[0]!;
  }
  function reachable(element: HTMLElement) {
    element.scrollIntoView({ block: "center" });
    const rect = element.getBoundingClientRect();
    let top = element.ownerDocument.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
    for (let depth = 0; top?.shadowRoot && depth < 16; depth++) {
      const inner = top.shadowRoot.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      );
      if (!inner || inner === top) break;
      top = inner;
    }
    if (!top || (top !== element && !element.contains(top)))
      throw new Error("Control is covered. Inspect the page.");
  }
  async function snapshot(): Promise<PortalSnapshot> {
    guard();
    const form = application();
    const heading = form?.querySelector("h2")?.textContent;
    const step = !form
      ? "start"
      : heading === "Step 1 of 3: Contact and preferences"
        ? "contact"
        : heading === "Step 2 of 3: Screening and documents"
          ? "screening"
          : heading === "Step 3 of 3: Review"
            ? "review"
            : null;
    if (!step) throw new Error("Unrecognized application step.");
    const fields: PortalSnapshot["fields"] = [];
    if (form && step !== "review") {
      const controls = query<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
        form,
        "input,select,textarea,[contenteditable=true],[role=combobox]",
      ).filter(visible);
      if (controls.length > 30) throw new Error("Too many controls for this review.");
      if (step === "contact" && !controls.length)
        throw new Error("Application controls are not inspectable.");
      for (const element of controls) {
        if (
          !(isInput(element) || isSelect(element) || isCombo(element)) ||
          element.disabled ||
          element.getAttribute("aria-disabled") === "true" ||
          (isInput(element) && element.readOnly) ||
          element.labels?.length !== 1 ||
          !/^[a-zA-Z][a-zA-Z0-9-]{0,99}$/.test(fieldKey(element))
        )
          throw new Error("Unsupported or ambiguous control.");
        const kind = nativeKind(element);
        if (!["text", "email", "number", "select", "file"].includes(kind))
          throw new Error("Complete this control manually.");
        const file = isInput(element) ? element.files?.[0] : undefined;
        const widget = isCombo(element) ? combo(element) : null;
        fields.push({
          key: fieldKey(element),
          label: element.labels[0]!.textContent.trim(),
          kind: kind as PortalSnapshot["fields"][number]["kind"],
          options: widget
            ? widget.values
            : isSelect(element)
              ? [...element.options].filter((o) => !o.disabled).map((o) => o.value)
              : [],
          value: file
            ? await digest(new Uint8Array(await file.arrayBuffer()))
            : widget
              ? widget.value
              : element.value,
          required: isCombo(element)
            ? element.getAttribute("aria-required") === "true"
            : element.required,
        });
      }
      if (new Set(fields.map((f) => f.key)).size !== fields.length)
        throw new Error("Duplicate controls require review.");
    }
    const review: [string, string][] = [];
    if (step === "review") {
      const lists = [...form!.querySelectorAll("dl")].filter(visible);
      if (lists.length !== 1) throw new Error("Review summary unavailable.");
      const entries = [...lists[0]!.children];
      if (entries.length % 2) throw new Error("Invalid review summary.");
      for (let i = 0; i < entries.length; i += 2) {
        if (entries[i]!.tagName !== "DT" || entries[i + 1]!.tagName !== "DD")
          throw new Error("Invalid review summary.");
        review.push([entries[i]!.textContent.trim(), entries[i + 1]!.textContent]);
      }
    }
    const result: Omit<PortalSnapshot, "hash"> = {
      surfaceId: `${identity(page)}/${form ? identity(form) : "start"}`,
      applicationId: form?.dataset.applicationId ?? null,
      step,
      fields,
      review,
      uploadRetained:
        !!form &&
        [...form.querySelectorAll("p")].some(
          (p) => visible(p) && p.textContent === "Resume retained for this application",
        ),
      uploadSha256:
        form?.querySelector<HTMLElement>("[data-upload-sha256]")?.dataset.uploadSha256 ?? null,
    };
    return {
      ...result,
      hash: await digest(
        new TextEncoder().encode(
          JSON.stringify({
            ...result,
            frames: frames.map(identity),
            controls: fields.map((field) => identity(control(field.key))),
          }),
        ),
      ),
    };
  }
  const before = await snapshot();
  if (input.action === "OBSERVE") return before;
  if (
    !input.intentId ||
    !input.expiresAt ||
    input.expiresAt <= Date.now() ||
    before.hash !== input.hash
  )
    throw new Error("Action review expired or the page changed.");
  const receipts = (local.__copilotPortalIntents ??= new Set<string>());
  if (receipts.has(input.intentId))
    throw new Error("Action already dispatched. Inspect its result.");
  let bytes: Uint8Array | undefined;
  if (input.action === "UPLOAD_FILE") {
    if (!input.file) throw new Error("Reviewed résumé required.");
    bytes = Uint8Array.from(atob(input.file.base64), (c) => c.charCodeAt(0));
    if (!bytes.length || bytes.length > 500000 || (await digest(bytes)) !== input.file.sha256)
      throw new Error("Résumé content changed.");
  }
  // Reobserve after asynchronous file/hash work, then make one synchronous bounded mutation.
  const fresh = await snapshot();
  if (fresh.hash !== before.hash || input.expiresAt <= Date.now())
    throw new Error("Page changed before dispatch.");
  guard();
  receipts.add(input.intentId);
  if (["FILL_TEXT", "SELECT_OPTION", "UPLOAD_FILE"].includes(input.action)) {
    const element = control(input.target!);
    const field = before.fields.find((f) => f.key === input.target)!;
    const currentKind = nativeKind(element);
    const widget = isCombo(element) ? combo(element) : null;
    if (
      element.disabled ||
      element.labels?.length !== 1 ||
      element.labels[0]!.textContent?.trim() !== field.label ||
      (isCombo(element) ? element.getAttribute("aria-required") === "true" : element.required) !==
        field.required ||
      currentKind !== field.kind ||
      (isInput(element) && element.readOnly) ||
      (isSelect(element) &&
        JSON.stringify([...element.options].filter((o) => !o.disabled).map((o) => o.value)) !==
          JSON.stringify(field.options)) ||
      (widget && JSON.stringify(widget.values) !== JSON.stringify(field.options)) ||
      (widget ? widget.value : element.value)
    )
      throw new Error("Control changed immediately before filling. Review it again.");
    if (field.value)
      throw new Error("Existing values require explicit review; no overwrite performed.");
    reachable(element);
    if (input.action === "UPLOAD_FILE") {
      if (!isInput(element) || element.type !== "file" || !bytes || !input.file)
        throw new Error("File control changed.");
      const view = element.ownerDocument.defaultView!;
      const transfer = new view.DataTransfer();
      transfer.items.add(new view.File([bytes as Uint8Array<ArrayBuffer>], input.file.name));
      element.files = transfer.files;
    } else if (isCombo(element)) {
      if (
        input.action !== "SELECT_OPTION" ||
        !widget ||
        !input.value ||
        !widget.values.includes(input.value)
      )
        throw new Error("Option unavailable.");
      if (element.getAttribute("aria-expanded") === "false") element.click();
      guard();
      const opened = combo(element);
      if (
        input.expiresAt <= Date.now() ||
        control(input.target!) !== element ||
        element.disabled ||
        element.labels?.[0]?.textContent.trim() !== field.label ||
        opened.value ||
        element.getAttribute("aria-expanded") !== "true" ||
        !visible(opened.list) ||
        JSON.stringify(opened.values) !== JSON.stringify(widget.values) ||
        opened.options.some((option, index) => option !== widget.options[index])
      )
        throw new Error("Combobox changed while opening. Review again.");
      const option = opened.options[opened.values.indexOf(input.value)]!;
      if (!visible(option)) throw new Error("Option is not visible.");
      reachable(option);
      option.click();
    } else {
      if (input.value === undefined || input.value.length > 5000 || field.kind === "file")
        throw new Error("Missing reviewed answer.");
      if (isSelect(element) && !field.options.includes(input.value))
        throw new Error("Option unavailable.");
      Object.getOwnPropertyDescriptor(
        isSelect(element)
          ? element.ownerDocument.defaultView!.HTMLSelectElement.prototype
          : element.ownerDocument.defaultView!.HTMLInputElement.prototype,
        "value",
      )!.set!.call(element, input.value);
    }
    const view = element.ownerDocument.defaultView!;
    if (!isCombo(element)) {
      element.dispatchEvent(new view.Event("input", { bubbles: true }));
      element.dispatchEvent(new view.Event("change", { bubbles: true }));
    }
  } else if (input.action === "OPEN_CONTROL") {
    if (before.step !== "start") throw new Error("Application already opened.");
    const button = clickTarget("Apply locally");
    reachable(button);
    button.click();
  } else if (input.action === "NEXT") {
    if (
      !["contact", "screening"].includes(before.step) ||
      before.fields.some((f) => f.required && !f.value)
    )
      throw new Error("Review missing answers first.");
    for (const field of before.fields)
      if (!control(field.key).checkValidity()) throw new Error("Correct invalid answers first.");
    const button = clickTarget(before.step === "contact" ? "Next step" : "Review application");
    reachable(button);
    button.click();
  } else if (input.action === "SUBMIT") {
    if (before.step !== "review") throw new Error("Final review required.");
    const currentReview = [...application()!.querySelectorAll("dl")].filter(visible);
    const entries = currentReview[0]
      ? [...currentReview[0].children].map((el) => el.textContent)
      : [];
    if (
      currentReview.length !== 1 ||
      JSON.stringify(entries) !== JSON.stringify(before.review.flat())
    )
      throw new Error("Final review changed immediately before submission.");
    const checks = [
      ...application()!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ].filter(visible);
    if (
      checks.length !== 1 ||
      checks[0]!.labels?.length !== 1 ||
      checks[0]!.labels[0]!.textContent?.trim() !== "I approve this synthetic application" ||
      checks[0]!.disabled
    )
      throw new Error("Submission consent control changed.");
    reachable(checks[0]!);
    checks[0]!.checked = true;
    checks[0]!.dispatchEvent(
      new checks[0]!.ownerDocument.defaultView!.Event("change", { bubbles: true }),
    );
    guard();
    if (
      JSON.stringify([...currentReview[0]!.children].map((el) => el.textContent)) !==
        JSON.stringify(before.review.flat()) ||
      (application()!.querySelector<HTMLElement>("[data-upload-sha256]")?.dataset.uploadSha256 !==
        before.uploadSha256 &&
        before.uploadSha256 !== null)
    )
      throw new Error("Final review changed during consent.");
    const button = clickTarget("Submit local application");
    reachable(button);
    button.click();
    return before; // The controller verifies the authoritative receipt independently.
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    let after: PortalSnapshot;
    try {
      after = await snapshot();
    } catch (error) {
      if (
        input.action === "OPEN_CONTROL" &&
        error instanceof Error &&
        error.message === "Application frame is not ready."
      )
        continue;
      throw error;
    }
    if (input.action === "OPEN_CONTROL" && after.step === "contact") return after;
    if (
      input.action === "NEXT" &&
      after.step === (before.step === "contact" ? "screening" : "review")
    )
      return after;
    if (
      ["FILL_TEXT", "SELECT_OPTION", "UPLOAD_FILE"].includes(input.action) &&
      after.fields.find((f) => f.key === input.target)?.value ===
        (input.action === "UPLOAD_FILE" ? input.file!.sha256 : input.value)
    )
      return after;
  }
  throw new Error("Could not verify the action. Inspect the page before resuming.");
}
