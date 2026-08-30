for (const input of document.querySelectorAll("input[type='file']")) {
  input.addEventListener("change", () => {
    const output = document.getElementById(`${input.id}-output`);
    if (output) output.textContent = input.files?.[0]?.name ?? "No résumé selected";
  });
}

for (const control of document.querySelectorAll("[data-reveal-target]")) {
  const update = () => {
    const target = document.getElementById(control.getAttribute("data-reveal-target") ?? "");
    if (target) target.hidden = !("value" in control && control.value);
  };
  control.addEventListener("change", update);
  update();
}
