// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import { applyFillPlan, highlightFields, installUserEditTracking } from "../src/form-driver";

describe("reviewed form driver", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    installUserEditTracking(document);
  });

  it("uses bubbling input/change events for text, textarea, select, radio, and checkbox", () => {
    document.body.innerHTML = `
      <input id="given" />
      <textarea id="cover"></textarea>
      <select id="country"><option value="">Choose</option><option value="IN">India</option></select>
      <label><input id="sponsor-no" type="radio" name="sponsor" value="no" /> No</label>
      <label><input id="consent" type="checkbox" /> Consent</label>`;
    const changes: string[] = [];
    document.body.addEventListener("input", (event) =>
      changes.push((event.target as HTMLElement).id),
    );

    const result = applyFillPlan(
      {
        analysisId: "analysis-1",
        items: [
          {
            fieldId: "given",
            canonicalQuestion: "IDENTITY.legal_name.given",
            operation: { kind: "text", value: "Priya" },
          },
          {
            fieldId: "cover",
            canonicalQuestion: "APPLICATION.cover_letter",
            operation: { kind: "text", value: "Hello" },
          },
          {
            fieldId: "country",
            canonicalQuestion: "ADDRESS.country",
            operation: { kind: "select", value: "IN" },
          },
          {
            fieldId: "sponsor-no",
            canonicalQuestion: "WORK_AUTH.current_sponsorship",
            operation: { kind: "check", checked: true },
          },
          {
            fieldId: "consent",
            canonicalQuestion: "CONSENT.terms",
            operation: { kind: "check", checked: true },
          },
        ],
      },
      document,
    );

    expect((document.getElementById("given") as HTMLInputElement).value).toBe("Priya");
    expect((document.getElementById("cover") as HTMLTextAreaElement).value).toBe("Hello");
    expect((document.getElementById("country") as HTMLSelectElement).value).toBe("IN");
    expect((document.getElementById("sponsor-no") as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById("consent") as HTMLInputElement).checked).toBe(true);
    expect(changes).toEqual(["given", "cover", "country", "sponsor-no", "consent"]);
    expect(result.filledFieldIds).toHaveLength(5);
  });

  it("protects a field after a user-like edit event", () => {
    document.body.innerHTML = `<input id="email" type="email" />`;
    const email = document.getElementById("email") as HTMLInputElement;
    email.value = "user@example.test";
    email.dispatchEvent(new Event("input", { bubbles: true }));

    const result = applyFillPlan(
      {
        analysisId: "analysis-2",
        items: [
          {
            fieldId: "email",
            canonicalQuestion: "CONTACT.email",
            operation: { kind: "text", value: "profile@example.test" },
          },
        ],
      },
      document,
    );

    expect(email.value).toBe("user@example.test");
    expect(result.filledFieldIds).toEqual([]);
    expect(result.skipped[0]?.reason).toContain("user edit");
  });

  it("highlights only requested visible controls", () => {
    document.body.innerHTML = `<input id="given" /><input id="email" type="email" />`;
    const result = highlightFields(["email", "missing"], document);
    expect(result.highlightedFieldIds).toEqual(["email"]);
    expect(document.getElementById("email")?.getAttribute("data-job-copilot-highlight")).toBe(
      "true",
    );
    expect(document.getElementById("given")?.hasAttribute("data-job-copilot-highlight")).toBe(
      false,
    );
  });

  it("refuses to operate a role-based custom component", () => {
    document.body.innerHTML = `<input id="office" role="combobox" aria-label="Office" />`;
    const result = applyFillPlan(
      {
        analysisId: "analysis-custom",
        items: [
          {
            fieldId: "office",
            canonicalQuestion: "ADDRESS.country",
            operation: { kind: "text", value: "IN" },
          },
        ],
      },
      document,
    );
    expect(result.filledFieldIds).toEqual([]);
    expect(result.skipped[0]?.reason).toContain("manual completion");
  });
});
