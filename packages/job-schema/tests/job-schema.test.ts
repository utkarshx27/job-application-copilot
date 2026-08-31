import { describe, expect, it } from "vitest";

import { ApprovedUploadFileSchema, AtsIdSchema } from "../src/index";

describe("job and application schemas", () => {
  it("accepts only bounded PDF/DOCX upload payloads with a SHA-256 digest", () => {
    expect(
      ApprovedUploadFileSchema.safeParse({
        fileName: "resume.pdf",
        mimeType: "application/pdf",
        sha256: "a".repeat(64),
        base64: "YQ==",
      }).success,
    ).toBe(true);
    expect(
      ApprovedUploadFileSchema.safeParse({
        fileName: "resume.exe",
        mimeType: "application/octet-stream",
        sha256: "bad",
        base64: "YQ==",
      }).success,
    ).toBe(false);
  });

  it("allows every Phase 9 adapter identifier", () => {
    for (const adapter of ["ICIMS", "TALEO", "WORKABLE", "BAMBOOHR", "JOBVITE", "COMEET"])
      expect(AtsIdSchema.safeParse(adapter).success, adapter).toBe(true);
  });
});
