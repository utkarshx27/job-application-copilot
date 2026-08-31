import { describe, expect, it } from "vitest";

import {
  BrowserCommandSchema,
  ContentRequestSchema,
  PanelRequestSchema,
  RuntimeResponseSchema,
} from "../src/index";

describe("browser command allowlist", () => {
  it("accepts a typed text fill", () => {
    expect(
      BrowserCommandSchema.safeParse({
        type: "FILL_TEXT",
        applicationId: "app-1",
        fieldId: "first-name",
        value: "Ada",
      }).success,
    ).toBe(true);
  });

  it("rejects arbitrary script execution", () => {
    expect(
      BrowserCommandSchema.safeParse({ type: "EXECUTE_JAVASCRIPT", code: "alert(1)" }).success,
    ).toBe(false);
  });

  it("rejects generic navigation and every submission command", () => {
    expect(
      BrowserCommandSchema.safeParse({ type: "CLICK_NEXT", applicationId: "app-1" }).success,
    ).toBe(false);
    expect(
      BrowserCommandSchema.safeParse({ type: "CLICK_SUBMIT", applicationId: "app-1" }).success,
    ).toBe(false);
  });

  it("allows only a typed controlled Next plan and strips arbitrary selectors", () => {
    const parsed = BrowserCommandSchema.parse({
      type: "CLICK_CONTROLLED_NEXT",
      plan: {
        intentVersion: 1,
        id: "intent-1",
        intentId: "intent-1",
        applicationId: "application-1",
        analysisId: "analysis-1",
        adapter: "WORKDAY",
        adapterVersion: "1.0.0",
        sourceUrl: "http://127.0.0.1:4173/workday.html",
        sourcePageKey: "step-1",
        sourceFingerprint: "workday:1234abcd",
        sourceUserEditVersion: 0,
        targetToken: "WORKDAY_BOTTOM_NAVIGATION_NEXT",
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        selector: "button[type='submit']",
      },
    });
    expect(parsed.type).toBe("CLICK_CONTROLLED_NEXT");
    if (parsed.type !== "CLICK_CONTROLLED_NEXT") throw new Error("Expected controlled Next.");
    expect("selector" in parsed.plan).toBe(false);
    expect(JSON.stringify(parsed)).not.toContain("submit");
  });

  it("accepts controlled auto-next panel actions but no page-controlled target", () => {
    expect(
      PanelRequestSchema.safeParse({
        type: "PANEL_AUTO_NEXT_SET_ENABLED",
        analysisId: "analysis-1",
        enabled: true,
      }).success,
    ).toBe(true);
    const prepared = PanelRequestSchema.parse({
      type: "PANEL_AUTO_NEXT_PREPARE",
      analysisId: "analysis-1",
      selector: "#unsafe",
    });
    expect("selector" in prepared).toBe(false);
  });

  it("rejects unknown panel messages", () => {
    expect(PanelRequestSchema.safeParse({ type: "PANEL_SUBMIT_APPLICATION" }).success).toBe(false);
  });

  it("allows panel fill requests to select fields but not supply values", () => {
    const parsed = PanelRequestSchema.parse({
      type: "PANEL_FILL_ACTIVE_FIELDS",
      analysisId: "analysis-1",
      fieldIds: ["email"],
      value: "page-controlled-value",
    });
    expect("value" in parsed).toBe(false);
  });

  it("rejects malformed content fill plans", () => {
    expect(
      ContentRequestSchema.safeParse({
        type: "CONTENT_APPLY_FILL",
        plan: {
          analysisId: "analysis-1",
          items: [
            {
              fieldId: "email",
              canonicalQuestion: "EXECUTE_SCRIPT",
              operation: { kind: "text", value: "x" },
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("accepts session AI configuration but never exposes a key in status responses", () => {
    expect(
      PanelRequestSchema.safeParse({
        type: "PANEL_AI_CONFIG_SET",
        config: { provider: "OPENAI", model: "gpt-5-mini", apiKey: "session-key" },
      }).success,
    ).toBe(true);
    const status = RuntimeResponseSchema.parse({
      ok: true,
      data: { configured: true, provider: "OPENAI", model: "gpt-5-mini", apiKey: "leak" },
    });
    expect(JSON.stringify(status)).not.toContain("leak");
  });

  it("strips arbitrary browser actions from AI draft requests", () => {
    expect(
      PanelRequestSchema.safeParse({
        type: "PANEL_AI_DRAFT",
        analysisId: "analysis-1",
        fieldId: "essay",
        maxChars: 500,
        action: "CLICK_SUBMIT",
      }).success,
    ).toBe(true);
    expect(
      PanelRequestSchema.parse({
        type: "PANEL_AI_DRAFT",
        analysisId: "analysis-1",
        fieldId: "essay",
        maxChars: 500,
        action: "CLICK_SUBMIT",
      }),
    ).not.toHaveProperty("action");
  });

  it("allows only validated tracker status and CSV operations", () => {
    expect(
      PanelRequestSchema.safeParse({
        type: "PANEL_TRACKER_UPDATE_STATUS",
        applicationId: "application:1",
        status: "INTERVIEW",
      }).success,
    ).toBe(true);
    expect(
      PanelRequestSchema.safeParse({
        type: "PANEL_TRACKER_UPDATE_STATUS",
        applicationId: "application:1",
        status: "AUTO_SUBMIT",
      }).success,
    ).toBe(false);
    expect(PanelRequestSchema.safeParse({ type: "PANEL_TRACKER_EXPORT_CSV" }).success).toBe(true);
    expect(
      PanelRequestSchema.safeParse({ type: "PANEL_TRACKER_IMPORT_CSV", csv: "" }).success,
    ).toBe(false);
  });
});
