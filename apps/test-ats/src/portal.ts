import type {
  ApplicationReceipt,
  CompanyEvidence,
  PortalField,
  PortalListing,
  PublicScenario,
} from "./portal-contract";

const root = document.querySelector<HTMLElement>("#portal-root");
if (!root) throw new Error("Portal root missing");
const container: HTMLElement = root;
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}
function button(text: string, action: () => void) {
  const result = node("button", text);
  result.type = "button";
  result.addEventListener("click", action);
  return result;
}
async function api<T>(path: string, input?: unknown): Promise<T> {
  const response = await fetch(
    path,
    input === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
  );
  const result: unknown = await response.json();
  if (!response.ok) {
    const problem = result as { error?: string; errors?: string[] };
    throw new Error(problem.errors?.join("; ") ?? problem.error ?? "Request failed");
  }
  return result as T;
}
function message(target: HTMLElement, text: string, role = "status") {
  const element = node("p", text);
  element.setAttribute("role", role);
  target.append(element);
  return element;
}
function internalLink(path: string): string | null {
  const url = new URL(path, location.origin);
  return url.origin === location.origin &&
    ["/portal.html", "/portal-frame.html"].includes(url.pathname)
    ? url.href
    : null;
}

async function companyEvidence(target: HTMLElement) {
  const companies = await api<CompanyEvidence[]>("/api/portal/companies");
  target.append(node("h2", "Company evidence — demo data"));
  for (const company of companies) {
    const card = node("article");
    card.append(
      node("h3", `${company.name} · ${company.location}`),
      node("p", `Company identity: ${company.id}`),
    );
    for (const rating of company.ratings)
      card.append(
        node(
          "p",
          `${rating.source}: ${rating.value === null ? "Rating unavailable" : `${rating.value}/${rating.scale}`} · ${rating.count} reviews · Retrieved ${rating.retrievedAt}`,
        ),
      );
    target.append(card);
  }
  target.append(
    node(
      "p",
      "These are different employers with the same name. A missing rating is unknown; small or stale samples have less evidence.",
    ),
  );
}

async function gallery(scenarios: PublicScenario[]) {
  container.append(
    node("h1", "Demo job portals"),
    node("p", "Synthetic jobs, companies, and application flows for local testing."),
  );
  const search = node("section");
  search.setAttribute("aria-label", "Job search");
  const label = node("label", "Search jobs");
  const query = node("input");
  query.type = "search";
  label.append(query);
  const results = node("div");
  let page = 0;
  async function load() {
    try {
      const response = await api<{ jobs: PortalListing[]; hasMore: boolean }>(
        `/api/portal/jobs?q=${encodeURIComponent(query.value)}&page=${page}`,
      );
      results.replaceChildren();
      for (const job of response.jobs) {
        const card = node("article");
        card.append(
          node("h3", job.title),
          node("p", `${job.company} · ${job.location}`),
          node("p", `Job identity: ${job.id}`),
          node(
            "p",
            job.salary
              ? `${job.salary.amount} ${job.salary.currency}/${job.salary.period}`
              : "Salary unavailable",
          ),
        );
        const target = job.destination && internalLink(job.destination);
        if (target && !job.expired) {
          const link = node("a", "Open local application");
          link.href = target;
          card.append(link);
        } else card.append(node("p", job.expired ? "Job expired" : "Employer handoff unavailable"));
        results.append(card);
      }
      next.disabled = !response.hasMore;
      previous.disabled = page === 0;
    } catch (error) {
      message(results, error instanceof Error ? error.message : "Search unavailable", "alert");
    }
  }
  const next = button("Next results", () => {
    page++;
    void load();
  });
  const previous = button("Previous results", () => {
    page--;
    void load();
  });
  search.append(
    label,
    button("Search", () => {
      page = 0;
      void load();
    }),
    results,
    previous,
    next,
  );
  container.append(search);
  await load();
  const list = node("section");
  list.append(node("h2", "Application scenarios"));
  for (const scenario of scenarios) {
    const item = node("p");
    const link = node("a", scenario.title);
    link.href = `/portal.html?scenario=${scenario.id}`;
    item.append(link);
    list.append(item);
  }
  container.append(list);
  await companyEvidence(container);
}

