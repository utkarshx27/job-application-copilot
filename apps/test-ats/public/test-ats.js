const sponsorshipControls = document.querySelectorAll("input[name='current_sponsorship']");
const visaDetails = document.getElementById("visa-details");
const visaType = document.getElementById("visa-type");

for (const control of sponsorshipControls) {
  control.addEventListener("change", () => {
    const requiresSponsorship = control.value === "yes" && control.checked;
    visaDetails.hidden = !requiresSponsorship;
    visaType.required = requiresSponsorship;
  });
}
