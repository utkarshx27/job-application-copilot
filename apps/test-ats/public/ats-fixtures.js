for (const input of document.querySelectorAll("input[type='file']")) {
  input.addEventListener("change", () => {
    const output = document.getElementById(`${input.id}-output`);
    if (output) output.textContent = input.files?.[0]?.name ?? "No résumé selected";
  });
}
