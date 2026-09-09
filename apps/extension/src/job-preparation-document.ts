import type { PreparationAnswers } from "@copilot/agent-core";

// Self-contained: Chrome serializes this function into the isolated world.
// No arbitrary selectors, script text, Next, uploads or Submit capability.
export async function prepareNativeDocument(input: {
  url: string;
  jobId: string;
  action: "OPEN_FORM" | "FILL_FIELDS";
  answers: PreparationAnswers;
}) {
  const check = () => {
    if (
      window.top !== window ||
      location.href !== input.url ||
      input.url !== `http://127.0.0.1:4173/portal.html?scenario=portal-01&jobId=${input.jobId}` ||
      !/^job-\d+-\d+$/.test(input.jobId)
    )
      throw new Error("Local preparation page changed.");
    if (document.visibilityState !== "visible")
      throw new Error("Return to the application tab before preparing.");
    if (document.querySelector("iframe"))
      throw new Error("Embedded forms require manual review in this native-only preparation.");
    if (
      [...document.querySelectorAll('[role="alert"],dialog[open]')].some(
        (element) => element.getClientRects().length,
      )
    )
      throw new Error("The page requires manual review.");
  };
  check();
  if (input.action === "OPEN_FORM") {
    const buttons = [...document.querySelectorAll("button")].filter(
      (button) =>
        button.textContent?.trim() === "Apply locally" &&
        !button.disabled &&
        button.getClientRects().length,
    );
    if (buttons.length !== 1 || document.querySelector("[data-application-id]"))
      throw new Error("Application is already open or needs manual review.");
    buttons[0]!.click();
    for (let count = 0; count < 50; count++) {
      check();
      const form = document.querySelector(`[data-job-id="${input.jobId}"][data-application-id]`);
      if (form?.querySelector("input[name=email]")) return { prepared: false };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Application did not open. Inspect the tab; do not retry automatically.");
  }
  const labels = {
    name: "Full name",
    email: "Email",
    phone: "Phone number",
    currentLocation: "Current city",
    workArrangement: "Work arrangement",
  };
  function controls() {
    check();
    const forms = document.querySelectorAll(`[data-job-id="${input.jobId}"][data-application-id]`);
    if (forms.length !== 1) throw new Error("Application identity changed.");
    if ([...forms[0]!.querySelectorAll("*")].some((element) => element.shadowRoot))
      throw new Error("Custom controls require manual review.");
    const found = [...forms[0]!.querySelectorAll("input,select,textarea")];
    if (found.length !== 5) throw new Error("Unexpected questions or controls need review.");
    const result = {} as Record<keyof PreparationAnswers, HTMLInputElement | HTMLSelectElement>;
    for (const [key, label] of Object.entries(labels) as [keyof PreparationAnswers, string][]) {
      const matches = found.filter((element) => element.getAttribute("name") === key);
      const element = matches[0];
      if (
        matches.length !== 1 ||
        !(element instanceof HTMLInputElement || element instanceof HTMLSelectElement) ||
        element.disabled ||
        !element.required ||
        !element.getClientRects().length ||
        element.labels?.length !== 1 ||
        element.labels[0]?.textContent?.trim() !== label
      )
        throw new Error("Form structure changed. Review the fields manually.");
      if (
        element instanceof HTMLInputElement &&
        (element.readOnly || element.type !== (key === "email" ? "email" : "text"))
      )
        throw new Error("Unsupported input control.");
      if (key === "workArrangement" && !(element instanceof HTMLSelectElement))
        throw new Error("Unsupported work-arrangement control.");
      if (
        element instanceof HTMLSelectElement &&
        ![...element.options].some(
          (option) => option.value === input.answers[key] && !option.disabled,
        )
      )
        throw new Error("Reviewed option unavailable.");
      if (element.value && element.value !== input.answers[key])
        throw new Error("Existing page values require manual review; nothing is overwritten.");
      result[key] = element;
    }
    return result;
  }
  controls();
  for (const key of Object.keys(labels) as (keyof PreparationAnswers)[]) {
    const element = controls()[key];
    if (element.value === input.answers[key]) continue;
    element.scrollIntoView({ block: "center" });
    const rect = element.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (top !== element && !element.contains(top))
      throw new Error("A page overlay requires manual review.");
    const prototype =
      element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, input.answers[key]);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  const final = controls();
  if (
    Object.entries(final).some(
      ([key, element]) =>
        element.value !== input.answers[key as keyof PreparationAnswers] ||
        !element.checkValidity(),
    )
  )
    throw new Error("The page did not retain valid reviewed answers.");
  return { prepared: true };
}
