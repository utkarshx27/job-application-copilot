import {
  ReuseScopeSchema,
  SavedResponseSchema,
  type ReuseScope,
  type SavedResponse,
} from "@copilot/candidate-schema";
import {
  QUESTION_ONTOLOGY_VERSION,
  QuestionClassificationSchema,
  QuestionRiskSchema,
  allowedScopesForRisk,
  classifyQuestion,
  freshnessDaysFor,
  normalizeQuestion,
  semanticQuestionSimilarity,
  sensitivityForRisk,
  type QuestionClassification,
  type QuestionRisk,
} from "@copilot/question-ontology";
import { z } from "zod";

export const SavedResponseContextSchema = z.object({
  applicationId: z.string().min(1).optional(),
  company: z.string().min(1).optional(),
  countryCode: z.string().length(2).toUpperCase().optional(),
  role: z.string().min(1).optional(),
  ats: z.string().min(1).optional(),
});

export const SavedResponseSuggestionSchema = z.object({
  status: z.enum(["MATCH", "REVIEW", "STALE", "NONE"]),
  classification: QuestionClassificationSchema,
  risk: QuestionRiskSchema.nullable(),
  allowedScopes: z.array(ReuseScopeSchema),
  responseId: z.string().min(1).optional(),
  answer: z.string().optional(),
  method: z.enum(["EXACT_CANONICAL", "EXACT_QUESTION", "ALIAS", "KEYWORD", "SEMANTIC"]).optional(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});

export type SavedResponseContext = z.infer<typeof SavedResponseContextSchema>;
export type SavedResponseSuggestion = z.infer<typeof SavedResponseSuggestionSchema>;

function scopeKeyFor(scope: ReuseScope, context: SavedResponseContext) {
  if (scope === "APPLICATION") {
    if (!context.applicationId)
      throw new Error("Application-scoped answers require an application ID.");
    return { applicationId: context.applicationId };
  }
  if (scope === "COMPANY") {
    if (!context.company) throw new Error("Company-scoped answers require a detected company.");
    return { company: normalizeQuestion(context.company) };
  }
  if (scope === "COUNTRY") {
    if (!context.countryCode)
      throw new Error("Country-scoped answers require a known job country.");
    return { countryCode: context.countryCode.toUpperCase() };
  }
  if (scope === "ROLE") {
    if (!context.role) throw new Error("Role-scoped answers require a detected role.");
    return { role: normalizeQuestion(context.role) };
  }
  return undefined;
}

function scopeMatches(response: SavedResponse, context: SavedResponseContext): boolean {
  if (response.reuseScope === "GLOBAL") return true;
  if (response.reuseScope === "APPLICATION")
    return Boolean(
      response.scopeKey?.applicationId &&
      context.applicationId &&
      response.scopeKey.applicationId === context.applicationId,
    );
  if (response.reuseScope === "COMPANY")
    return Boolean(
      response.scopeKey?.company &&
      context.company &&
      normalizeQuestion(response.scopeKey.company) === normalizeQuestion(context.company),
    );
  if (response.reuseScope === "COUNTRY")
    return Boolean(
      response.scopeKey?.countryCode &&
      context.countryCode &&
      response.scopeKey.countryCode.toUpperCase() === context.countryCode.toUpperCase(),
    );
  return Boolean(
    response.scopeKey?.role &&
    context.role &&
    normalizeQuestion(response.scopeKey.role) === normalizeQuestion(context.role),
  );
}

function answerText(response: SavedResponse): string | null {
  if (typeof response.answer === "string") return response.answer;
  if (typeof response.answer === "number" || typeof response.answer === "boolean")
    return String(response.answer);
  return null;
}

function riskForSensitivity(response: SavedResponse): QuestionRisk {
  if (response.sensitivity === "HIGHLY_SENSITIVE") return "R4";
  if (response.sensitivity === "SENSITIVE") return "R3";
  if (response.sensitivity === "PERSONAL") return "R2";
  if (response.sensitivity === "PROFESSIONAL") return "R1";
  return "R0";
}

function allowedScopes(classification: QuestionClassification): ReuseScope[] {
  if (classification.decision === "UNMAPPED") return ["APPLICATION", "COMPANY"];
  return [...allowedScopesForRisk(classification.risk)];
}

function expiryFor(response: SavedResponse): string {
  if (response.expiresAt) return response.expiresAt;
  const days = freshnessDaysFor(response.canonicalQuestion ?? null);
  return new Date(Date.parse(response.verifiedAt) + days * 86_400_000).toISOString();
}

function isFresh(response: SavedResponse, now: string): boolean {
  return Date.parse(expiryFor(response)) > Date.parse(now);
}

type RankedResponse = {
  response: SavedResponse;
  method: "EXACT_CANONICAL" | "EXACT_QUESTION" | "ALIAS" | "KEYWORD" | "SEMANTIC";
  confidence: number;
};

function rankResponse(
  question: string,
  classification: QuestionClassification,
  response: SavedResponse,
): RankedResponse | null {
  const normalized = normalizeQuestion(question);
  if (
    classification.canonicalQuestion &&
    response.canonicalQuestion === classification.canonicalQuestion
  ) {
    const method =
      classification.method === "EXACT_ALIAS"
        ? "ALIAS"
        : classification.method === "KEYWORD_RULE"
          ? "KEYWORD"
          : classification.method === "SEMANTIC"
            ? "SEMANTIC"
            : "EXACT_CANONICAL";
    return { response, method, confidence: classification.confidence };
  }
  if (response.normalizedQuestion === normalized)
    return { response, method: "EXACT_QUESTION", confidence: 1 };
  if (classification.risk === "R2" || classification.risk === "R3" || classification.risk === "R4")
    return null;
  if (response.normalizedQuestion) {
    const score = semanticQuestionSimilarity(normalized, response.normalizedQuestion);
    if (score >= 0.8) return { response, method: "SEMANTIC", confidence: score };
  }
  return null;
}

export function matchSavedResponse(
  question: string,
  responseInputs: SavedResponse[],
  contextInput: SavedResponseContext,
  now = new Date().toISOString(),
): SavedResponseSuggestion {
  const context = SavedResponseContextSchema.parse(contextInput);
  const classification = classifyQuestion(question);
  const policyScopes = allowedScopes(classification).filter((scope) => {
    try {
      scopeKeyFor(scope, context);
      return true;
    } catch {
      return scope === "GLOBAL";
    }
  });
  if (classification.risk === "R4") {
    return SavedResponseSuggestionSchema.parse({
      status: "REVIEW",
      classification,
      risk: "R4",
      allowedScopes: [],
      confidence: 0,
      reason: "Highly sensitive answers are never inferred, suggested, or reused.",
    });
  }
  if (classification.decision === "REVIEW") {
    return SavedResponseSuggestionSchema.parse({
      status: "REVIEW",
      classification,
      risk: classification.risk,
      allowedScopes: policyScopes,
      confidence: 0,
      reason: "The wording is consequential or ambiguous and requires a fresh manual answer.",
    });
  }

  const ranked = responseInputs
    .map((input) => SavedResponseSchema.parse(input))
    .filter((response) => scopeMatches(response, context))
    .flatMap((response) => {
      const candidate = rankResponse(question, classification, response);
      return candidate ? [candidate] : [];
    })
    .sort((left, right) => right.confidence - left.confidence);
  const best = ranked[0];
  if (!best) {
    return SavedResponseSuggestionSchema.parse({
      status: "NONE",
      classification,
      risk: classification.risk,
      allowedScopes: policyScopes,
      confidence: 0,
      reason: "No in-scope saved response matched safely.",
    });
  }

  const effectiveRisk = classification.risk ?? riskForSensitivity(best.response);
  if (
    effectiveRisk === "R4" ||
    (effectiveRisk === "R3" &&
      (best.response.source !== "USER_CONFIRMED" ||
        !best.response.canonicalQuestion ||
        (best.response.reuseScope !== "APPLICATION" && best.response.reuseScope !== "COUNTRY")))
  ) {
    return SavedResponseSuggestionSchema.parse({
      status: "REVIEW",
      classification,
      risk: effectiveRisk,
      allowedScopes: policyScopes,
      confidence: 0,
      reason:
        "This consequential answer lacks the explicit source or narrow scope required for reuse.",
    });
  }

  const answer = answerText(best.response);
  const expiresAt = expiryFor(best.response);
  if (!answer || !isFresh(best.response, now)) {
    return SavedResponseSuggestionSchema.parse({
      status: "STALE",
      classification,
      risk: effectiveRisk,
      allowedScopes: policyScopes,
      responseId: best.response.id,
      method: best.method,
      confidence: best.confidence,
      expiresAt,
      reason: "A matching response exists but must be re-confirmed before use.",
    });
  }

  return SavedResponseSuggestionSchema.parse({
    status: "MATCH",
    classification,
    risk: effectiveRisk,
    allowedScopes: policyScopes,
    responseId: best.response.id,
    answer,
    method: best.method,
    confidence: best.confidence,
    expiresAt,
    reason: "A fresh, in-scope user-confirmed response matched. Review it before filling.",
  });
}

export function createSavedResponse(options: {
  id?: string;
  question: string;
  answer: string;
  reuseScope: ReuseScope;
  context: SavedResponseContext;
  now?: string;
}): SavedResponse {
  const now = options.now ?? new Date().toISOString();
  const context = SavedResponseContextSchema.parse(options.context);
  const scope = ReuseScopeSchema.parse(options.reuseScope);
  const classification = classifyQuestion(options.question);
  const allowed = allowedScopes(classification);
  if (classification.risk === "R4")
    throw new Error("Highly sensitive answers cannot be saved by the teach-once workflow.");
  if (!allowed.includes(scope))
    throw new Error("This question's risk policy does not allow the selected reuse scope.");
  if (classification.risk === "R3" && classification.decision !== "MATCH")
    throw new Error("Ambiguous consequential questions must be answered manually without saving.");
  const answer = options.answer.trim();
  if (!answer) throw new Error("A saved response cannot be empty.");
  const normalized = normalizeQuestion(options.question);
  const days = freshnessDaysFor(classification.canonicalQuestion);
  const scopeKey = scopeKeyFor(scope, context);
  return SavedResponseSchema.parse({
    id: options.id ?? `response-${crypto.randomUUID()}`,
    ontologyVersion: QUESTION_ONTOLOGY_VERSION,
    ...(classification.decision === "MATCH" && classification.canonicalQuestion
      ? { canonicalQuestion: classification.canonicalQuestion }
      : {}),
    normalizedQuestion: normalized,
    keywords: [...new Set(normalized.split(" ").filter((word) => word.length >= 3))],
    answer,
    source: "USER_CONFIRMED",
    sensitivity:
      classification.decision === "UNMAPPED" ? "PERSONAL" : sensitivityForRisk(classification.risk),
    reuseScope: scope,
    ...(scopeKey ? { scopeKey } : {}),
    createdAt: now,
    verifiedAt: now,
    expiresAt: new Date(Date.parse(now) + days * 86_400_000).toISOString(),
  });
}
