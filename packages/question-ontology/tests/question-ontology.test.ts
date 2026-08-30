import { describe, expect, it } from "vitest";

import { classifyQuestion } from "../src/index";

describe("question ontology", () => {
  it("keeps current authorization, current sponsorship, and future sponsorship distinct", () => {
    const cases = [
      ["Are you legally authorized to work?", "WORK_AUTH.currently_authorized"],
      ["Do you have the legal right to work in this country?", "WORK_AUTH.currently_authorized"],
      ["Are you currently authorized to work in India?", "WORK_AUTH.currently_authorized"],
      ["Will you require sponsorship now?", "WORK_AUTH.current_sponsorship"],
      ["Do you currently require visa sponsorship?", "WORK_AUTH.current_sponsorship"],
      ["Do you need sponsorship at this time?", "WORK_AUTH.current_sponsorship"],
      ["Will you require sponsorship in the future?", "WORK_AUTH.future_sponsorship"],
      ["Might you require future visa sponsorship?", "WORK_AUTH.future_sponsorship"],
      ["Will you later require employment sponsorship?", "WORK_AUTH.future_sponsorship"],
      ["What is your current visa type?", "WORK_AUTH.visa_type"],
    ] as const;
    for (const [question, canonical] of cases) {
      const result = classifyQuestion(question);
      expect(result.decision, question).toBe("MATCH");
      expect(result.canonicalQuestion, question).toBe(canonical);
    }
  });

  it("routes ambiguous, combined, negative, and double-negative authorization wording to review", () => {
    const cases = [
      "Will you require sponsorship?",
      "Will you require sponsorship now or in the future?",
      "Do you not require sponsorship now?",
      "Will you never need sponsorship later?",
      "Are you not unauthorized to work?",
      "Can you work without sponsorship?",
    ];
    for (const question of cases)
      expect(classifyQuestion(question).decision, question).toBe("REVIEW");
  });

  it("distinguishes other consequential lookalikes", () => {
    expect(classifyQuestion("Are you willing to relocate?").canonicalQuestion).toBe(
      "LOCATION.relocation",
    );
    expect(classifyQuestion("Are you able to commute to this location?").canonicalQuestion).toBe(
      "LOCATION.commute",
    );
    expect(classifyQuestion("Desired base salary?").canonicalQuestion).toBe("COMP.desired_base");
    expect(classifyQuestion("Desired total compensation?").canonicalQuestion).toBe(
      "COMP.desired_total",
    );
  });

  it("classifies highly sensitive questions for manual review only", () => {
    for (const question of [
      "What is your gender identity?",
      "Please disclose your race and ethnicity",
      "Do you have a disability?",
      "What is your veteran status?",
      "Have you been convicted of a crime?",
    ]) {
      const result = classifyQuestion(question);
      expect(result.risk, question).toBe("R4");
      expect(result.decision, question).toBe("REVIEW");
    }
  });
});