async function selectedJob(seed: number): Promise<PortalListing> {
  const values = new URLSearchParams(location.search).getAll("jobId");
  if (values.length > 1) throw new Error("Ambiguous job identity");
  const id = values[0] ?? `job-${seed}-0`;
  if (!/^job-\d+-\d+$/.test(id)) throw new Error("Invalid job identity");
  const job = await api<PortalListing>(`/api/portal/jobs/${id}`);
  if (job.id !== id) throw new Error("Job identity changed");
  if (job.expired || !job.destination) throw new Error("Application unavailable for this job");
  return job;
}

async function application(scenario: PublicScenario, target: HTMLElement, jobId: string) {
  if (scenario.delayMs) {
    const pending = message(target, "Loading application controls…");
    await new Promise((resolve) => setTimeout(resolve, scenario.delayMs));
    pending.remove();
  }
  const started = await api<{ applicationId: string; jobId: string }>("/api/portal/start", {
    scenarioId: scenario.id,
    jobId,
  });
  target.dataset.applicationId = started.applicationId;
  target.dataset.jobId = started.jobId;
  const endpoint = `/api/portal/applications/${started.applicationId}`;
  const progress = node("h2", "Step 1 of 3: Contact and preferences");
  target.append(progress);
  const editor = node("section");
  const review = node("section");
  review.hidden = true;
  const feedback = node("div");
  feedback.setAttribute("aria-live", "polite");
  const getters = new Map<string, () => string>();
  let selectedFile: File | undefined;
  let uploadId: string | undefined;
  let step = 1;
  function control(field: PortalField, holder: HTMLElement | ShadowRoot) {
    const label = node("label", field.label);
    const identity = `control-${scenario.seed}-${field.key}`;
    label.htmlFor = identity;
    if (scenario.mode === "COMBOBOX" && field.kind === "select") {
      let selection = "";
      const list = node("div");
      list.setAttribute("role", "listbox");
      list.id = `${identity}-options`;
      list.hidden = true;
      const chooser = button("Choose an option", () => {
        list.hidden = !list.hidden;
        chooser.setAttribute("aria-expanded", String(!list.hidden));
      });
      chooser.id = identity;
      chooser.setAttribute("role", "combobox");
      chooser.setAttribute("aria-label", field.label);
      chooser.setAttribute("aria-controls", list.id);
      chooser.setAttribute("aria-expanded", "false");
      for (const option of field.options ?? []) {
        const item = button(option, () => {
          selection = option;
          chooser.textContent = option;
          list.hidden = true;
          chooser.setAttribute("aria-expanded", "false");
        });
        item.setAttribute("role", "option");
        list.append(item);
      }
      getters.set(field.key, () => selection);
      holder.append(label, chooser, list);
      return;
    }
    const input = field.kind === "select" ? node("select") : node("input");
    input.id = identity;
    input.name = scenario.mode === "LABELLED" ? `renamed-${scenario.seed}-${field.key}` : field.key;
    input.required = field.required;
    if (input instanceof HTMLSelectElement) {
      input.append(node("option", ""));
      for (const option of field.options ?? []) {
        const item = node("option", option);
        item.value = option;
        input.append(item);
      }
    } else {
      input.type = field.kind;
      if (field.kind === "file") {
        input.accept = ".pdf,.docx,.txt";
        input.addEventListener("change", () => {
          selectedFile = input.files?.[0];
          uploadId = undefined;
        });
      }
    }
    let active = input;
    if (scenario.replaceOnFocus && field.key === "name")
      input.addEventListener(
        "focus",
        () => {
          const replacement = input.cloneNode(true) as HTMLInputElement;
          replacement.name = "layout-changed-name";
          input.replaceWith(replacement);
          active = replacement;
          replacement.focus();
        },
        { once: true },
      );
    getters.set(field.key, () => active.value);
    holder.append(label, input);
  }
  let holder: HTMLElement | ShadowRoot = editor;
  if (scenario.mode === "SHADOW" || scenario.mode === "CLOSED_SHADOW") {
    const host = node("div");
    host.setAttribute("aria-label", "Application fields");
    editor.append(host);
    holder = host.attachShadow({ mode: scenario.mode === "SHADOW" ? "open" : "closed" });
    const styles = node("link");
    styles.rel = "stylesheet";
    styles.href = "/portal.css";
    holder.append(styles);
  }
  const contactFields = node("div");
  const screeningFields = node("div");
  screeningFields.hidden = true;
  holder.append(contactFields, screeningFields);
  scenario.fields.forEach((field, index) =>
    control(field, index < 5 ? contactFields : screeningFields),
  );
  if (scenario.fields.length <= 5)
    screeningFields.append(
      node("p", "No additional screening questions. Continue to review your answers."),
    );
  if (scenario.repeatHistory) {
    const history = node("section");
    const occupiedRows = new Set<number>();
    editor.append(
      button("Add work history", () => {
        if (occupiedRows.size >= 2) return;
        const index = occupiedRows.has(0) ? 1 : 0;
        occupiedRows.add(index);
        const row = node("div");
        const key = index === 0 ? "employer" : "previousEmployer";
        control({ key, label: `Employer ${index + 1}`, kind: "text", required: true }, row);
        row.append(
          button("Remove history row", () => {
            getters.delete(key);
            row.remove();
            occupiedRows.delete(index);
          }),
        );
        history.append(row);
      }),
      history,
    );
  }
  const next = button("Next step", () => {
    if (step === 1) {
      step = 2;
      contactFields.hidden = true;
      screeningFields.hidden = false;
      progress.textContent = "Step 2 of 3: Screening and documents";
      message(feedback, "Review the answers and documents before continuing.");
      next.textContent = "Review application";
      return;
    }
    void prepareReview();
  });
  async function prepareReview() {
    next.disabled = true;
    feedback.replaceChildren();
    try {
      if (selectedFile && !uploadId) {
        const bytes = new Uint8Array(await selectedFile.arrayBuffer());
        if (bytes.length > 500_000) throw new Error("Use a synthetic document under 500 KB");
        let binary = "";
        bytes.forEach((byte) => {
          binary += String.fromCharCode(byte);
        });
        const uploaded = await api<{ uploadId: string }>(`${endpoint}/upload`, {
          content: btoa(binary),
        });
        uploadId = uploaded.uploadId;
      }
      const values = Object.fromEntries(
        [...getters].filter(([key]) => key !== "resume").map(([key, get]) => [key, get()]),
      );
      const result = await api<{
        values: Record<string, string>;
        uploadRetained: boolean;
        uploadSha256: string | null;
      }>(`${endpoint}/review`, { values });
      progress.textContent = "Step 3 of 3: Review";
      editor.hidden = true;
      next.hidden = true;
      review.hidden = false;
      review.replaceChildren(node("h3", "Review your application"));
      const details = node("dl");
      for (const [key, value] of Object.entries(result.values))
        details.append(
          node("dt", scenario.fields.find((field) => field.key === key)?.label ?? "Employer"),
          node("dd", value),
        );
      review.append(details);
      if (result.uploadRetained) {
        const retained = node("p", "Resume retained for this application");
        retained.dataset.uploadSha256 = result.uploadSha256 ?? "";
        review.append(retained);
      }
      const consentLabel = node("label", "I approve this synthetic application");
      const consent = node("input");
      consent.type = "checkbox";
      consentLabel.prepend(consent);
      review.append(consentLabel);
      const submit = button("Submit local application", () => {
        void finish(submit, consent.checked);
      });
      submit.disabled = true;
      consent.addEventListener("change", () => {
        submit.disabled = !consent.checked;
      });
      review.append(
        submit,
        button("Back to answers", () => {
          step = 1;
          contactFields.hidden = false;
          screeningFields.hidden = true;
          review.hidden = true;
          editor.hidden = false;
          next.hidden = false;
          next.textContent = "Next step";
          progress.textContent = "Step 1 of 3: Contact and preferences";
        }),
      );
    } catch (error) {
      message(
        feedback,
        error instanceof Error ? error.message : "Could not review application",
        "alert",
      );
    } finally {
      next.disabled = false;
    }
  }
  async function finish(submit: HTMLButtonElement, consent: boolean) {
    submit.disabled = true;
    feedback.replaceChildren();
    try {
      const receipt = await api<ApplicationReceipt>(`${endpoint}/submit`, { consent });
      message(feedback, `Application received: ${receipt.applicationId}`);
      feedback.dataset.receiptId = receipt.applicationId;
      feedback.dataset.receiptJob = receipt.jobId;
    } catch {
      message(
        feedback,
        "Submission outcome could not be verified. Do not submit again; check the application receipt.",
        "alert",
      );
    }
    review.querySelectorAll("button, input").forEach((element) => {
      if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement)
        element.disabled = true;
    });
  }
  target.append(editor, next, review, feedback);
}

