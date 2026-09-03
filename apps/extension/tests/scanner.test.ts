// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import { scanVisibleForm } from "../src/scanner";

describe("scanVisibleForm", () => {
  beforeEach(() => {
    document.title = "Application";
    document.body.innerHTML = "";
  });

  it("extracts accessible labels, required state, and select options", () => {
    document.body.innerHTML = `
      <form>
        <label for="full-name">Full name</label>
        <input id="full-name" name="name" required />
        <label>Country
          <select name="country"><option value="IN">India</option></select>
        </label>
      </form>`;

    const snapshot = scanVisibleForm();
    expect(snapshot.fields).toHaveLength(2);
    expect(snapshot.fields[0]).toMatchObject({
      fieldId: "full-name",
      accessibleName: "Full name",
      required: true,
      valueState: "EMPTY",
    });
    expect(snapshot.fields[1]?.options).toEqual([{ value: "IN", text: "India", disabled: false }]);
  });

  it("records only the presence of parsed values and Workday automation IDs", () => {
    document.body.innerHTML = `
      <label for="company">Company</label>
      <input id="company" data-automation-id="workExperience-1-company" value="Private value is not captured" />`;
    expect(scanVisibleForm().fields[0]).toMatchObject({
      automationId: "workExperience-1-company",
      valueState: "PREFILLED",
    });
    expect(JSON.stringify(scanVisibleForm())).not.toContain("Private value is not captured");
  });

  it("never includes password, hidden, or visually hidden controls", () => {
    document.body.innerHTML = `
      <input type="password" name="password" />
      <input type="hidden" name="csrf" />
      <input name="secret" style="display:none" />
      <input name="email" type="email" aria-label="Email" />`;

    const snapshot = scanVisibleForm();
    expect(snapshot.fields.map((field) => field.name)).toEqual(["email"]);
  });

  it("uses aria-labelledby before placeholder or machine names", () => {
    document.body.innerHTML = `
      <span id="phone-label">Mobile phone</span>
      <input type="tel" name="phone_number" aria-labelledby="phone-label" placeholder="+91" />`;

    expect(scanVisibleForm().fields[0]?.accessibleName).toBe("Mobile phone");
  });

  it("creates unique IDs for radio controls that share a name", () => {
    document.body.innerHTML = `
      <label><input type="radio" name="authorized" value="yes" /> Yes</label>
      <label><input type="radio" name="authorized" value="no" /> No</label>`;

    expect(scanVisibleForm().fields.map((field) => field.fieldId)).toEqual([
      "authorized",
      "authorized-2",
    ]);
    expect(scanVisibleForm().fields[0]).toMatchObject({
      groupLabel: "",
      optionValue: "yes",
      checked: false,
      userEdited: false,
    });
  });

  it("captures fieldset context and user-edit protection state", () => {
    document.body.innerHTML = `
      <fieldset>
        <legend>Will you require sponsorship?</legend>
        <label><input id="sponsor" type="radio" value="yes" data-job-copilot-user-edited="true" checked /> Yes</label>
      </fieldset>`;
    expect(scanVisibleForm().fields[0]).toMatchObject({
      groupLabel: "Will you require sponsorship?",
      optionValue: "yes",
      checked: true,
      userEdited: true,
    });
  });

  it("captures Lever custom-question context without option text", () => {
    document.body.innerHTML = `
      <li class="application-question custom-question">
        <div>
          Which university did you attend?
          <div class="application-field full-width required-field">
            <select name="cards[example][field0]"><option>Example University</option></select>
          </div>
        </div>
      </li>`;

    expect(scanVisibleForm().fields[0]).toMatchObject({
      accessibleName: "cards[example][field0]",
      groupLabel: "Which university did you attend?",
    });
  });

  it("captures ARIA custom components as visible manual-only controls", () => {
    document.body.innerHTML = `
      <label id="location-label">Preferred office</label>
      <input
        id="office-combobox"
        role="combobox"
        aria-labelledby="location-label"
        aria-controls="office-options"
        aria-required="true"
      />
      <div id="office-options" role="listbox">
        <div role="option" data-value="blr">Bengaluru</div>
        <div role="option" data-value="remote" aria-disabled="true">Remote</div>
      </div>`;

    const fields = scanVisibleForm().fields;
    expect(fields[0]).toMatchObject({
      fieldId: "office-combobox",
      controlKind: "other",
      accessibleName: "Preferred office",
      required: true,
      options: [
        { value: "blr", text: "Bengaluru", disabled: false },
        { value: "remote", text: "Remote", disabled: true },
      ],
    });
    expect(fields).toHaveLength(1);
  });

  it("discovers controls in same-origin embedded application frames", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const frameDocument = frame.contentDocument;
    expect(frameDocument).not.toBeNull();
    frameDocument!.body.innerHTML = `
      <label for="embedded-first-name">First name</label>
      <input id="embedded-first-name" name="firstName" required />`;

    expect(scanVisibleForm().fields).toEqual([
      expect.objectContaining({
        fieldId: "embedded-first-name",
        accessibleName: "First name",
        controlKind: "text",
      }),
    ]);
  });

  it("discovers controls in open component roots", () => {
    const host = document.createElement("job-application-field");
    document.body.append(host);
    host.attachShadow({ mode: "open" }).innerHTML = `
      <input id="component-email" name="email" type="email" aria-label="Email" />`;

    expect(scanVisibleForm().fields).toEqual([
      expect.objectContaining({
        fieldId: "component-email",
        accessibleName: "Email",
        controlKind: "email",
      }),
    ]);
  });
});
