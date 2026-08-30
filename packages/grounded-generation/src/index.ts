import {
  AiEvidenceItemSchema,
  AiGatewayAuditSchema,
  AiGenerativeQuestionSchema,
  AiAtomicClaimSchema,
  executeAiTask,
  type AiEvidenceItem,
  type AiFreeTextGenerateOutputSchema,
  type AiGatewayAudit,
  type AiProvider,
  type AiGenerativeQuestion,
} from "@copilot/ai-gateway";
import { CandidateProfileSchema, type CandidateProfile } from "@copilot/candidate-schema";
import { NormalizedJobSchema, type NormalizedJob } from "@copilot/job-schema";
import { classifyQuestion, normalizeQuestion } from "@copilot/question-ontology";
import { z } from "zod";

const ApprovedDraftSchema = z.object({
  status: z.literal("APPROVED"),
  canonicalQuestion: AiGenerativeQuestionSchema,
  answer: z.string().min(1).max(20_000),
  charCount: z.number().int().nonnegative(),
  maxChars: z.number().int().positive(),
  evidence: z.array(AiEvidenceItemSchema).min(1).max(30),
  evidenceIds: z.array(z.string().min(1)).min(1).max(30),
  claims: z.array(AiAtomicClaimSchema).min(1).max(50),
  audits: z.array(AiGatewayAuditSchema).min(1).max(3),
  warnings: z.array(z.string().max(500)).max(20),
});

const RefusedDraftSchema = z.object({
  status: z.literal("REFUSED"),
  code: z.enum([
    "POLICY_BLOCKED",
    "UNSUPPORTED_QUESTION",
    "NO_EVIDENCE",
    "PROVIDER_FAILED",
    "UNSUPPORTED_CLAIM",
    "CHARACTER_LIMIT",
    "SENSITIVE_LEAKAGE",
    "INVALID_EVIDENCE",
  ]),
  message: z.string().min(1).max(1_000),
  canonicalQuestion: AiGenerativeQuestionSchema.optional(),
  audits: z.array(AiGatewayAuditSchema).max(3),
});

export const GroundedDraftResultSchema = z.discriminatedUnion("status", [
  ApprovedDraftSchema,
  RefusedDraftSchema,
]);

export type GroundedDraftResult = z.infer<typeof GroundedDraftResultSchema>;
type GeneratedOutput = z.infer<typeof AiFreeTextGenerateOutputSchema>;

const SAFE_FACT_STATUSES = new Set(["VERIFIED_USER", "VERIFIED_DOCUMENT", "DERIVED"]);
const SAFE_SENSITIVITIES = new Set(["PUBLIC", "PROFESSIONAL"]);

function textValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(", ");
  if (value && typeof value === "object")
    return Object.values(value as Record<string, unknown>)
      .map(textValue)
      .filter(Boolean)
      .join(" · ");
  return "";
}

function candidateEvidence(profileInput: CandidateProfile): AiEvidenceItem[] {
  const profile = CandidateProfileSchema.parse(profileInput);
  const evidence: AiEvidenceItem[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (
      typeof record.path === "string" &&
      typeof record.status === "string" &&
      typeof record.sensitivity === "string" &&
      SAFE_FACT_STATUSES.has(record.status) &&
      SAFE_SENSITIVITIES.has(record.sensitivity) &&
      record.value !== null
    ) {
      const text = textValue(record.value).replace(/\s+/g, " ").trim().slice(0, 1_500);
      if (text && !/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(text))
        evidence.push({ id: `candidate:${record.path}`, text, source: "CANDIDATE" });
      return;
    }
    Object.values(record).forEach(visit);
  };
  visit(profile);
  return evidence;
}

