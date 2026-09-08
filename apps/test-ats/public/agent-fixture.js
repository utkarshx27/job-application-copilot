const form = document.querySelector("#agent-form");
const combo = document.querySelector("[role=combobox]");
const list = document.querySelector("#locations");
const search = document.querySelector("[data-agent-field=locationQuery]");
const filterLocations = () => {
  for (const option of list.querySelectorAll("[role=option]"))
    option.hidden =
      !search.value || !option.textContent.toLowerCase().includes(search.value.toLowerCase());
};
search.addEventListener("input", filterLocations);
filterLocations();
combo.addEventListener("click", () => {
  list.hidden = false;
  combo.setAttribute("aria-expanded", "true");
});
for (const option of list.querySelectorAll("[role=option]"))
  option.addEventListener("click", () => {
    combo.value = option.dataset.value;
    combo.dispatchEvent(new Event("input", { bubbles: true }));
    combo.dispatchEvent(new Event("change", { bubbles: true }));
    combo.setAttribute("aria-expanded", "false");
    list.hidden = true;
  });
const rows = document.querySelector("#rows");
document.querySelector("#add-row").addEventListener("click", () => {
  if (rows.children.length >= 3) return;
  const row = document.createElement("div");
  row.dataset.experienceRow = "";
  const label = document.createElement("label");
  label.textContent = "Employer";
  const input = document.createElement("input");
  input.required = true;
  input.setAttribute("aria-label", "Employer");
  input.dataset.agentField = "employer";
  label.append(input);
  row.append(label);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Remove empty experience";
  remove.dataset.agentField = rows.children.length ? "removeExtra" : "removeOnly";
  remove.addEventListener("click", () => {
    if (!input.value) row.remove();
  });
  row.append(remove);
  rows.append(row);
});
form.querySelector("input[type=file]").addEventListener("change", (event) => {
  document.querySelector("#file-status").textContent = event.target.files[0]?.name ?? "";
});
for (const button of document.querySelectorAll("[data-next]"))
  button.addEventListener("click", () => {
    const section = button.closest("section");
    const valid =
      Array.from(section.querySelectorAll("input,select")).every((x) => x.checkValidity()) &&
      (section.dataset.agentStep !== "experience" || rows.children.length > 0);
    document.querySelector("[data-agent-validation]").hidden = valid;
    if (!valid) return;
    const next = section.nextElementSibling;
    section.hidden = true;
    next.hidden = false;
    if (next.dataset.agentStep === "review")
      document.querySelector("#review-values").textContent = Array.from(
        form.querySelectorAll("input:not([type=file]),select"),
      )
        .map((x) => x.value)
        .join(" · ");
    // Test-runner-selected full-document mode exercises lost navigation replies.
    // Only synthetic demo state is retained on this local origin.
    if (sessionStorage.getItem("agent-multipage") === "true") {
      sessionStorage.setItem("agent-demo-step", next.dataset.agentStep);
      sessionStorage.setItem(
        "agent-demo-values",
        JSON.stringify(
          Array.from(form.querySelectorAll("input:not([type=file]),select")).map((x) => ({
            key: x.dataset.agentField,
            value: x.value,
          })),
        ),
      );
      sessionStorage.setItem("agent-demo-rows", String(rows.children.length));
      location.reload();
    }
  });
form.addEventListener("submit", (event) => event.preventDefault());
if (
  sessionStorage.getItem("agent-multipage") === "true" &&
  sessionStorage.getItem("agent-demo-step")
) {
  const step = sessionStorage.getItem("agent-demo-step");
  if (["experience", "review"].includes(step)) {
    for (let i = 0; i < Math.min(Number(sessionStorage.getItem("agent-demo-rows")) || 0, 3); i++)
      document.querySelector("#add-row").click();
    for (const entry of JSON.parse(sessionStorage.getItem("agent-demo-values") || "[]")) {
      for (const field of form.querySelectorAll("input:not([type=file]),select"))
        if (field.dataset.agentField === entry.key && typeof entry.value === "string")
          field.value = entry.value;
    }
    for (const section of form.querySelectorAll("[data-agent-step]"))
      section.hidden = section.dataset.agentStep !== step;
    document.querySelector("#review-values").textContent =
      "Synthetic multi-page preparation restored.";
  }
}
