import { z } from "zod";

export const QUESTION_ONTOLOGY_VERSION = 1 as const;

export const CanonicalQuestionSchema = z.enum([
  "IDENTITY.legal_name.full",
  "IDENTITY.legal_name.given",
  "IDENTITY.legal_name.family",
  "CONTACT.email",
  "CONTACT.phone",
  "ADDRESS.country",
  "LINKS.portfolio",
  "LINKS.github",
  "LINKS.linkedin",
  "WORK_AUTH.currently_authorized",
  "WORK_AUTH.current_sponsorship",
  "WORK_AUTH.future_sponsorship",
  "WORK_AUTH.visa_type",
  "WORK_AUTH.visa_expiration",
  "WORK_HISTORY.0.employer",
  "WORK_HISTORY.0.title",
  "WORK_HISTORY.0.location",
  "WORK_HISTORY.0.start_date",
  "WORK_HISTORY.0.end_date",
  "WORK_HISTORY.0.current",
  "WORK_HISTORY.0.description",
  "EDUCATION.0.institution",
  "EDUCATION.0.degree",
  "EDUCATION.0.field_of_study",
  "EDUCATION.0.start_date",
  "EDUCATION.0.end_date",
  "PROFILE.skills",
  "COMP.desired_base",
  "COMP.desired_total",
  "COMP.hourly_rate",
  "COMP.current_compensation",
  "AVAIL.notice_period",
  "AVAIL.start_date",
  "LOCATION.relocation",
  "LOCATION.commute",
  "LOCATION.travel",
  "LOCATION.remote_preference",
  "SOURCE.referral",
  "ESSAY.why_company",
  "ESSAY.why_role",
  "EEO.gender",
  "EEO.race_ethnicity",
  "EEO.disability",
  "EEO.veteran_status",
  "LEGAL.criminal_history",
  "SECURITY.clearance",
  "CITIZENSHIP.status",
  "APPLICATION.resume",
  "APPLICATION.cover_letter",
  "APPLICATION.custom_answer",
  "CONSENT.terms",
]);

export const QuestionRiskSchema = z.enum(["R0", "R1", "R2", "R3", "R4"]);
export const QuestionMatchMethodSchema = z.enum([
  "EXACT_ALIAS",
  "KEYWORD_RULE",
  "SEMANTIC",
  "NONE",
]);
export const QuestionDecisionSchema = z.enum(["MATCH", "REVIEW", "UNMAPPED"]);

export const QuestionClassificationSchema = z.object({
  ontologyVersion: z.literal(QUESTION_ONTOLOGY_VERSION),
  decision: QuestionDecisionSchema,
  canonicalQuestion: CanonicalQuestionSchema.nullable(),
  confidence: z.number().min(0).max(1),
  method: QuestionMatchMethodSchema,
  risk: QuestionRiskSchema.nullable(),
  evidence: z.array(z.string().max(500)).max(10),
});

export type CanonicalQuestion = z.infer<typeof CanonicalQuestionSchema>;
export type QuestionRisk = z.infer<typeof QuestionRiskSchema>;
export type QuestionClassification = z.infer<typeof QuestionClassificationSchema>;

type QuestionDefinition = {
  id: CanonicalQuestion;
  risk: QuestionRisk;
  aliases: readonly string[];
  keywordRules: readonly {
    all: readonly string[];
    any?: readonly string[];
    none?: readonly string[];
  }[];
  semanticExamples: readonly string[];
  freshnessDays: number;
  explanation: string;
};

