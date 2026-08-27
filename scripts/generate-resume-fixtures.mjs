import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const outputDirectory = resolve(import.meta.dirname, "../fixtures/resumes");
const lines = [
  "Priya Sharma",
  "priya@example.test | +91 98765 43210 | https://github.com/priya-example | https://priya.example.test",
  "EXPERIENCE",
  "Senior Engineer | Example Labs | 2022-01 - Present | Bengaluru | Built accessible local-first software",
  "Developer | Earlier Co | 2020-01 - 2021-12 | Pune | Delivered web applications",
  "EDUCATION",
  "B.Tech | Example Institute | 2016-08 - 2020-05 | Computer Science",
  "SKILLS",
  "TypeScript, React, Accessibility",
];

await mkdir(outputDirectory, { recursive: true });

const navy = "183A52";
const green = "2C6E49";
const docx = new Document({
  creator: "Job Application Copilot contributors",
  title: "Synthetic résumé parser fixture",
  subject: "Sanitized automated test fixture",
  description: "Contains fictional data only.",
  keywords: "synthetic, resume, test fixture",
  styles: {
    default: { document: { run: { font: "Arial", size: 20, color: "24343D" } } },
    paragraphStyles: [
      {
        id: "ResumeName",
        name: "Resume Name",
        basedOn: "Normal",
        next: "Normal",
        run: { font: "Arial", size: 34, bold: true, color: navy },
        paragraph: { spacing: { after: 80 } },
      },
      {
        id: "ResumeSection",
        name: "Resume Section",
        basedOn: "Normal",
        next: "Normal",
        run: { font: "Arial", size: 22, bold: true, color: green },
        paragraph: {
          spacing: { before: 180, after: 60 },
          border: { bottom: { color: "A9C7B4", style: BorderStyle.SINGLE, size: 6 } },
        },
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          margin: { top: 720, right: 720, bottom: 720, left: 720 },
        },
      },
      children: [
        new Paragraph({ style: "ResumeName", children: [new TextRun(lines[0])] }),
        new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: { after: 150 },
          children: [new TextRun({ text: lines[1], size: 17, color: "50636D" })],
        }),
        new Paragraph({ style: "ResumeSection", heading: HeadingLevel.HEADING_1, text: lines[2] }),
        new Paragraph({ text: lines[3], spacing: { after: 80 } }),
        new Paragraph({ text: lines[4] }),
        new Paragraph({ style: "ResumeSection", heading: HeadingLevel.HEADING_1, text: lines[5] }),
        new Paragraph({ text: lines[6] }),
        new Paragraph({ style: "ResumeSection", heading: HeadingLevel.HEADING_1, text: lines[7] }),
        new Paragraph({ text: lines[8] }),
      ],
    },
  ],
});
await writeFile(resolve(outputDirectory, "synthetic-resume.docx"), await Packer.toBuffer(docx));

const pdf = await PDFDocument.create();
pdf.setTitle("Synthetic résumé parser fixture");
pdf.setAuthor("Job Application Copilot contributors");
pdf.setSubject("Sanitized automated test fixture");
pdf.setKeywords(["synthetic", "resume", "test fixture"]);
const page = pdf.addPage([612, 792]);
const regular = await pdf.embedFont(StandardFonts.Helvetica);
const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
let y = 744;
for (const line of lines) {
  const isName = line === lines[0];
  const isHeading = ["EXPERIENCE", "EDUCATION", "SKILLS"].includes(line);
  page.drawText(line, {
    x: 48,
    y,
    size: isName ? 18 : isHeading ? 12 : 9,
    font: isName || isHeading ? bold : regular,
    color: isName
      ? rgb(0.09, 0.23, 0.32)
      : isHeading
        ? rgb(0.17, 0.43, 0.29)
        : rgb(0.14, 0.2, 0.24),
  });
  y -= isName ? 30 : isHeading ? 23 : 18;
}
await writeFile(resolve(outputDirectory, "synthetic-resume.pdf"), await pdf.save());
