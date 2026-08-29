// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import type { RawField } from "@copilot/form-schema";

import { greenhouseAdapter } from "../src/index";

function page(markup: string, path = "/greenhouse.html") {
  window.history.replaceState({}, "", path);
  document.head.innerHTML = "";
  document.body.innerHTML = markup;
}

describe("Greenhouse adapter", () => {
  it("detects, extracts, maps, and confirms sanitized Greenhouse pages", () => {
    page(`
      <meta name="copilot-ats" content="greenhouse">
      <meta name="copilot-company" content="ExampleCo">
      <meta name="copilot-requisition-id" content="GH-100">
      <h1 class="app-title">Platform Engineer</h1>
      <p class="location">Remote · India</p>
      <div id="content">Build reliable systems.</div>
      <form id="application_form"></form>
      <section class="application-confirmation"><h2>Thank you, your application was received</h2></section>
      <span data-confirmation-id>GH-CONF-1</span>
    `);
    const detection = greenhouseAdapter.detect(document);
    expect(detection).toMatchObject({ adapter: "GREENHOUSE", supported: true });
    expect(greenhouseAdapter.extractJob(document, detection)).toMatchObject({
      ats: "GREENHOUSE",
      title: "Platform Engineer",
      company: "ExampleCo",
      externalRequisitionId: "GH-100",
    });
    expect(
      greenhouseAdapter.classifyField({
        fieldId: "resume",
        controlKind: "file",
        accessibleName: "Resume",
        labelText: "Resume",
        ariaLabel: "",
        placeholder: "",
        name: "job_application[resume]",
        domId: "resume",
        required: true,
        disabled: false,
        readOnly: false,
        autocomplete: "",
        groupLabel: "",
        optionValue: "",
        checked: false,
        userEdited: false,
        options: [],
      } satisfies RawField)?.canonicalQuestion,
    ).toBe("APPLICATION.resume");
    expect(greenhouseAdapter.detectConfirmation(document)).toMatchObject({
      confirmed: true,
      referenceId: "GH-CONF-1",
    });
  });
});