const DEFINITIONS: readonly QuestionDefinition[] = [
  {
    id: "WORK_AUTH.currently_authorized",
    risk: "R3",
    aliases: [
      "are you currently authorized to work",
      "are you legally authorized to work",
      "are you authorized to work in this country",
      "do you have the legal right to work in this country",
    ],
    keywordRules: [
      { all: ["authorized", "work"], none: ["sponsor", "sponsorship"] },
      { all: ["legal", "right", "work"], none: ["sponsor", "sponsorship"] },
    ],
    semanticExamples: ["legal authorization to work", "right to work in this country"],
    freshnessDays: 90,
    explanation: "Whether the candidate is currently legally authorized to work.",
  },
  {
    id: "WORK_AUTH.current_sponsorship",
    risk: "R3",
    aliases: [
      "will you require sponsorship now",
      "do you currently require sponsorship",
      "do you need sponsorship at this time",
      "will you now require visa sponsorship",
    ],
    keywordRules: [
      { all: ["sponsor"], any: ["now", "currently", "current", "today", "present"] },
      { all: ["sponsorship"], any: ["now", "currently", "current", "today", "present"] },
    ],
    semanticExamples: ["current visa sponsorship requirement", "sponsorship needed now"],
    freshnessDays: 90,
    explanation: "Whether sponsorship is required for the candidate to work now.",
  },
  {
    id: "WORK_AUTH.future_sponsorship",
    risk: "R3",
    aliases: [
      "will you require sponsorship in the future",
      "will you need sponsorship in the future",
      "might you require future visa sponsorship",
      "will you later require employment sponsorship",
    ],
    keywordRules: [
      { all: ["sponsor"], any: ["future", "later", "eventually"] },
      { all: ["sponsorship"], any: ["future", "later", "eventually"] },
    ],
    semanticExamples: ["future visa sponsorship requirement", "sponsorship needed later"],
    freshnessDays: 90,
    explanation: "Whether sponsorship may be required in the future.",
  },
  {
    id: "WORK_AUTH.visa_type",
    risk: "R3",
    aliases: ["what is your current visa type", "current visa status", "visa category"],
    keywordRules: [{ all: ["visa"], any: ["type", "status", "category"] }],
    semanticExamples: ["current immigration visa category"],
    freshnessDays: 90,
    explanation: "The candidate's explicitly verified current visa type.",
  },
  {
    id: "COMP.desired_base",
    risk: "R2",
    aliases: ["desired base salary", "expected base salary", "base salary expectation"],
    keywordRules: [{ all: ["base", "salary"], any: ["desired", "expected", "expectation"] }],
    semanticExamples: ["annual base pay expectation"],
    freshnessDays: 60,
    explanation: "Desired base compensation, excluding bonus and equity.",
  },
  {
    id: "COMP.desired_total",
    risk: "R2",
    aliases: [
      "desired total compensation",
      "expected total compensation",
      "total compensation expectation",
    ],
    keywordRules: [{ all: ["total", "compensation"], any: ["desired", "expected", "expectation"] }],
    semanticExamples: ["total pay expectation including bonus and equity"],
    freshnessDays: 60,
    explanation: "Desired total compensation, which may include variable components.",
  },
  {
    id: "COMP.hourly_rate",
    risk: "R2",
    aliases: ["desired hourly rate", "expected hourly pay", "hourly rate expectation"],
    keywordRules: [{ all: ["hourly"], any: ["rate", "pay", "compensation"] }],
    semanticExamples: ["pay expected per hour"],
    freshnessDays: 60,
    explanation: "Desired hourly compensation rate.",
  },
  {
    id: "AVAIL.notice_period",
    risk: "R2",
    aliases: ["what is your notice period", "current notice period", "how much notice do you need"],
    keywordRules: [{ all: ["notice", "period"] }],
    semanticExamples: ["time required before leaving current employer"],
    freshnessDays: 30,
    explanation: "The candidate's current employment notice period.",
  },
  {
    id: "AVAIL.start_date",
    risk: "R2",
    aliases: ["when can you start", "earliest start date", "available start date"],
    keywordRules: [{ all: ["start"], any: ["when", "date", "available", "earliest"] }],
    semanticExamples: ["earliest date available to begin work"],
    freshnessDays: 30,
    explanation: "The earliest date the candidate can start this role.",
  },
  {
    id: "LOCATION.relocation",
    risk: "R2",
    aliases: ["are you willing to relocate", "would you relocate for this role"],
    keywordRules: [{ all: ["relocate"], any: ["willing", "able", "would"] }],
    semanticExamples: ["willingness to move for a job"],
    freshnessDays: 90,
    explanation:
      "Whether the candidate is willing to move for the role under the saved conditions.",
  },
  {
    id: "LOCATION.commute",
    risk: "R2",
    aliases: ["are you able to commute", "can you commute to this location"],
    keywordRules: [{ all: ["commute"], any: ["able", "can", "willing"] }],
    semanticExamples: ["ability to travel regularly to the workplace"],
    freshnessDays: 90,
    explanation: "Whether the candidate can commute to the stated workplace.",
  },
  {
    id: "LOCATION.travel",
    risk: "R2",
    aliases: ["are you willing to travel", "what percentage can you travel"],
    keywordRules: [{ all: ["travel"], any: ["willing", "percentage", "percent"] }],
    semanticExamples: ["willingness to travel for work"],
    freshnessDays: 90,
    explanation: "The candidate's current work-travel preference.",
  },
  {
    id: "SOURCE.referral",
    risk: "R0",
    aliases: ["how did you hear about us", "how did you find this job", "referral source"],
    keywordRules: [
      { all: ["hear", "about", "us"] },
      { all: ["find", "job"] },
      { all: ["referral", "source"] },
    ],
    semanticExamples: ["source where this opportunity was discovered"],
    freshnessDays: 365,
    explanation: "Where the candidate found the role.",
  },
  {
    id: "ESSAY.why_company",
    risk: "R1",
    aliases: ["why are you interested in our company", "why do you want to join our company"],
    keywordRules: [
      { all: ["why"], any: ["company", "organization", "organisation", "us"] },
      { all: ["why", "interested"], none: ["role", "position"] },
      { all: ["interested"], any: ["company", "organization", "organisation"] },
      { all: ["interests"], any: ["company", "organization", "organisation"] },
    ],
    semanticExamples: ["motivation for joining this company", "interest in the employer"],
    freshnessDays: 180,
    explanation: "A user-confirmed explanation of interest in a specific company.",
  },
  {
    id: "ESSAY.why_role",
    risk: "R1",
    aliases: ["why are you interested in this role", "what interests you about this role"],
    keywordRules: [
      { all: ["interested", "role"] },
      { all: ["interests", "role"] },
      { all: ["why", "position"] },
    ],
    semanticExamples: ["motivation for applying to this position", "interest in this role"],
    freshnessDays: 180,
    explanation: "A user-confirmed explanation of interest in a role.",
  },
  {
    id: "EEO.gender",
    risk: "R4",
    aliases: ["gender identity", "what is your gender", "sex"],
    keywordRules: [{ all: ["gender"] }],
    semanticExamples: ["voluntary gender disclosure"],
    freshnessDays: 0,
    explanation: "A voluntary, highly sensitive demographic disclosure.",
  },
  {
    id: "EEO.race_ethnicity",
    risk: "R4",
    aliases: ["race and ethnicity", "racial or ethnic identity", "ethnicity"],
    keywordRules: [{ any: ["race", "ethnicity", "ethnic"], all: [] }],
    semanticExamples: ["voluntary race or ethnicity disclosure"],
    freshnessDays: 0,
    explanation: "A voluntary, highly sensitive demographic disclosure.",
  },
  {
    id: "EEO.disability",
    risk: "R4",
    aliases: ["disability status", "do you have a disability", "voluntary disability disclosure"],
    keywordRules: [{ all: ["disability"] }, { all: ["disabled"] }],
    semanticExamples: ["voluntary disability status disclosure"],
    freshnessDays: 0,
    explanation: "A voluntary, highly sensitive disability disclosure.",
  },
  {
    id: "EEO.veteran_status",
    risk: "R4",
    aliases: ["veteran status", "protected veteran", "are you a veteran"],
    keywordRules: [{ all: ["veteran"] }],
    semanticExamples: ["voluntary protected veteran disclosure"],
    freshnessDays: 0,
    explanation: "A voluntary, highly sensitive veteran-status disclosure.",
  },
  {
    id: "LEGAL.criminal_history",
    risk: "R4",
    aliases: ["criminal history", "criminal record", "have you been convicted"],
    keywordRules: [{ any: ["criminal", "convicted", "conviction"], all: [] }],
    semanticExamples: ["legal disclosure about criminal convictions"],
    freshnessDays: 0,
    explanation: "A highly sensitive legal-history disclosure.",
  },
  {
    id: "SECURITY.clearance",
    risk: "R3",
    aliases: ["do you hold a security clearance", "current security clearance", "clearance level"],
    keywordRules: [{ all: ["security", "clearance"] }],
    semanticExamples: ["government security clearance status"],
    freshnessDays: 90,
    explanation: "An explicitly verified security-clearance status.",
  },
  {
    id: "CITIZENSHIP.status",
    risk: "R3",
    aliases: ["what is your citizenship", "citizenship status", "country of citizenship"],
    keywordRules: [{ any: ["citizenship", "citizen"], all: [] }],
    semanticExamples: ["explicit citizenship status"],
    freshnessDays: 365,
    explanation: "An explicitly verified citizenship fact; never inferred from location or name.",
  },
] as const;

