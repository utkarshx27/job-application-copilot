const ats = document.body.dataset.ats;
const configs = {
  icims: {
    title: "Backend Engineer",
    jobId: "9101",
    first: "firstName",
    last: "lastName",
    email: "emailAddress",
    phone: "phoneNumber",
    linkedin: "linkedinUrl",
    resume: "resumeFile",
  },
  taleo: {
    title: "Systems Engineer",
    jobId: "9201",
    first: "firstName",
    last: "lastName",
    email: "email",
    phone: "phone",
    linkedin: "linkedinUrl",
    resume: "resumeUpload",
  },
  workable: {
    title: "Product Engineer",
    jobId: "W9301",
    first: "firstName",
    last: "lastName",
    email: "email",
    phone: "phone",
    linkedin: "linkedinUrl",
    resume: "resumeFile",
  },
  bamboohr: {
    title: "QA Engineer",
    jobId: "9401",
    first: "firstName",
    last: "lastName",
    email: "email",
    phone: "phoneNumber",
    linkedin: "linkedinUrl",
    resume: "resume",
  },
  jobvite: {
    title: "Frontend Engineer",
    jobId: "J9501",
    first: "firstName",
    last: "lastName",
    email: "email",
    phone: "phone",
    linkedin: "linkedinUrl",
    resume: "resume",
  },
  comeet: {
    title: "Platform Engineer",
    jobId: "C9601",
    first: "first_name",
    last: "last_name",
    email: "email",
    phone: "mobile_phone",
    linkedin: "linkedin_url",
    resume: "resume_file",
  },
};
const config = configs[ats];
if (!config) throw new Error("Unknown Phase 9 fixture");

const meta = (name, content) => {
  const element = document.createElement("meta");
  element.name = name;
  element.content = content;
  document.head.append(element);
};
meta("copilot-ats", ats);
meta("copilot-company", "Example Labs");
meta("copilot-requisition-id", config.jobId);
meta("description", `Build safe products in the ${config.title} role.`);

const jsonLd = document.createElement("script");
jsonLd.type = "application/ld+json";
jsonLd.textContent = JSON.stringify({
  "@type": "JobPosting",
  title: config.title,
  description: `Build safe products in the ${config.title} role.`,
  identifier: { value: config.jobId },
  hiringOrganization: { name: "Example Labs" },
  jobLocation: { address: { addressLocality: "Remote", addressRegion: "India" } },
  employmentType: "FullTime",
});
document.head.append(jsonLd);
document.title = `${config.title} — Example Labs`;

document.body.dataset.jobId = config.jobId;
document.body.innerHTML = `
  <header data-${ats}-job>
    <span class="company" data-company-name>Example Labs · ${ats.toUpperCase()} fixture</span>
    <h1 data-job-title>${config.title}</h1>
    <p data-job-location>Remote · India</p>
    <span data-workplace-type>Remote</span>
  </header>
  <main>
    <section>
      <p class="eyebrow">Controlled Phase 9 Test ATS</p>
      <h2>Apply for this role</h2>
      <p data-job-description>Build safe products in the ${config.title} role.</p>
      <form novalidate>
        <div class="field"><label for="${ats}-first">First name</label><input id="${ats}-first" name="${config.first}" required></div>
        <div class="field"><label for="${ats}-last">Last name</label><input id="${ats}-last" name="${config.last}" required></div>
        <div class="field"><label for="${ats}-email">Email</label><input id="${ats}-email" name="${config.email}" type="email" required></div>
        <div class="field"><label for="${ats}-phone">Phone</label><input id="${ats}-phone" name="${config.phone}" type="tel"></div>
        <div class="field"><label for="${ats}-linkedin">LinkedIn URL</label><input id="${ats}-linkedin" name="${config.linkedin}" type="url"></div>
        <div class="field"><label for="${ats}-resume">Résumé</label><input id="${ats}-resume" name="${config.resume}" type="file" accept=".pdf,.docx" required><output id="${ats}-resume-output">No résumé selected</output></div>
        <div class="field"><span id="${ats}-team-label">Preferred team</span><input id="${ats}-team" role="combobox" aria-labelledby="${ats}-team-label" aria-controls="${ats}-team-options"><div id="${ats}-team-options" role="listbox" hidden><div role="option" data-value="platform">Platform</div><div role="option" data-value="product">Product</div></div></div>
        <div class="field"><label for="${ats}-custom">Why are you interested in this role?</label><textarea id="${ats}-custom" name="custom_question_${config.jobId}"></textarea></div>
        <button type="button" disabled>Submit disabled in Test ATS</button>
      </form>
    </section>
  </main>`;

document.getElementById(`${ats}-resume`).addEventListener("change", (event) => {
  const input = event.currentTarget;
  document.getElementById(`${ats}-resume-output`).textContent =
    input.files?.[0]?.name ?? "No résumé selected";
});
