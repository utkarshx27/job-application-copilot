// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { RawField } from "@copilot/form-schema";

import { workdayAdapter } from "../src/index";

describe("Workday adapter", () => {
  it("detects a tenant, extracts a job, models a manual SPA step, and confirms safely", () => {
    window.history.replaceState({}, "", "/en-US/External/job/India/Engineer_R12345/apply");
    document.head.innerHTML = `
      <meta name="copilot-ats" content="workday">
      <meta name="copilot-company" content="Example Systems">
      <meta name="copilot-workday-tenant" content="example">
      <meta name="copilot-workday-site" content="External">
      <meta name="copilot-workday-page" content="MY_INFORMATION">
      <meta name="copilot-requisition-id" content="R12345">
      <script type="application/ld+json">
        {
          "@type": "JobPosting",
          "title": "Platform Engineer",
          "description": "Build resilient systems.",
          "hiringOrganization": { "name": "Example Systems" },
          "jobLocation": { "address": { "addressLocality": "Bengaluru", "addressRegion": "India" } }
        }
      </script>`;
    document.body.innerHTML = `
      <main data-automation-id="applicationPage">
        <h1>My Information</h1>
        <ol><li data-automation-id="progressBarStep" aria-current="step">My Information</li></ol>
        <h2 data-automation-id="sectionHeading">Contact Information</h2>
        <input name="legalNameSection_firstName">
        <input name="email" value="parsed@example.test">
        <button data-automation-id="bottom-navigation-next-button">Next</button>
      </main>`;

    const detection = workdayAdapter.detect(document);
    const workflow = workdayAdapter.inspectWorkflow?.(document, detection);
    expect(detection).toMatchObject({ adapter: "WORKDAY", supported: true });
    expect(workdayAdapter.extractJob(document, detection)).toMatchObject({
      ats: "WORKDAY",
      title: "Platform Engineer",
      company: "Example Systems",
      externalRequisitionId: "R12345",
    });
    expect(workflow).toMatchObject({
      tenant: "example",
      site: "External",
      pageType: "MY_INFORMATION",
      authBoundary: "NONE",
      prefilledFieldCount: 1,
      navigation: { mode: "MANUAL_ONLY", nextVisible: true, submitVisible: false },
    });

    document.body.innerHTML = `
      <main data-automation-id="applicationPage">
        <section data-automation-id="applicationConfirmation">
          <h1>Thank you, your application was submitted</h1>
          <span data-confirmation-id>WD-CONF-700</span>
        </section>
      </main>`;
    expect(workdayAdapter.detectConfirmation(document)).toMatchObject({
      confirmed: true,
      referenceId: "WD-CONF-700",
    });
  });

  it("matches only safe first-record fields in the sanitized Workday fixture", () => {
    const fixture = JSON.parse(
      readFileSync(resolve("fixtures/ats/workday/v1/application.json"), "utf8"),
    ) as {
      snapshot: { fields: RawField[] };
      expectedCanonicalQuestions: Record<string, string | null>;
    };
    for (const field of fixture.snapshot.fields) {
      expect(workdayAdapter.classifyField(field)?.canonicalQuestion ?? null, field.fieldId).toBe(
        fixture.expectedCanonicalQuestions[field.fieldId],
      );
    }
  });

  it("recognizes account and expired-session boundaries without reading passwords", () => {
    window.history.replaceState({}, "", "/en-US/External/login");
    document.head.innerHTML = `
      <meta name="copilot-ats" content="workday">
      <meta name="copilot-workday-tenant" content="example">
      <meta name="copilot-workday-site" content="External">
      <meta name="copilot-workday-page" content="AUTH">`;
    document.body.innerHTML = `
      <main data-automation-id="applicationPage">
        <h1>Sign In</h1><input type="password" aria-label="Password">
      </main>`;
    const detection = workdayAdapter.detect(document);
    expect(workdayAdapter.inspectWorkflow?.(document, detection)).toMatchObject({
      pageType: "AUTH",
      authBoundary: "SIGN_IN_REQUIRED",
      navigation: { mode: "MANUAL_ONLY" },
    });

    document.body.innerHTML = `
      <main data-automation-id="applicationPage">
        <h1>Sign In</h1><div role="alert">Your session has expired. Sign in again.</div>
      </main>`;
    expect(workdayAdapter.inspectWorkflow?.(document, detection)).toMatchObject({
      authBoundary: "SESSION_EXPIRED",
      errorState: { kind: "SESSION_EXPIRED", recoverable: true },
    });
  });
});
