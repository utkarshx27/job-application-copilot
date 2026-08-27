import { parseResumeText } from "@copilot/resume-parser";
import type { ProfileSource, ResumeDraft } from "@copilot/profile-core";
import * as mammoth from "mammoth";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";

const MAX_RESUME_BYTES = 5 * 1024 * 1024;

function extensionOf(name: string): string {
  return name.split(".").pop()?.toLocaleLowerCase() ?? "";
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function extractPdf(buffer: ArrayBuffer): Promise<string> {
  GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.mjs");
  const task = getDocument({
    data: new Uint8Array(buffer),
    wasmUrl: chrome.runtime.getURL("pdf-wasm/"),
    standardFontDataUrl: chrome.runtime.getURL("pdf-standard-fonts/"),
  });
  const document = await task.promise;
  const pages: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .flatMap((item) => ("str" in item && item.str.trim() ? [item.str] : []))
          .join("\n"),
      );
    }
  } finally {
    await task.destroy();
  }
  return pages.join("\n");
}

export async function readResumeFile(file: File): Promise<{
  draft: ResumeDraft;
  source: ProfileSource;
}> {
  if (file.size > MAX_RESUME_BYTES) throw new Error("Résumé files must be 5 MB or smaller.");
  const extension = extensionOf(file.name);
  if (extension !== "pdf" && extension !== "docx") {
    throw new Error("Choose a PDF or DOCX résumé.");
  }

  const buffer = await file.arrayBuffer();
  const text =
    extension === "pdf"
      ? await extractPdf(buffer)
      : (await mammoth.extractRawText({ arrayBuffer: buffer })).value;
  if (!text.trim()) throw new Error("No readable text was found in this résumé.");
  const now = new Date().toISOString();
  return {
    draft: parseResumeText(text),
    source: {
      id: `resume-${crypto.randomUUID()}`,
      kind: extension === "pdf" ? "RESUME_PDF" : "RESUME_DOCX",
      displayName: file.name,
      sha256: await sha256(buffer),
      importedAt: now,
    },
  };
}
