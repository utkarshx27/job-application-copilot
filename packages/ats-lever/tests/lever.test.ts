// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { leverAdapter } from "../src/index";

describe("Lever adapter", () => {
  it("detects and extracts a sanitized Lever posting", () => {
    window.history.replaceState({}, "", "/lever.html");
    document.head.innerHTML = `
      <meta name="copilot-ats" content="lever">
      <meta name="copilot-company" content="Example Labs">
      <meta name="copilot-requisition-id" content="LEV-200">
    `;
    document.body.innerHTML = `
      <main data-qa="lever-posting">
        <div class="posting-headline"><h2>Frontend Engineer</h2></div>
        <div class="posting-categories"><span class="location">Bengaluru, India</span></div>
        <div data-job-description>Build accessible product experiences.</div>
      </main>
    `;
    const detection = leverAdapter.detect(document);
    expect(detection).toMatchObject({ adapter: "LEVER", supported: true });
    expect(leverAdapter.extractJob(document, detection)).toMatchObject({
      ats: "LEVER",
      title: "Frontend Engineer",
      company: "Example Labs",
      externalRequisitionId: "LEV-200",
    });

    document.body.innerHTML = `
      <main data-qa="lever-posting">
        <section class="application-confirmation">
          <h1>Application submitted — thank you</h1>
          <strong data-confirmation-id>LEV-CONF-200</strong>
        </section>
      </main>
    `;
    expect(leverAdapter.detectConfirmation(document)).toMatchObject({
      confirmed: true,
      referenceId: "LEV-CONF-200",
    });
  });
});
