import type { CandidateProfile } from "@copilot/candidate-schema";
import {
  FieldMappingSchema,
  FormAnalysisSchema,
  type CanonicalQuestion,
  type FieldMapping,
  type FormAnalysis,
  type PageSnapshot,
  type RawField,
} from "@copilot/form-schema";

type RuleResult = {
  canonicalQuestion: CanonicalQuestion;
  confidence: number;
  tier: "R0" | "R1" | "R2";
  evidence: string[];
};

type ExpectedMapping = Record<string, string | null>;

function normalized(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(field: RawField): string {
  return normalized(
    [
      field.name,
      field.domId,
      field.accessibleName,
      field.labelText,
      field.ariaLabel,
      field.placeholder,
      field.groupLabel,
    ].join(" "),
  );
}

const AUTOCOMPLETE_RULES: Record<string, CanonicalQuestion> = {
  name: "IDENTITY.legal_name.full",
  "given-name": "IDENTITY.legal_name.given",
  "family-name": "IDENTITY.legal_name.family",
  email: "CONTACT.email",
  tel: "CONTACT.phone",
  "tel-national": "CONTACT.phone",
  country: "ADDRESS.country",
  "country-name": "ADDRESS.country",
};

function exactMachineRule(field: RawField): RuleResult | null {
  const autocomplete = normalized(field.autocomplete).replace(/ /g, "-");
  const autocompleteMatch = AUTOCOMPLETE_RULES[autocomplete];
  if (autocompleteMatch) {
    return {
      canonicalQuestion: autocompleteMatch,
      confidence: 0.999,
      tier: "R0",
      evidence: [`autocomplete:${field.autocomplete}`],
    };
  }

  const machine = normalized(`${field.name} ${field.domId}`);
  const rules: Array<[RegExp, CanonicalQuestion]> = [
    [/\b(first name|firstname|given name|givenname)\b/, "IDENTITY.legal_name.given"],
    [/\b(last name|lastname|family name|familyname|surname)\b/, "IDENTITY.legal_name.family"],
    [/\b(full name|fullname|legal name|legalname)\b/, "IDENTITY.legal_name.full"],
    [/\b(e mail|email|email address)\b/, "CONTACT.email"],
    [/\b(phone|phone number|mobile|mobile number|telephone)\b/, "CONTACT.phone"],
    [/\b(country|country code|country name)\b/, "ADDRESS.country"],
    [/\b(portfolio|portfolio url|personal website|website)\b/, "LINKS.portfolio"],
    [/\b(github|github url)\b/, "LINKS.github"],
    [/\b(linkedin|linkedin url)\b/, "LINKS.linkedin"],
    [
      /\b(current sponsorship|sponsorship now|require sponsorship)\b/,
      "WORK_AUTH.current_sponsorship",
    ],
    [/\b(future sponsorship|sponsorship future)\b/, "WORK_AUTH.future_sponsorship"],
    [
      /\b(currently authorized|work authorization|legally authorized)\b/,
      "WORK_AUTH.currently_authorized",
    ],
    [/\b(visa type|visa status)\b/, "WORK_AUTH.visa_type"],
    [/\b(cover letter|coverletter)\b/, "APPLICATION.cover_letter"],
    [/\b(terms|consent|privacy consent)\b/, "CONSENT.terms"],
  ];
  const match = rules.find(([pattern]) => pattern.test(machine));
  return match
    ? {
        canonicalQuestion: match[1],
        confidence: 0.995,
        tier: "R0",
        evidence: [`machine:${machine}`],
      }
    : null;
}

function semanticLabelRule(field: RawField): RuleResult | null {
  const text = tokens(field);
  const rules: Array<[RegExp, CanonicalQuestion, number]> = [
    [/\b(first|given) name\b/, "IDENTITY.legal_name.given", 0.985],
    [/\b(last|family) name\b|\bsurname\b/, "IDENTITY.legal_name.family", 0.985],
    [/\b(full|legal) name\b/, "IDENTITY.legal_name.full", 0.98],
    [/\be ?mail( address)?\b/, "CONTACT.email", 0.99],
    [/\b(phone|mobile|telephone)( number)?\b/, "CONTACT.phone", 0.98],
    [/\bcountry\b/, "ADDRESS.country", 0.97],
    [/\bportfolio\b|\bpersonal (site|website)\b/, "LINKS.portfolio", 0.98],
    [/\bgithub\b/, "LINKS.github", 0.99],
    [/\blinked ?in\b/, "LINKS.linkedin", 0.99],
    [
      /\b(now|currently).*\bsponsor|\bsponsor.*\b(now|currently)\b/,
      "WORK_AUTH.current_sponsorship",
      0.975,
    ],
    [
      /\b(future|later).*\bsponsor|\bsponsor.*\b(future|later)\b/,
      "WORK_AUTH.future_sponsorship",
      0.975,
    ],
    [
      /\b(legally|currently).*\bauthori[sz]ed|\bwork authori[sz]ation\b/,
      "WORK_AUTH.currently_authorized",
      0.975,
    ],
    [/\bvisa (type|status)\b/, "WORK_AUTH.visa_type", 0.98],
    [/\bcover letter\b/, "APPLICATION.cover_letter", 0.98],
    [/\b(accept|agree).*\b(terms|privacy)|\bconsent\b/, "CONSENT.terms", 0.95],
  ];
  const match = rules.find(([pattern]) => pattern.test(text));
  return match
    ? {
        canonicalQuestion: match[1],
        confidence: match[2],
        tier: "R1",
        evidence: [`semantic:${text}`],
      }
    : null;
}

export function classifyField(field: RawField): FieldMapping {
  const rule = exactMachineRule(field) ?? semanticLabelRule(field);
  if (!rule) {
    return FieldMappingSchema.parse({
      fieldId: field.fieldId,
      canonicalQuestion: null,
      confidence: 0,
      tier: "UNMAPPED",
      evidence: [],
      fillable: false,
      blockedReason: "No deterministic semantic rule matched.",
    });
  }
  return FieldMappingSchema.parse({
    fieldId: field.fieldId,
    ...rule,
    fillable: false,
  });
}

function triStateValue(value: "YES" | "NO" | "UNKNOWN" | null | undefined): string | null {
  if (value === "YES") return "yes";
  if (value === "NO") return "no";
  return null;
}

function profileValue(profile: CandidateProfile, canonical: CanonicalQuestion): string | null {
  const name = profile.identity.legalName.value;
  const authorization = profile.workAuthorization[0];
  switch (canonical) {
    case "IDENTITY.legal_name.full":
      return name?.full ?? null;
    case "IDENTITY.legal_name.given":
      return name?.given ?? null;
    case "IDENTITY.legal_name.family":
      return name?.family ?? null;
    case "CONTACT.email":
      return profile.contact.emails[0]?.value?.address ?? null;
    case "CONTACT.phone":
      return profile.contact.phones[0]?.value?.e164 ?? null;
    case "ADDRESS.country":
      return profile.contact.addresses[0]?.value?.countryCode ?? null;
    case "LINKS.portfolio":
      return profile.links.portfolio?.value ?? null;
    case "LINKS.github":
      return profile.links.github?.value ?? null;
    case "LINKS.linkedin":
      return profile.links.linkedin?.value ?? null;
    case "WORK_AUTH.currently_authorized":
      return triStateValue(authorization?.currentlyAuthorized.value);
    case "WORK_AUTH.current_sponsorship":
      return triStateValue(authorization?.currentSponsorshipRequired.value);
    case "WORK_AUTH.future_sponsorship":
      return triStateValue(authorization?.futureSponsorshipRequired.value);
    case "WORK_AUTH.visa_type":
      return authorization?.visaType?.value ?? null;
    case "APPLICATION.cover_letter":
    case "CONSENT.terms":
      return null;
  }
}

function operationFor(field: RawField, value: string) {
  if (field.controlKind === "select-one" || field.controlKind === "select-multiple") {
    const option = field.options.find(
      (candidate) =>
        normalized(candidate.value) === normalized(value) ||
        normalized(candidate.text) === normalized(value),
    );
    return option ? { kind: "select" as const, value: option.value } : undefined;
  }
  if (field.controlKind === "radio") {
    return normalized(field.optionValue) === normalized(value)
      ? { kind: "check" as const, checked: true }
      : undefined;
  }
  if (field.controlKind === "checkbox") {
    if (value !== "yes" && value !== "no") return undefined;
    return { kind: "check" as const, checked: value === "yes" };
  }
  if (field.controlKind === "file" || field.controlKind === "other") return undefined;
  return { kind: "text" as const, value };
}

export function analyzeForm(
  snapshot: PageSnapshot,
  profile: CandidateProfile,
  analysisId: string = crypto.randomUUID(),
): FormAnalysis {
  const mappings = snapshot.fields.map((field) => {
    const classified = classifyField(field);
    if (!classified.canonicalQuestion) return classified;
    const value = profileValue(profile, classified.canonicalQuestion);
    const operation = value === null ? undefined : operationFor(field, value);
    const blockedReason = field.userEdited
      ? "You edited this field after the last copilot fill."
      : field.disabled || field.readOnly
        ? "The field is disabled or read-only."
        : value === null
          ? "No verified profile value is available."
          : operation
            ? undefined
            : "The verified value does not match an available control option.";
    return FieldMappingSchema.parse({
      ...classified,
      ...(operation ? { operation } : {}),
      fillable: Boolean(operation && !blockedReason),
      ...(blockedReason ? { blockedReason } : {}),
    });
  });
  return FormAnalysisSchema.parse({
    analysisVersion: 1,
    analysisId,
    snapshot,
    mappings,
  });
}

export function precisionForExpected(
  mappings: FieldMapping[],
  expected: ExpectedMapping,
): { correct: number; predicted: number; precision: number } {
  let correct = 0;
  let predicted = 0;
  for (const mapping of mappings) {
    if (mapping.tier !== "R0" && mapping.tier !== "R1") continue;
    predicted += 1;
    if (mapping.canonicalQuestion === expected[mapping.fieldId]) correct += 1;
  }
  return { correct, predicted, precision: predicted === 0 ? 1 : correct / predicted };
}