function jobEvidence(job: NormalizedJob): AiEvidenceItem[] {
  return [
    { id: "job:company", text: job.company, source: "JOB" as const },
    { id: "job:title", text: job.title, source: "JOB" as const },
    ...(job.location ? [{ id: "job:location", text: job.location, source: "JOB" as const }] : []),
    ...(job.requiredSkills.length
      ? [
          {
            id: "job:required-skills",
            text: job.requiredSkills.join(", ").slice(0, 1_500),
            source: "JOB" as const,
          },
        ]
      : []),
    ...(job.preferredSkills.length
      ? [
          {
            id: "job:preferred-skills",
            text: job.preferredSkills.join(", ").slice(0, 1_500),
            source: "JOB" as const,
          },
        ]
      : []),
    ...(job.description
      ? [
          {
            id: "job:description",
            text: job.description.replace(/\s+/g, " ").trim().slice(0, 2_000),
            source: "JOB" as const,
          },
        ]
      : []),
  ];
}

function words(value: string): Set<string> {
  return new Set(
    normalizeQuestion(value)
      .split(" ")
      .filter((word) => word.length >= 3),
  );
}

function evidenceScore(item: AiEvidenceItem, query: Set<string>): number {
  const itemWords = words(item.text);
  let overlap = 0;
  for (const word of itemWords) if (query.has(word)) overlap += 1;
  const path = item.id;
  const base = /skills|description|projects/.test(path)
    ? 5
    : /title|employer/.test(path)
      ? 4
      : /education/.test(path)
        ? 2
        : 1;
  return base + overlap * 3;
}

