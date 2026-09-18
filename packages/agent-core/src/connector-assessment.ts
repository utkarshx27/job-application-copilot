import { z } from "zod";

// Offline review records only. No browser command or site policy consumes these.
const Ref = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/);
const Time = z.number().int().nonnegative().safe();
const Origin = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.origin === value &&
      !url.username &&
      !url.password &&
      /^[a-z0-9.-]+$/.test(url.hostname) &&
      !url.hostname.includes("*")
    );
  } catch {
    return false;
  }
}, "Use an exact HTTPS origin without paths, credentials or wildcards");
export const ConnectorCapabilitySchema = z.enum([
  "DISCOVER_JOBS",
  "READ_JOB",
  "INSPECT_ACCOUNT",
  "PREPARE_FORM",
  "NAVIGATE_STEPS",
  "SUBMIT",
  "READ_CONFIRMATION",
  "COMPANY_EVIDENCE",
]);
const Method = z.enum([
  "PUBLIC_HTTP",
  "PUBLIC_API",
  "BROWSER_DOM",
  "BROWSER_ACCESSIBILITY",
  "MANUAL_IMPORT",
]);
export const AccessOutcomeSchema = z.enum([
  "OBSERVED",
  "RENDERING_PENDING",
  "LOGIN_REQUIRED",
  "CHALLENGE_PRESENT",
  "ACCESS_DENIED",
  "RATE_LIMITED",
  "JOB_EXPIRED",
  "UNSUPPORTED_LAYOUT",
  "FETCH_ERROR",
  "REDIRECT_OUT_OF_SCOPE",
]);
export const ConnectorAssessmentSchema = z
  .object({
    schemaVersion: z.literal(1),
    connector: z.enum(["LINKEDIN", "NAUKRI", "WELLFOUND", "GLASSDOOR", "EMPLOYER_ATS"]),
    version: Ref,
    scope: z
      .object({
        reference: Ref,
        reviewerReference: Ref,
        accountContextReference: Ref,
        startsAt: Time,
        expiresAt: Time,
        origins: z.array(Origin).min(1).max(20),
        // Exact paths, not prefix matches. Never store session query strings here.
        paths: z
          .array(z.string().regex(/^\/[a-zA-Z0-9_./-]*$/))
          .min(1)
          .max(100),
        capabilities: z.array(ConnectorCapabilitySchema).min(1).max(8),
        methods: z.array(Method).min(1).max(5),
        maxPages: z.number().int().min(1).max(20),
        minIntervalMs: z.number().int().min(5000).max(86400000),
        maxConcurrent: z.literal(1),
        retentionDays: z.number().int().min(0).max(30),
      })
      .strict()
      .refine((s) => s.expiresAt > s.startsAt, "Scope expiry must follow its start")
      .nullable(),
    gates: z
      .object({
        ag09HeldOutReview: Ref.nullable(),
        fiveUserStudyReview: Ref.nullable(),
        threatReview: Ref.nullable(),
        compatibilityReview: Ref.nullable(),
        rollbackReview: Ref.nullable(),
        policyReview: Ref.nullable(),
      })
      .strict(),
    observations: z
      .array(
        z
          .object({
            capability: ConnectorCapabilitySchema,
            method: Method,
            at: Time,
            outcome: AccessOutcomeSchema,
            sampleSize: z.number().int().min(1).max(20),
            httpStatus: z.number().int().min(100).max(599).nullable(),
            retryAfterSeconds: z.number().int().min(0).max(604800).nullable(),
            origin: Origin,
            evidenceReference: Ref,
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export type ConnectorAssessment = z.infer<typeof ConnectorAssessmentSchema>;

export function emptyConnectorAssessment(
  connector: ConnectorAssessment["connector"],
): ConnectorAssessment {
  return {
    schemaVersion: 1,
    connector,
    version: "assessment-v1",
    scope: null,
    gates: {
      ag09HeldOutReview: null,
      fiveUserStudyReview: null,
      threatReview: null,
      compatibilityReview: null,
      rollbackReview: null,
      policyReview: null,
    },
    observations: [],
  };
}

// A pure checklist check, NOT network authorization or SSRF protection. DNS,
// redirects and each browser navigation need independent runtime enforcement.
export function assessmentTargetInScope(input: unknown, target: string, now: number): boolean {
  const parsed = ConnectorAssessmentSchema.safeParse(input);
  if (!parsed.success || !Number.isSafeInteger(now)) return false;
  const scope = parsed.data.scope;
  if (!scope || now < scope.startsAt || now >= scope.expiresAt) return false;
  try {
    const url = new URL(target);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.href === target &&
      scope.origins.includes(url.origin) &&
      scope.paths.includes(url.pathname)
    );
  } catch {
    return false;
  }
}

export function connectorAssessmentReport(input: unknown, now: number) {
  const record = ConnectorAssessmentSchema.parse(input);
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid report time");
  const blockers: string[] = [];
  if (!record.scope) blockers.push("MISSING_SCOPE");
  else if (now < record.scope.startsAt || now >= record.scope.expiresAt)
    blockers.push("INACTIVE_SCOPE");
  for (const [gate, reference] of Object.entries(record.gates)) {
    if (!reference) blockers.push(`MISSING_${gate}`);
  }
  if (record.observations.some((o) => o.at > now)) blockers.push("FUTURE_OBSERVATION");
  // Only enum/count/date fields escape to the public report: no account, scope,
  // URL, evidence reference, raw page content, answer or credential is exported.
  const capabilities = ConnectorCapabilitySchema.options.map((capability) => {
    const observations = record.observations.filter((o) => o.capability === capability);
    const latest = [...observations].sort((a, b) => b.at - a.at)[0];
    const scoped =
      !!record.scope &&
      record.scope.capabilities.includes(capability) &&
      observations.every(
        (o) =>
          record.scope!.origins.includes(o.origin) &&
          record.scope!.methods.includes(o.method) &&
          o.at >= record.scope!.startsAt &&
          o.at < record.scope!.expiresAt &&
          o.at <= now,
      );
    return {
      capability,
      status: !latest
        ? "UNASSESSED"
        : scoped && latest.outcome === "OBSERVED"
          ? "OBSERVATIONS_REQUIRE_REVIEW"
          : "BLOCKED_OR_UNVERIFIED",
      sampleSize: observations.reduce((sum, o) => sum + o.sampleSize, 0),
      methods: [...new Set(observations.map((o) => o.method))],
      lastObservedAt: latest?.at ?? null,
      outcomes: AccessOutcomeSchema.options
        .map((outcome) => ({
          outcome,
          count: observations.filter((o) => o.outcome === outcome).length,
        }))
        .filter((entry) => entry.count > 0),
    };
  });
  return {
    schemaVersion: 1,
    connector: record.connector,
    generatedAt: now,
    liveEnabled: false,
    releaseAccepted: false,
    authorizationIndependentlyVerified: false,
    readiness: blockers.length ? "BLOCKED" : "REQUIRES_INDEPENDENT_REVIEW",
    blockers,
    capabilities,
    next: "Review original scope and gate evidence independently; manual/import handoff only. This report cannot enable a connector.",
  };
}
