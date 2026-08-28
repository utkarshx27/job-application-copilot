import { describe, expect, it } from "vitest";

import { BrowserCommandSchema, ContentRequestSchema, PanelRequestSchema } from "../src/index";

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
});