export function selectGroundingEvidence(
  profileInput: CandidateProfile,
  jobInput: NormalizedJob,
  question: string,
): AiEvidenceItem[] {
  const job = NormalizedJobSchema.parse(jobInput);
  const query = words(
    `${question} ${job.title} ${job.description} ${job.requiredSkills.join(" ")} ${job.preferredSkills.join(" ")}`,
  );
  const candidate = candidateEvidence(profileInput)
    .map((item) => ({ item, score: evidenceScore(item, query) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 18)
    .map(({ item }) => item);
  return [...jobEvidence(job), ...candidate]
    .slice(0, 24)
    .map((item) => AiEvidenceItemSchema.parse(item));
}

const BLOCKED_TEXT =
  /\b(passport|password|social security|ssn|bank account|credit card|api key|secret key|execute javascript|disable security|upload (a |the )?(passport|id))\b/i;
const EMAIL = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/;
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/;
const COMMON_CAPITALIZED = new Set([
  "A",
  "An",
  "And",
  "As",
  "At",
  "For",
  "From",
  "I",
  "In",
  "It",
  "My",
  "Of",
  "On",
  "Our",
  "The",
  "This",
  "To",
  "We",
  "With",
]);
const NARRATIVE_SCAFFOLD = new Set([
  "about",
  "align",
  "aligned",
  "aligns",
  "and",
  "background",
  "because",
  "bring",
  "company",
  "contribute",
  "contributing",
  "experience",
  "for",
  "from",
  "includes",
  "interest",
  "interested",
  "match",
  "matches",
  "opportunity",
  "role",
  "skills",
  "the",
  "this",
  "with",
  "work",
  "working",
]);

function novelNumbers(answer: string, corpus: string): string[] {
  const allowed = new Set(corpus.match(/\b\d+(?:\.\d+)?%?\b/g) ?? []);
  return [...new Set(answer.match(/\b\d+(?:\.\d+)?%?\b/g) ?? [])].filter(
    (number) => !allowed.has(number),
  );
}

function novelCapitalizedTerms(answer: string, corpus: string): string[] {
  const allowed = new Set(corpus.match(/\b[A-Z][A-Za-z0-9+.#-]{2,}\b/g) ?? []);
  return [...new Set(answer.match(/\b[A-Z][A-Za-z0-9+.#-]{2,}\b/g) ?? [])].filter(
    (term) => !allowed.has(term) && !COMMON_CAPITALIZED.has(term),
  );
}

function unsupportedLexicalTerms(text: string, corpus: string): string[] {
  const allowed = words(corpus);
  return [...words(text)].filter((word) => !allowed.has(word) && !NARRATIVE_SCAFFOLD.has(word));
}

export function validateGeneratedOutput(options: {
  output: GeneratedOutput;
  evidence: AiEvidenceItem[];
  question: string;
  maxChars: number;
}): { ok: true; evidence: AiEvidenceItem[] } | { ok: false; code: string; message: string } {
  const output = options.output;
  if (output.answer.length > options.maxChars)
    return {
      ok: false,
      code: "CHARACTER_LIMIT",
      message: "The draft exceeds the hard character limit.",
    };
  if (output.unsupportedClaims.length)
    return {
      ok: false,
      code: "UNSUPPORTED_CLAIM",
      message: "The provider reported unsupported claims.",
    };
  if (EMAIL.test(output.answer) || PHONE.test(output.answer) || BLOCKED_TEXT.test(output.answer))
    return {
      ok: false,
      code: "SENSITIVE_LEAKAGE",
      message: "The draft contains sensitive or prohibited content.",
    };
  if (output.claims.length === 0)
    return {
      ok: false,
      code: "UNSUPPORTED_CLAIM",
      message: "The draft did not declare the claims required for verification.",
    };
  const byId = new Map(options.evidence.map((item) => [item.id, item]));
  const referenced = new Set([
    ...output.evidenceIds,
    ...output.claims.flatMap((claim) => claim.supportedBy),
  ]);
  if ([...referenced].some((id) => !byId.has(id)))
    return { ok: false, code: "INVALID_EVIDENCE", message: "The draft cites unknown evidence." };
  const normalizedAnswer = normalizeQuestion(output.answer);
  if (output.claims.some((claim) => !normalizedAnswer.includes(normalizeQuestion(claim.text))))
    return {
      ok: false,
      code: "UNSUPPORTED_CLAIM",
      message: "A declared claim is not present in the answer.",
    };
  for (const claim of output.claims) {
    const support = claim.supportedBy.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item.text] : [];
    });
    const unsupported = unsupportedLexicalTerms(claim.text, support.join(" "));
    if (unsupported.length)
      return {
        ok: false,
        code: "UNSUPPORTED_CLAIM",
        message: `A claim is not lexically grounded in its cited evidence: ${unsupported.join(", ")}.`,
      };
  }
  const corpus = `${options.question} ${options.evidence.map((item) => item.text).join(" ")}`;
  const numbers = novelNumbers(output.answer, corpus);
  const terms = novelCapitalizedTerms(output.answer, corpus);
  const unsupportedWords = unsupportedLexicalTerms(output.answer, corpus);
  if (numbers.length || terms.length || unsupportedWords.length)
    return {
      ok: false,
      code: "UNSUPPORTED_CLAIM",
      message: `The draft introduced unsupported factual tokens: ${[
        ...numbers,
        ...terms,
        ...unsupportedWords,
      ].join(", ")}.`,
    };
  return {
    ok: true,
    evidence: [...referenced].flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    }),
  };
}

function refusal(
  code: z.infer<typeof RefusedDraftSchema>["code"],
  message: string,
  audits: AiGatewayAudit[],
  canonicalQuestion?: AiGenerativeQuestion,
): GroundedDraftResult {
  return GroundedDraftResultSchema.parse({
    status: "REFUSED",
    code,
    message,
    ...(canonicalQuestion ? { canonicalQuestion } : {}),
    audits,
  });
}

function unsafeQuestion(question: string): boolean {
  return (
    BLOCKED_TEXT.test(question) ||
    /\b(eeo|gender|race|ethnicity|disability|veteran|citizen|sponsor|visa|salary|compensation|criminal|clearance)\b/i.test(
      question,
    )
  );
}

export async function draftGroundedAnswer(options: {
  provider: AiProvider;
  profile: CandidateProfile;
  job: NormalizedJob;
  question: string;
  controlKind: "text" | "textarea";
  maxChars: number;
}): Promise<GroundedDraftResult> {
  const profile = CandidateProfileSchema.parse(options.profile);
  const job = NormalizedJobSchema.parse(options.job);
  const maxChars = z.number().int().min(50).max(20_000).parse(options.maxChars);
  const question = z.string().min(1).max(2_000).parse(options.question);
  const audits: AiGatewayAudit[] = [];
  if (unsafeQuestion(question))
    return refusal(
      "POLICY_BLOCKED",
      "AI drafting is disabled for sensitive, consequential, credential, or page-command wording.",
      audits,
    );

  const deterministic = classifyQuestion(question);
  if (deterministic.risk === "R2" || deterministic.risk === "R3" || deterministic.risk === "R4")
    return refusal(
      "POLICY_BLOCKED",
      "Consequential or sensitive factual questions require a manual answer.",
      audits,
    );

  const deterministicCanonical = AiGenerativeQuestionSchema.safeParse(
    deterministic.decision === "MATCH" ? deterministic.canonicalQuestion : null,
  );
  let canonical = deterministicCanonical.success ? deterministicCanonical.data : undefined;
  if (!canonical) {
    try {
      const classified = await executeAiTask(options.provider, {
        task: "QUESTION_CLASSIFY",
        question,
        controlKind: options.controlKind,
      });
      audits.push(classified.audit);
      if (classified.output.task !== "QUESTION_CLASSIFY")
        return refusal(
          "UNSUPPORTED_QUESTION",
          "The question could not be classified safely.",
          audits,
        );
      if (classified.output.confidence < 0.9 || !classified.output.canonicalQuestion)
        return refusal(
          "UNSUPPORTED_QUESTION",
          "AI drafting is available only for confidently classified open-text narrative questions.",
          audits,
        );
      canonical = classified.output.canonicalQuestion;
    } catch (error) {
      return refusal(
        "PROVIDER_FAILED",
        error instanceof Error ? error.message : "Question classification failed.",
        audits,
      );
    }
  }

  const evidence = selectGroundingEvidence(profile, job, question);
  if (!evidence.some((item) => item.source === "CANDIDATE"))
    return refusal(
      "NO_EVIDENCE",
      "Add and verify relevant professional profile facts before requesting a draft.",
      audits,
      canonical,
    );

  try {
    const generated = await executeAiTask(options.provider, {
      task: "FREE_TEXT_GENERATE",
      question,
      canonicalQuestion: canonical,
      job: {
        title: job.title,
        company: job.company,
        description: job.description.replace(/\s+/g, " ").trim().slice(0, 4_000),
        ...(job.location ? { location: job.location } : {}),
        requiredSkills: job.requiredSkills,
        preferredSkills: job.preferredSkills,
      },
      evidence,
      constraints: { maxChars, noNewFacts: true },
    });
    audits.push(generated.audit);
    if (generated.output.task !== "FREE_TEXT_GENERATE")
      return refusal(
        "PROVIDER_FAILED",
        "The provider returned the wrong task output.",
        audits,
        canonical,
      );
    const checked = validateGeneratedOutput({
      output: generated.output,
      evidence,
      question,
      maxChars,
    });
    if (!checked.ok)
      return refusal(
        checked.code as z.infer<typeof RefusedDraftSchema>["code"],
        checked.message,
        audits,
        canonical,
      );
    return GroundedDraftResultSchema.parse({
      status: "APPROVED",
      canonicalQuestion: canonical,
      answer: generated.output.answer,
      charCount: generated.output.answer.length,
      maxChars,
      evidence: checked.evidence,
      evidenceIds: generated.output.evidenceIds,
      claims: generated.output.claims,
      audits,
      warnings: ["AI draft: verify every sentence before using it."],
    });
  } catch (error) {
    return refusal(
      "PROVIDER_FAILED",
      error instanceof Error ? error.message : "Draft generation failed.",
      audits,
      canonical,
    );
  }
}
