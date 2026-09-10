import type { PreparationFileSchema, PreparationQuestionSchema } from "@copilot/agent-core";
import type { z } from "zod";

export type PortalSnapshot = {
  applicationId: string | null;
  step: "start" | "contact" | "screening" | "review";
  fields: z.infer<typeof PreparationQuestionSchema>[];
  review: [string, string][];
  uploadRetained: boolean;
  uploadSha256?: string | null;
  hash: string;
};
export type PortalDocumentCommand = {
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

// Serialized into Chrome's isolated world. All targets come from a fresh native DOM observation.
export async function portalPreparationDocument(
  input: PortalDocumentCommand,
): Promise<PortalSnapshot> {
  const visible = (element: Element) =>
    element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
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
    if (
      document.querySelector("iframe") ||
      [...document.querySelectorAll("*")].some((el) => el.shadowRoot)
    )
      throw new Error(
        "This preparation requires native controls. Review embedded controls manually.",
      );
    if ([...document.querySelectorAll('[role="alert"],dialog[open]')].some(visible))
      throw new Error("The page requires attention. Resolve its message before resuming.");
  }
  function application() {
    const forms = [...document.querySelectorAll<HTMLElement>("[data-application-id][data-job-id]")];
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
    const controls = [
      ...(application()?.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select") ??
        []),
    ].filter((el) => el.name === key && visible(el));
    if (controls.length !== 1) throw new Error("Control changed or is ambiguous.");
    return controls[0]!;
  }
  function clickTarget(text: string) {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")].filter(
      (el) => el.textContent?.trim() === text && visible(el) && !el.disabled,
    );
    if (buttons.length !== 1) throw new Error("Navigation changed or is unavailable.");
    return buttons[0]!;
  }
  function reachable(element: HTMLElement) {
    element.scrollIntoView({ block: "center" });
    const rect = element.getBoundingClientRect();
    const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
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
      const controls = [
        ...form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
          "input,select,textarea,[contenteditable=true],[role=combobox]",
        ),
      ].filter(visible);
      if (controls.length > 30) throw new Error("Too many controls for this review.");
      for (const element of controls) {
        if (
          !(element instanceof HTMLInputElement || element instanceof HTMLSelectElement) ||
          element.disabled ||
          (element instanceof HTMLInputElement && element.readOnly) ||
          element.labels?.length !== 1 ||
          !/^[a-zA-Z][a-zA-Z0-9-]{0,99}$/.test(element.name)
        )
          throw new Error("Unsupported or ambiguous control.");
        const kind = element instanceof HTMLSelectElement ? "select" : element.type;
        if (!["text", "email", "number", "select", "file"].includes(kind))
          throw new Error("Complete this control manually.");
        const file = element instanceof HTMLInputElement ? element.files?.[0] : undefined;
        fields.push({
          key: element.name,
          label: element.labels[0]!.textContent.trim(),
          kind: kind as PortalSnapshot["fields"][number]["kind"],
          options:
            element instanceof HTMLSelectElement
              ? [...element.options].filter((o) => !o.disabled).map((o) => o.value)
              : [],
          value: file ? await digest(new Uint8Array(await file.arrayBuffer())) : element.value,
          required: element.required,
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
    return { ...result, hash: await digest(new TextEncoder().encode(JSON.stringify(result))) };
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
  const local = globalThis as typeof globalThis & { __copilotPortalIntents?: Set<string> };
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
  receipts.add(input.intentId);
  if (["FILL_TEXT", "SELECT_OPTION", "UPLOAD_FILE"].includes(input.action)) {
    const element = control(input.target!);
    const field = before.fields.find((f) => f.key === input.target)!;
    const currentKind = element instanceof HTMLSelectElement ? "select" : element.type;
    if (
      element.disabled ||
      element.labels?.length !== 1 ||
      element.labels[0]!.textContent?.trim() !== field.label ||
      element.required !== field.required ||
      currentKind !== field.kind ||
      (element instanceof HTMLInputElement && element.readOnly) ||
      (element instanceof HTMLSelectElement &&
        JSON.stringify([...element.options].filter((o) => !o.disabled).map((o) => o.value)) !==
          JSON.stringify(field.options)) ||
      element.value
    )
      throw new Error("Control changed immediately before filling. Review it again.");
    if (field.value)
      throw new Error("Existing values require explicit review; no overwrite performed.");
    reachable(element);
    if (input.action === "UPLOAD_FILE") {
      if (
        !(element instanceof HTMLInputElement) ||
        element.type !== "file" ||
        !bytes ||
        !input.file
      )
        throw new Error("File control changed.");
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes as Uint8Array<ArrayBuffer>], input.file.name));
      element.files = transfer.files;
    } else {
      if (input.value === undefined || input.value.length > 5000 || field.kind === "file")
        throw new Error("Missing reviewed answer.");
      if (element instanceof HTMLSelectElement && !field.options.includes(input.value))
        throw new Error("Option unavailable.");
      Object.getOwnPropertyDescriptor(
        element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype,
        "value",
      )!.set!.call(element, input.value);
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
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
    checks[0]!.dispatchEvent(new Event("change", { bubbles: true }));
    const button = clickTarget("Submit local application");
    reachable(button);
    button.click();
    return before; // The controller verifies the authoritative receipt independently.
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const after = await snapshot();
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
