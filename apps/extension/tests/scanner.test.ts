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
    });
    expect(snapshot.fields[1]?.options).toEqual([{ value: "IN", text: "India", disabled: false }]);
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
});
