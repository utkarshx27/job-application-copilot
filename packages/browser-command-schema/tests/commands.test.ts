import { describe, expect, it } from "vitest";

import { BrowserCommandSchema, PanelRequestSchema } from "../src/index";

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
});
