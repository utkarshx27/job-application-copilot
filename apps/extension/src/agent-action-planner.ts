import {
  AgentError,
  AgentObservationSchema,
  AgentProposalSchema,
  type AgentProposal,
} from "@copilot/agent-core";
import {
  InferenceRequestSchema,
  validateInferenceOutput,
  type InferenceRequest,
} from "@copilot/ai-gateway";
import type { ApprovedLocalFact, LocalSnapshot } from "./agent-document-executor";

export type ReviewedLocalMapping = ApprovedLocalFact & { semantic: string };

/** AG-04/05 boundary: interpret identifiers, never copy model text into a field.
 * Mappings must come from reviewed deterministic matches, not model output.
 * This module neither calls a provider nor grants execution authority.
 */
export function prepareLocalAction(snapshot: LocalSnapshot, mappings: ReviewedLocalMapping[]) {
  const observation = AgentObservationSchema.parse(snapshot.observation);
  const approved = structuredClone(mappings);
  const targets = structuredClone(snapshot.targets);
  if (
    targets.length !== observation.targetRefs.length ||
    new Set(targets.map((x) => x.id)).size !== targets.length ||
    targets.some((x) => !observation.targetRefs.includes(x.id))
  )
    throw new AgentError("UNKNOWN_TARGET");
  for (const mapping of approved) {
    if (
      mapping.profileRevision !== observation.binding.profileRevision ||
      typeof mapping.value !== "string" ||
      !mapping.value ||
      mapping.value.length > 2000 ||
      !targets.some((x) => x.id === mapping.targetRef)
    )
      throw new AgentError("UNAPPROVED_VALUE");
  }
  if (new Set(approved.map((x) => x.targetRef)).size !== approved.length)
    throw new AgentError("AMBIGUOUS_MAPPING");
  const facts = new Map<string, ReviewedLocalMapping>();
  for (const mapping of approved) {
    const previous = facts.get(mapping.factRef);
    if (previous && (previous.semantic !== mapping.semantic || previous.value !== mapping.value))
      throw new AgentError("CONFLICTING_FACT");
    facts.set(mapping.factRef, mapping);
  }
  const request: InferenceRequest = InferenceRequestSchema.parse({
    task: "ACTION_PROPOSE",
    observationRef: observation.id,
    sources: [],
    canonicalCandidates: [],
    facts: [...facts.values()].map((x) => ({
      id: x.factRef,
      semantic: x.semantic,
      summary: "Reviewed value available; contents withheld from action planning.",
    })),
    targets: targets.map((target) => ({
      id: target.id,
      label: target.label,
      manualOnly: !approved.some((x) => x.targetRef === target.id),
      allowedActions: approved.some((x) => x.targetRef === target.id) ? [target.kind] : [],
      allowedFactRefs: approved.filter((x) => x.targetRef === target.id).map((x) => x.factRef),
    })),
  });
  return {
    request: structuredClone(request),
    // Deterministic first: no model call is needed to fill an approved mapping.
    deterministic() {
      const mapping = approved[0];
      const target = targets.find((x) => x.id === mapping?.targetRef);
      return {
        task: "ACTION_PROPOSE",
        observationRef: observation.id,
        action:
          target && mapping
            ? { kind: target.kind, targetRef: target.id, factRef: mapping.factRef }
            : null,
        reason: target
          ? "Reviewed deterministic mapping"
          : "No reviewed mapping; manual completion required",
      };
    },
    accept(
      raw: unknown,
      runId: string,
      expiresAt: number,
      costMicros = 0,
    ): { proposal: AgentProposal; fact: ApprovedLocalFact } | null {
      const output = validateInferenceOutput(request, raw);
      if (output.task !== "ACTION_PROPOSE") throw new AgentError("WRONG_TASK");
      if (!output.action) return null;
      const action = output.action;
      const fact = approved.find(
        (x) => x.targetRef === action.targetRef && x.factRef === action.factRef,
      );
      if (!fact || (action.kind !== "FILL_TEXT" && action.kind !== "SELECT_OPTION"))
        throw new AgentError("UNAPPROVED_VALUE");
      return {
        proposal: AgentProposalSchema.parse({
          id: crypto.randomUUID(),
          runId,
          observationId: observation.id,
          kind: action.kind,
          targetRef: action.targetRef,
          factRefs: [action.factRef],
          expected: "VALUE_MATCHED",
          expiresAt,
          costMicros,
        }),
        fact: {
          targetRef: fact.targetRef,
          factRef: fact.factRef,
          value: fact.value,
          profileRevision: fact.profileRevision,
        },
      };
    },
  };
}
