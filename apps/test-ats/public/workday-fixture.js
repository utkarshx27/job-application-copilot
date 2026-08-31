const root = document.getElementById("workday-step-root");
const stepMeta = document.querySelector("meta[name='copilot-workday-page']");
const labelMeta = document.querySelector("meta[name='copilot-workday-step-label']");
const indexMeta = document.querySelector("meta[name='copilot-workday-step-index']");
const progressSteps = Array.from(
  document.querySelectorAll("[data-automation-id='progressBarStep']"),
);
const storageKey = "controlled-workday-step";

const steps = [
  {
    type: "MY_INFORMATION",
    label: "My Information",
    html: `
      <section data-workday-section>
        <h1>My Information</h1>
        <h2 data-automation-id="sectionHeading">Contact Information</h2>
        <p class="intro">One email is intentionally prefilled to model résumé/account parsing.</p>
        <form novalidate>
          <div class="grid two-columns">
            <div class="field">
              <label for="wd-first-name">First Name</label>
              <input id="wd-first-name" name="legalNameSection_firstName" data-automation-id="legalNameSection_firstName" autocomplete="given-name" required />
            </div>
            <div class="field">
              <label for="wd-last-name">Last Name</label>
              <input id="wd-last-name" name="legalNameSection_lastName" data-automation-id="legalNameSection_lastName" autocomplete="family-name" required />
            </div>
          </div>
          <div class="field">
            <label for="wd-email">Email Address</label>
            <input id="wd-email" name="email" data-automation-id="email" type="email" autocomplete="email" value="parsed@example.test" required />
          </div>
          <div class="field">
            <label for="wd-phone">Phone Number</label>
            <input id="wd-phone" name="phoneNumber" data-automation-id="phoneNumber" type="tel" autocomplete="tel" />
          </div>
          <div class="field">
            <label for="wd-resume">Resume/CV</label>
            <input id="wd-resume" name="resumeUpload" data-automation-id="file-upload-input-ref" type="file" accept=".pdf,.docx" />
            <output id="wd-resume-output" aria-live="polite">No résumé selected</output>
          </div>
        </form>
      </section>`,
  },
  {
    type: "MY_EXPERIENCE",
    label: "My Experience",
    html: `
      <section data-workday-section>
        <h1>My Experience</h1>
        <p class="intro">The first company is intentionally résumé-parsed and protected.</p>
        <form novalidate>
          <fieldset>
            <legend data-automation-id="sectionHeading">Work Experience</legend>
            <div class="field">
              <label for="wd-company">Company</label>
              <input id="wd-company" name="workExperience-1-company" data-automation-id="workExperience-1-company" value="Parsed Resume Company" required />
            </div>
            <div class="field">
              <label for="wd-job-title">Job Title</label>
              <input id="wd-job-title" name="workExperience-1-jobTitle" data-automation-id="workExperience-1-jobTitle" required />
            </div>
            <div class="field">
              <label for="wd-work-description">Role Description</label>
              <textarea id="wd-work-description" name="workExperience-1-description" data-automation-id="workExperience-1-description"></textarea>
            </div>
          </fieldset>
          <fieldset>
            <legend data-automation-id="sectionHeading">Education</legend>
            <div class="field">
              <label for="wd-school">School or University</label>
              <input id="wd-school" name="education-1-school" data-automation-id="education-1-school" />
            </div>
            <div class="field">
              <label for="wd-degree">Degree</label>
              <input id="wd-degree" name="education-1-degree" data-automation-id="education-1-degree" />
            </div>
            <div class="field">
              <label for="wd-field-study">Field of Study</label>
              <input id="wd-field-study" name="education-1-fieldOfStudy" data-automation-id="education-1-fieldOfStudy" />
            </div>
          </fieldset>
          <div class="field">
            <span id="wd-skills-label">Skills</span>
            <input id="wd-skills" name="skills" data-automation-id="skills" role="combobox" aria-labelledby="wd-skills-label" aria-controls="wd-skills-options" />
            <div id="wd-skills-options" role="listbox" aria-label="Suggested skills">
              <div role="option" data-value="typescript">TypeScript</div>
              <div role="option" data-value="accessibility">Accessibility</div>
            </div>
          </div>
        </form>
      </section>`,
  },
  {
    type: "APPLICATION_QUESTIONS",
    label: "Application Questions",
    html: `
      <section data-workday-section>
        <h1>Application Questions</h1>
        <h2 data-automation-id="sectionHeading">Role Questionnaire</h2>
        <form novalidate>
          <div class="field">
            <label for="wd-production">Have you supported production systems?</label>
            <select id="wd-production" name="questionnaire-production" data-reveal-target="wd-production-detail" required>
              <option value="">Choose one</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
          <div class="field" id="wd-production-detail" hidden>
            <label for="wd-project">Describe a relevant project</label>
            <textarea id="wd-project" name="questionnaire-project" data-automation-id="questionnaire-project"></textarea>
          </div>
        </form>
      </section>`,
  },
  {
    type: "REVIEW",
    label: "Review",
    html: `
      <section data-workday-section>
        <h1>Review</h1>
        <h2 data-automation-id="sectionHeading">Review Your Application</h2>
        <p>Review every section before submitting. Submission is disabled in this fixture.</p>
      </section>`,
  },
];

function attachDynamicBehavior() {
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
}

function renderStep(index) {
  const safeIndex = Math.max(0, Math.min(index, steps.length - 1));
  const step = steps[safeIndex];
  sessionStorage.setItem(storageKey, String(safeIndex));
  stepMeta?.setAttribute("content", step.type);
  labelMeta?.setAttribute("content", step.label);
  indexMeta?.setAttribute("content", String(safeIndex + 1));
  progressSteps.forEach((item, itemIndex) => {
    if (itemIndex === safeIndex) {
      item.setAttribute("aria-current", "step");
      item.setAttribute("data-active", "true");
    } else {
      item.removeAttribute("aria-current");
      item.removeAttribute("data-active");
    }
  });
  root.innerHTML = `${step.html}
    <nav class="workday-navigation" aria-label="Workday fixture navigation">
      ${safeIndex > 0 ? '<button type="button" data-automation-id="bottom-navigation-back-button">Back</button>' : ""}
      ${safeIndex < steps.length - 1 ? '<button type="button" data-automation-id="bottom-navigation-next-button">Next</button>' : '<button type="button" data-automation-id="submit" disabled>Submit disabled in Test ATS</button>'}
    </nav>`;
  root
    .querySelector("[data-automation-id='bottom-navigation-back-button']")
    ?.addEventListener("click", () => renderStep(safeIndex - 1));
  root
    .querySelector("[data-automation-id='bottom-navigation-next-button']")
    ?.addEventListener("click", () => renderStep(safeIndex + 1));
  attachDynamicBehavior();
}

const restoredStep = Number(sessionStorage.getItem(storageKey) ?? "0");
renderStep(Number.isInteger(restoredStep) ? restoredStep : 0);
