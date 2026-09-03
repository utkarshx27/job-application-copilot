import {
  ApprovedUploadPlanSchema,
  UploadResultSchema,
  type ApprovedUploadPlan,
} from "@copilot/job-schema";

import { inspectVisibleForm, isInputControl } from "./scanner";

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function uploadApprovedFile(
  untrustedPlan: ApprovedUploadPlan,
  targetDocument: Document = document,
) {
  const plan = ApprovedUploadPlanSchema.parse(untrustedPlan);
  if (new Date(plan.expiresAt).getTime() <= Date.now()) {
    return UploadResultSchema.parse({
      analysisId: plan.analysisId,
      fieldId: plan.fieldId,
      fileName: plan.file.fileName,
      sha256: plan.file.sha256,
      uploaded: false,
      reason: "The short-lived upload approval expired.",
    });
  }
  const control = inspectVisibleForm(targetDocument).controlsByFieldId.get(plan.fieldId);
  if (!isInputControl(control) || control.type !== "file" || control.disabled) {
    return UploadResultSchema.parse({
      analysisId: plan.analysisId,
      fieldId: plan.fieldId,
      fileName: plan.file.fileName,
      sha256: plan.file.sha256,
      uploaded: false,
      reason: "The approved résumé control is unavailable.",
    });
  }
  const bytes = bytesFromBase64(plan.file.base64);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const actualSha256 = hex(await crypto.subtle.digest("SHA-256", buffer));
  if (actualSha256 !== plan.file.sha256.toLocaleLowerCase()) {
    return UploadResultSchema.parse({
      analysisId: plan.analysisId,
      fieldId: plan.fieldId,
      fileName: plan.file.fileName,
      sha256: plan.file.sha256,
      uploaded: false,
      reason: "The approved résumé hash did not match the supplied bytes.",
    });
  }
  const ownerWindow = control.ownerDocument.defaultView ?? window;
  const file = new ownerWindow.File([buffer], plan.file.fileName, { type: plan.file.mimeType });
  const transfer = new ownerWindow.DataTransfer();
  transfer.items.add(file);
  control.files = transfer.files;
  control.dispatchEvent(new ownerWindow.Event("input", { bubbles: true, composed: true }));
  control.dispatchEvent(new ownerWindow.Event("change", { bubbles: true, composed: true }));
  return UploadResultSchema.parse({
    analysisId: plan.analysisId,
    fieldId: plan.fieldId,
    fileName: plan.file.fileName,
    sha256: actualSha256,
    uploaded: control.files?.[0]?.name === plan.file.fileName,
    ...(control.files?.[0]?.name === plan.file.fileName
      ? {}
      : { reason: "The ATS did not retain the approved résumé selection." }),
  });
}
