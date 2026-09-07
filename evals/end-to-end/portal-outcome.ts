import type { PortalRun } from "./portal-driver";

export type PortalLedger = {
  outcomes: {
    applicationId: string;
    scenarioId: string;
    correct: boolean;
    acceptedCount: number;
    duplicateAttempts: number;
    uploadRetained: boolean;
  }[];
  sessions: { id: string; stage: string; attempts: number }[];
};
// This evaluator belongs to the runner. The browser driver never receives it or
// the ground-truth ledger, so a confirmation screen cannot grade its own success.
export function evaluatePortalOutcome(run: PortalRun, ledger: PortalLedger): string {
  const accepted = ledger.outcomes.find((item) => item.applicationId === run.applicationId);
  if (run.state === "PAGE_CONFIRMATION" && !accepted) return "FALSE_CONFIRMATION";
  if (accepted && !accepted.correct) return "INCORRECT_APPLICATION";
  if (accepted && accepted.acceptedCount !== 1) return "DUPLICATE_ACCEPTED";
  if (run.state === "IDENTITY_MISMATCH") return "IDENTITY_MISMATCH";
  if (accepted && run.state === "OUTCOME_UNKNOWN") return "ACCEPTED_RESPONSE_LOST";
  if (accepted && accepted.duplicateAttempts > 0) return "DUPLICATE_BLOCKED";
  if (accepted && run.state === "PAGE_CONFIRMATION") return "CORRECT_APPLICATION";
  if (
    !accepted &&
    ["NEEDS_ANSWER", "NEEDS_MANUAL", "PAUSED_ACCESS", "PAUSED_CLOSED_TAB"].includes(run.state)
  )
    return "PAUSED_WITHOUT_SUBMISSION";
  return "UNVERIFIED";
}
