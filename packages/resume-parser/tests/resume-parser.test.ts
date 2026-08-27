import { describe, expect, it } from "vitest";

import { parseResumeText } from "../src/index";

const resume = `
Priya Sharma
priya@example.test | +91 98765 43210 | https://github.com/priya | https://priya.example.test

EXPERIENCE
Senior Engineer | Example Labs | 2022-01 - Present | Bengaluru | Built accessible software
Developer | Earlier Co | 2020-01 - 2021-12 | Pune

EDUCATION
B.Tech | Example Institute | 2016-08 - 2020-05 | Computer Science

SKILLS
TypeScript, React, Accessibility
`;

describe("parseResumeText", () => {
  it("extracts conservative structured facts from a synthetic resume", () => {
    const parsed = parseResumeText(resume);
    expect(parsed.identity).toEqual({ full: "Priya Sharma", given: "Priya", family: "Sharma" });
    expect(parsed.email).toBe("priya@example.test");
    expect(parsed.phone).toBe("+919876543210");
    expect(parsed.workHistory).toHaveLength(2);
    expect(parsed.workHistory[0]?.current).toBe(true);
    expect(parsed.education[0]?.fieldOfStudy).toBe("Computer Science");
    expect(parsed.skills).toEqual(["TypeScript", "React", "Accessibility"]);
  });

  it("does not infer sensitive facts", () => {
    const parsed = parseResumeText(`${resume}\nCitizenship: Indian\nDisability: None`);
    expect(Object.keys(parsed)).not.toContain("workAuthorization");
    expect(Object.keys(parsed)).not.toContain("sensitivePreferences");
  });
});
