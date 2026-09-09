/** Read-only proposal review. This result never grants dispatch authority. */
export type VisualControl = {
  id: string;
  label: string;
  kind: "button" | "input";
  inputType: string;
  disabled: boolean;
  visible: boolean;
  valuePresent: boolean;
};
export type VisualReviewSnapshot = {
  capturedAt: number;
  challenge: boolean;
  controls: VisualControl[];
};
export function reviewVisualProposal(
  proposal: unknown,
  snapshot: VisualReviewSnapshot,
  now: number,
) {
  const pause = (reason: string) => ({ target: "NONE", reason });
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(snapshot.capturedAt) ||
    now < snapshot.capturedAt ||
    now - snapshot.capturedAt > 60_000
  )
    return pause("STALE_OBSERVATION");
  if (snapshot.challenge) return pause("ACCESS_CHALLENGE");
  if (
    !proposal ||
    typeof proposal !== "object" ||
    Array.isArray(proposal) ||
    Object.keys(proposal).length !== 1 ||
    !("target" in proposal) ||
    typeof proposal.target !== "string"
  )
    return pause("INVALID_PROPOSAL");
  if (proposal.target === "NONE") return pause("MODEL_PAUSED");
  const matches = snapshot.controls.filter((control) => control.id === proposal.target);
  if (matches.length !== 1) return pause("UNKNOWN_TARGET");
  const control = matches[0]!;
  if (!control.visible || control.disabled || control.valuePresent)
    return pause("UNAVAILABLE_CONTROL");
  if (
    !control.label.trim() ||
    /consent|agree|terms|privacy|authorization|citizenship|disability|veteran|gender|ethnic|password|social security|submit|send application/i.test(
      control.label,
    )
  )
    return pause("MANUAL_CONTROL");
  if (control.kind === "button") {
    if (control.inputType !== "button" || !/^(next|continue)$/i.test(control.label.trim()))
      return pause("UNSUPPORTED_BUTTON");
  } else if (!["text", "email", "tel", "url"].includes(control.inputType))
    return pause("UNSUPPORTED_INPUT");
  return { target: control.id, reason: "REVIEWABLE_PROPOSAL" };
}
