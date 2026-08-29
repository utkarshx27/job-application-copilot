import { describe, expect, it } from "vitest";

import { ApprovedUploadFileSchema } from "../src/index";

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
});