const DEFINITIONS_BY_ID = new Map(DEFINITIONS.map((definition) => [definition.id, definition]));

export function normalizeQuestion(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function words(value: string): Set<string> {
  return new Set(
    normalizeQuestion(value)
      .split(" ")
      .filter((word) => word.length > 1),
  );
}

function similarity(left: string, right: string): number {
  const leftWords = words(left);
  const rightWords = words(right);
  if (!leftWords.size || !rightWords.size) return 0;
  let overlap = 0;
  for (const word of leftWords) if (rightWords.has(word)) overlap += 1;
  return (2 * overlap) / (leftWords.size + rightWords.size);
}

function result(
  decision: "MATCH" | "REVIEW" | "UNMAPPED",
  canonicalQuestion: CanonicalQuestion | null,
  confidence: number,
  method: "EXACT_ALIAS" | "KEYWORD_RULE" | "SEMANTIC" | "NONE",
  risk: QuestionRisk | null,
  evidence: string[],
): QuestionClassification {
  return QuestionClassificationSchema.parse({
    ontologyVersion: QUESTION_ONTOLOGY_VERSION,
    decision,
    canonicalQuestion,
    confidence,
    method,
    risk,
    evidence,
  });
}

function workAuthorizationGuard(text: string): QuestionClassification | null {
  const sponsorship = /\bsponsor(ship|ed|ing)?\b/.test(text);
  const authorization = /\b(?:un)?authori[sz](ed|ation)\b|\blegal right to work\b/.test(text);
  if (!sponsorship && !authorization) return null;
  const current = /\b(now|current|currently|today|present|at this time)\b/.test(text);
  const future = /\b(future|later|eventually|ever)\b/.test(text);
  const negative = /\b(no|not|never|without|dont|doesnt|wont|isnt|arent)\b/.test(text);
  if (negative || (sponsorship && current && future)) {
    return result("REVIEW", null, 0, "NONE", "R3", [
      "Work-authorization wording is negative, combined, or otherwise unsafe to reuse.",
    ]);
  }
  if (sponsorship && !current && !future) {
    return result("REVIEW", null, 0, "NONE", "R3", [
      "Sponsorship timing is ambiguous; current and future sponsorship are distinct.",
    ]);
  }
  return null;
}

function classifyDecision(definition: QuestionDefinition): "MATCH" | "REVIEW" {
  return definition.risk === "R4" ? "REVIEW" : "MATCH";
}

export function classifyQuestion(question: string): QuestionClassification {
  const normalized = normalizeQuestion(question);
  if (!normalized) return result("UNMAPPED", null, 0, "NONE", null, []);

  const guarded = workAuthorizationGuard(normalized);
  if (guarded) return guarded;

  for (const definition of DEFINITIONS) {
    const alias = definition.aliases.find(
      (candidate) => normalizeQuestion(candidate) === normalized,
    );
    if (alias)
      return result(
        classifyDecision(definition),
        definition.id,
        1,
        "EXACT_ALIAS",
        definition.risk,
        [`alias:${normalizeQuestion(alias)}`],
      );
  }

  const tokenSet = words(normalized);
  const keywordMatches = DEFINITIONS.filter((definition) =>
    definition.keywordRules.some((rule) => {
      const all = rule.all.every((word) => tokenSet.has(word));
      const any = !rule.any?.length || rule.any.some((word) => tokenSet.has(word));
      const none = !rule.none?.some((word) => tokenSet.has(word));
      return all && any && none;
    }),
  );
  if (keywordMatches.length === 1) {
    const definition = keywordMatches[0]!;
    return result(
      classifyDecision(definition),
      definition.id,
      0.96,
      "KEYWORD_RULE",
      definition.risk,
      [`keyword:${definition.id}`],
    );
  }
  if (keywordMatches.length > 1) {
    return result("REVIEW", null, 0, "NONE", null, [
      "Multiple canonical questions matched the same wording.",
    ]);
  }

  const ranked = DEFINITIONS.map((definition) => ({
    definition,
    score: Math.max(
      ...definition.semanticExamples.map((example) => similarity(normalized, example)),
    ),
  })).sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (best && best.score >= 0.74 && best.score - (runnerUp?.score ?? 0) >= 0.12) {
    const decision =
      best.definition.risk === "R3" || best.definition.risk === "R4" ? "REVIEW" : "MATCH";
    return result(decision, best.definition.id, best.score, "SEMANTIC", best.definition.risk, [
      `semantic:${best.definition.id}`,
    ]);
  }
  return result("UNMAPPED", null, 0, "NONE", null, ["No safe ontology match."]);
}

export function questionDefinition(canonical: CanonicalQuestion): QuestionDefinition | null {
  return DEFINITIONS_BY_ID.get(canonical) ?? null;
}

export function freshnessDaysFor(canonical: CanonicalQuestion | null): number {
  return canonical ? (questionDefinition(canonical)?.freshnessDays ?? 180) : 180;
}

export function allowedScopesForRisk(risk: QuestionRisk | null) {
  if (risk === "R4") return [] as const;
  if (risk === "R3") return ["APPLICATION", "COUNTRY"] as const;
  if (risk === "R2") return ["APPLICATION", "COMPANY", "COUNTRY", "ROLE"] as const;
  return ["APPLICATION", "COMPANY", "COUNTRY", "ROLE", "GLOBAL"] as const;
}

export function sensitivityForRisk(risk: QuestionRisk | null) {
  if (risk === "R4") return "HIGHLY_SENSITIVE" as const;
  if (risk === "R3") return "SENSITIVE" as const;
  if (risk === "R2") return "PERSONAL" as const;
  if (risk === "R1") return "PROFESSIONAL" as const;
  return "PUBLIC" as const;
}

export function semanticQuestionSimilarity(left: string, right: string): number {
  return similarity(left, right);
}
