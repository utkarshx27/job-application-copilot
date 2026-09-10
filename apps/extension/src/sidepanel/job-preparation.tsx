import { useEffect, useRef, useState } from "react";
import { PreparationViewSchema, PreparationForgottenSchema } from "@copilot/agent-core";
import type { z } from "zod";
import type { PanelRequest } from "@copilot/browser-command-schema";
import { sendPanelRequest } from "./panel-shared";
import { CompletePreparationOptions, PreparationProgress } from "./complete-preparation";

export function JobPreparationPanel({ jobId }: { jobId: string }) {
  const [view, setView] = useState<z.infer<typeof PreparationViewSchema> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [city, setCity] = useState("");
  const [arrangement, setArrangement] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const generation = useRef(0);
  async function request(input: PanelRequest, poll = false) {
    const expectedGeneration =
      input.type === "PANEL_PREPARATION_REVIEW" ? ++generation.current : generation.current;
    if (!poll) {
      setBusy(true);
      setError("");
    }
    try {
      const response = await sendPanelRequest(input);
      if (generation.current !== expectedGeneration) return;
      if (!response.ok) throw new Error(response.error.message);
      if (input.type === "PANEL_PREPARATION_FORGET") {
        PreparationForgottenSchema.parse(response.data);
        generation.current++;
        setView(null);
        setConfirmed(false);
        setCity("");
        setArrangement("");
        return;
      }
      const next = PreparationViewSchema.parse(response.data);
      setView((prior) =>
        prior?.record.id === next.record.id && prior.record.revision > next.record.revision
          ? prior
          : next,
      );
      if (input.type === "PANEL_PREPARATION_REVIEW") {
        setCity(next.record.answers?.currentLocation ?? next.contact.currentLocation);
        setArrangement(next.record.answers?.workArrangement ?? "");
        setConfirmed(false);
      }
    } catch (cause) {
      if (!poll && generation.current === expectedGeneration)
        setError(cause instanceof Error ? cause.message : "Preparation unavailable.");
    } finally {
      if (
        !poll &&
        (generation.current === expectedGeneration || input.type === "PANEL_PREPARATION_FORGET")
      )
        setBusy(false);
    }
  }
  const id = view?.record.id;
  useEffect(() => {
    if (!id) return;
    const timer = setInterval(() => {
      void request({ type: "PANEL_PREPARATION_GET", id }, true);
    }, 1000);
    return () => clearInterval(timer);
  }, [id]);
  const record = view?.record;
  return (
    <section aria-label={`Preparation for ${jobId}`}>
      <h4>Local application preparation</h4>
      <p>
        Review your verified contact details and job-specific answers. Choose first-screen filling
        or complete preparation through local review. Submission requires a separate approval.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void request({ type: "PANEL_PREPARATION_REVIEW", jobId })}
      >
        Review local preparation
      </button>
      {error && <p role="alert">{error}</p>}
      {record && view && (
        <>
          <h5>
            {record.job.title} · {record.job.company} · {record.job.location}
          </h5>
          <p>
            Profile revision {record.owner.profileRevision} · {record.state.replaceAll("_", " ")}
          </p>
          <p role="status">{record.reason}</p>
          <dl>
            <dt>Full name</dt>
            <dd>{(record.answers?.name ?? view.contact.name) || "Not verified"}</dd>
            <dt>Email</dt>
            <dd>{(record.answers?.email ?? view.contact.email) || "Not verified"}</dd>
            <dt>Phone</dt>
            <dd>{(record.answers?.phone ?? view.contact.phone) || "Not verified"}</dd>
          </dl>
          {view.blockers.map((blocker) => (
            <p key={blocker}>{blocker}</p>
          ))}
          {record.state === "REVIEW_REQUIRED" && (
            <>
              <label>
                Current city for this application
                <input
                  value={city}
                  onChange={(event) => {
                    setCity(event.target.value);
                    setConfirmed(false);
                  }}
                  maxLength={300}
                />
              </label>
              <label>
                Work arrangement for this application
                <select
                  aria-label="Work arrangement for this application"
                  value={arrangement}
                  onChange={(event) => {
                    setArrangement(event.target.value);
                    setConfirmed(false);
                  }}
                >
                  <option value="">Choose your answer</option>
                  <option>Remote</option>
                  <option>Hybrid</option>
                  <option>On-site</option>
                </select>
              </label>
              <p>
                These two answers apply only to this preparation. They are not saved as profile
                facts.
              </p>
              {record.job.applicationUrl?.includes("scenario=portal-01&") && (
                <>
                  <label>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    I approve these answers for this local job and first screen only
                  </label>
                  <button
                    type="button"
                    disabled={
                      busy || !confirmed || !city.trim() || !arrangement || !!view.blockers.length
                    }
                    onClick={() => {
                      if (
                        arrangement !== "Remote" &&
                        arrangement !== "Hybrid" &&
                        arrangement !== "On-site"
                      )
                        return;
                      void request({
                        type: "PANEL_PREPARATION_APPROVE",
                        id: record.id,
                        revision: record.revision,
                        confirmed: true,
                        answers: { currentLocation: city, workArrangement: arrangement },
                      });
                    }}
                  >
                    Prepare local first screen
                  </button>
                </>
              )}
              <CompletePreparationOptions
                record={record}
                city={city}
                arrangement={arrangement}
                blocked={!!view.blockers.length}
                busy={busy}
                request={request}
              />
            </>
          )}
          <PreparationProgress record={record} busy={busy} request={request} />
          {!["CANCELLED", "SUBMITTING", "SUBMITTED", "OUTCOME_UNKNOWN"].includes(record.state) && (
            <button
              type="button"
              onClick={() =>
                void request({
                  type: "PANEL_PREPARATION_CANCEL",
                  id: record.id,
                  revision: record.revision,
                })
              }
            >
              Cancel this preparation
            </button>
          )}
          {record.state === "CANCELLED" && (
            <>
              <p>
                Forget removes the stored approval and answer snapshot. It does not clear the
                application page or tracker entry and cannot be undone.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void request({
                    type: "PANEL_PREPARATION_FORGET",
                    id: record.id,
                    revision: record.revision,
                  })
                }
              >
                Forget preparation record
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => void request({ type: "PANEL_PREPARATION_GET", id: record.id })}
          >
            Refresh preparation status
          </button>
        </>
      )}
    </section>
  );
}
