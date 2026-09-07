import { useEffect, useState } from "react";
import { AgentLabStatusSchema, type AgentLabStatus } from "@copilot/agent-core";
import { PanelRequestSchema, RuntimeResponseSchema } from "@copilot/browser-command-schema";

export function AgentLab() {
  const [status, setStatus] = useState<AgentLabStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function request(input: unknown) {
    setBusy(true);
    setError("");
    try {
      const response = RuntimeResponseSchema.parse(
        await chrome.runtime.sendMessage(PanelRequestSchema.parse(input)),
      );
      if (!response.ok) throw new Error(response.error.message);
      setStatus(AgentLabStatusSchema.parse(response.data));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Agent lab unavailable.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void request({ type: "PANEL_AGENT_STATUS" });
  }, []);
  return (
    <section className="agent-lab" aria-label="Experimental agent lab">
      <h2>Agent foundation lab</h2>
      <button
        type="button"
        onClick={() => {
          void chrome.tabs
            .create({ url: "http://127.0.0.1:4173/portal.html" })
            .catch(() => setError("Could not open the local portal gallery."));
        }}
      >
        Explore portal demos
      </button>
      <p>
        Test saved progress and recovery on the local Workday fixture. This first implementation
        only reads form structure; it does not fill, navigate, submit, or call AI.
      </p>
      <p>
        Open <code>http://127.0.0.1:4173/workday.html</code> in the active tab.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {status && (
        <>
          <label>
            <input
              type="checkbox"
              checked={status.enabled}
              disabled={busy}
              onChange={(e) =>
                void request({ type: "PANEL_AGENT_SET_ENABLED", enabled: e.target.checked })
              }
            />
            Enable local agent lab
          </label>
          <button
            type="button"
            disabled={busy || !status.enabled}
            onClick={() => void request({ type: "PANEL_AGENT_START" })}
          >
            Start local checkpoint run
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void request({ type: "PANEL_AGENT_STATUS" })}
          >
            Refresh agent runs
          </button>
          {status.runs.length === 0 && <p>No agent runs yet.</p>}
          {status.runs.map((run) => (
            <article key={run.id} className="agent-run">
              <h3>
                {run.state === "READY_FOR_REVIEW"
                  ? "Checkpoint recorded"
                  : run.state.replaceAll("_", " ").toLowerCase()}
              </h3>
              <p>
                Revision {run.revision} · {run.actions} read checkpoints · {run.fieldCount ?? "—"}{" "}
                visible controls
              </p>
              {run.pauseReason && (
                <p>Reason: {run.pauseReason.replaceAll("_", " ").toLowerCase()}</p>
              )}
              {!["CANCELLED", "FAILED", "CONFIRMED", "OUTCOME_UNKNOWN"].includes(run.state) && (
                <div>
                  <button
                    type="button"
                    disabled={busy || !status.enabled}
                    onClick={() => void request({ type: "PANEL_AGENT_CHECKPOINT", runId: run.id })}
                  >
                    Resume and read checkpoint
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void request({ type: "PANEL_AGENT_PAUSE", runId: run.id })}
                  >
                    Pause run
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void request({ type: "PANEL_AGENT_CANCEL", runId: run.id })}
                  >
                    Cancel run
                  </button>
                </div>
              )}
              <details>
                <summary>Run events</summary>
                <ol>
                  {run.events.map((event) => (
                    <li key={event.sequence}>
                      {event.sequence}: {event.code.toLowerCase().replaceAll("_", " ")}
                    </li>
                  ))}
                </ol>
              </details>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