async function main() {
  const scenarios = await api<PublicScenario[]>("/api/portal/scenarios");
  const id = new URLSearchParams(location.search).get("scenario");
  if (!id) {
    await gallery(scenarios);
    return;
  }
  const scenario = scenarios.find((item) => item.id === id);
  if (!scenario) throw new Error("Unknown scenario");
  const params = new URLSearchParams(location.search);
  const job = await selectedJob(scenario.seed);
  if (location.pathname === "/portal-frame.html") {
    if (params.get("nested") === "1") {
      const frame = node("iframe");
      frame.title = "Nested application";
      frame.src = `/portal-frame.html?scenario=${scenario.id}&jobId=${encodeURIComponent(job.id)}`;
      container.append(frame);
    } else await application(scenario, container, job.id);
    return;
  }
  container.append(
    node("h1", scenario.title),
    node("p", "Demo only · original synthetic content · no real applications"),
    node("h2", `${job.title} at ${job.company}`),
    node("p", `${job.location} · Job ${job.id}`),
  );
  if (scenario.evidenceOnly) {
    await companyEvidence(container);
    return;
  }
  if (scenario.access !== "AVAILABLE") {
    message(
      container,
      scenario.access === "LOGIN_REQUIRED"
        ? "Your session expired. Sign in to continue."
        : "Please complete the access check manually.",
      "alert",
    );
    return;
  }
  if (!scenario.applicationAvailable) {
    message(
      container,
      "Employer handoff unavailable. This demo keeps navigation inside the local portal.",
    );
    return;
  }
  const apply = button("Apply locally", () => {
    apply.disabled = true;
    if (scenario.mode === "FRAME" || scenario.mode === "NESTED_FRAME") {
      const frame = node("iframe");
      frame.title = "Application form";
      frame.src = `/portal-frame.html?scenario=${scenario.id}&jobId=${encodeURIComponent(job.id)}${scenario.mode === "NESTED_FRAME" ? "&nested=1" : ""}`;
      container.append(frame);
      return;
    }
    const target = scenario.modal ? node("dialog") : node("section");
    target.setAttribute("aria-label", "Local application");
    container.append(target);
    if (target instanceof HTMLDialogElement) {
      target.showModal();
      target.addEventListener("cancel", () => {
        target.remove();
        apply.disabled = false;
      });
    }
    void application(scenario, target, job.id).catch((error: unknown) => {
      message(target, error instanceof Error ? error.message : "Application unavailable", "alert");
    });
  });
  container.append(apply);
}
void main().catch((error: unknown) =>
  message(container, error instanceof Error ? error.message : "Demo unavailable", "alert"),
);
