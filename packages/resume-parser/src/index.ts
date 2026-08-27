import { ResumeDraftSchema, type ResumeDraft } from "@copilot/profile-core";

type Section = "NONE" | "WORK" | "EDUCATION" | "SKILLS";

function dateValue(value: string): string | null {
  const trimmed = value.trim();
  const match = /^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?$/.exec(trimmed);
  if (!match?.[1] || !match[2]) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${(match[3] ?? "01").padStart(2, "0")}`;
}

function dateRange(value: string): { start: string; end: string; current: boolean } | null {
  const parts = value.split(/\s+(?:-|–|—|to)\s+/i);
  const start = parts[0] ? dateValue(parts[0]) : null;
  if (!start) return null;
  const endText = parts[1]?.trim() ?? "";
  const current = /^(present|current|now)$/i.test(endText);
  const end = current ? "" : dateValue(endText);
  if (!current && !end) return null;
  return { start, end: end ?? "", current };
}

function cleanPhone(candidate: string): string | undefined {
  const normalized = candidate.replace(/[^+\d]/g, "");
  return /^\+[1-9]\d{6,14}$/.test(normalized) ? normalized : undefined;
}

function firstName(lines: string[]): ResumeDraft["identity"] {
  const candidate = lines.find(
    (line) =>
      line.length <= 80 &&
      /^[\p{L}][\p{L}\p{M} .'’-]+$/u.test(line) &&
      !/^(experience|employment|education|skills|projects|summary|profile)$/i.test(line),
  );
  if (!candidate) return undefined;
  const words = candidate.split(/\s+/).filter(Boolean);
  return {
    full: candidate,
    given: words[0] ?? candidate,
    family: words.length > 1 ? words.slice(1).join(" ") : null,
  };
}

export function parseResumeText(input: string): ResumeDraft {
  const lines = input
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const joined = lines.join("\n");
  const email = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.exec(joined)?.[0];
  const phoneMatch = /\+[\d ()-]{7,20}\d/.exec(joined)?.[0];
  const urls = joined.match(/https?:\/\/[^\s|,]+/g) ?? [];
  const github = urls.find((url) => /github\.com/i.test(url));
  const linkedin = urls.find((url) => /linkedin\.com/i.test(url));
  const portfolio = urls.find((url) => url !== github && url !== linkedin);
  const workHistory: ResumeDraft["workHistory"] = [];
  const education: ResumeDraft["education"] = [];
  const skills: string[] = [];
  const warnings: string[] = [];
  let section: Section = "NONE";

  for (const line of lines) {
    if (/^(experience|employment|work history)$/i.test(line)) {
      section = "WORK";
      continue;
    }
    if (/^education$/i.test(line)) {
      section = "EDUCATION";
      continue;
    }
    if (/^(skills|technical skills)$/i.test(line)) {
      section = "SKILLS";
      continue;
    }
    if (/^(projects|certifications|languages|summary|profile)$/i.test(line)) {
      section = "NONE";
      continue;
    }

    if (section === "SKILLS") {
      for (const skill of line
        .split(/[,;|•]/)
        .map((value) => value.trim())
        .filter(Boolean)) {
        if (
          skill.length <= 60 &&
          !skills.some((known) => known.toLocaleLowerCase() === skill.toLocaleLowerCase())
        )
          skills.push(skill);
      }
      continue;
    }

    const columns = line.split("|").map((value) => value.trim());
    if (section === "WORK" && columns.length >= 3) {
      const dates = dateRange(columns[2] ?? "");
      if (dates && columns[0] && columns[1]) {
        workHistory.push({
          id: `resume-work-${workHistory.length + 1}`,
          title: columns[0],
          employer: columns[1],
          ...dates,
          location: columns[3] ?? "",
          description: columns.slice(4).join(" | "),
        });
      }
    }
    if (section === "EDUCATION" && columns.length >= 2) {
      const dates = columns[2] ? dateRange(columns[2]) : null;
      if (columns[0] && columns[1]) {
        education.push({
          id: `resume-education-${education.length + 1}`,
          degree: columns[0],
          institution: columns[1],
          fieldOfStudy: columns[3] ?? "",
          start: dates?.start ?? "",
          end: dates?.end ?? "",
          current: dates?.current ?? false,
        });
      }
    }
  }

  if (!email) warnings.push("No email address was found.");
  if (workHistory.length === 0)
    warnings.push("No structured work entries were found; add them manually if needed.");
  return ResumeDraftSchema.parse({
    identity: firstName(lines),
    email,
    phone: phoneMatch ? cleanPhone(phoneMatch) : undefined,
    portfolio,
    github,
    linkedin,
    workHistory,
    education,
    skills,
    warnings,
  });
}
