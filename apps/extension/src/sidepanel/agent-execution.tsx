import { useEffect, useRef, useState } from "react";
import {
  AGENT_EXECUTION_URL,
  AgentLabStatusSchema,
  type AgentLabStatus,
} from "@copilot/agent-core";
import { PanelRequestSchema, RuntimeResponseSchema } from "@copilot/browser-command-schema";

export function AgentExecutionPanel() {
  const [status, setStatus] = useState<AgentLabStatus | null>(null);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState("");
  const [image, setImage] = useState("");
  const pending = useRef(false);
  const sequence = useRef(0);
  async function request(input: unknown, poll = false) {
    if (poll && pending.current) return;
    if (!poll) pending.current = true;
    const current = ++sequence.current;
    try {
      const response = RuntimeResponseSchema.parse(
        await chrome.runtime.sendMessage(PanelRequestSchema.parse(input)),
      );
      if (!response.ok) throw new Error(response.error.message);
      if (current !== sequence.current) return;
      if ("kind" in response.data && response.data.kind === "LOCAL_VISUAL_REVIEW")
        setImage(response.data.image);
      else setStatus(AgentLabStatusSchema.parse(response.data));
      if (!poll) setError("");
    } catch (cause) {
      if (current === sequence.current)
        setError(cause instanceof Error ? cause.message : "Execution unavailable");
    } finally {
      if (!poll) pending.current = false;
    }
  }
  useEffect(() => {
    const refresh = () => void request({ type: "PANEL_EXECUTOR_STATUS" }, true);
    refresh();
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <section aria-label="Local application executor">
      <h2>Local application executor</h2>
      <p>
        Research demo only. Fills a synthetic profile, handles supported controls and steps, and
        stops at review. No real applications or AI calls.
      </p>
      <button
        type="button"
        onClick={() => {
          void chrome.tabs.create({ url: AGENT_EXECUTION_URL });
        }}
      >
        Open execution demo
      </button>
      <details>
        <summary>Synthetic profile used by this demo</summary>
        <p>
          Nora Example · nora@example.test · India · Bengaluru · 2026-10-01 · Synthetic Labs.
          Upload: synthetic-resume.txt, generated locally. No personal résumé is used.
        </p>
      </details>
      <label>
        <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
        I approve this synthetic profile, file, and local step navigation
      </label>
      <label>
        <input
          type="checkbox"
          checked={status?.enabled ?? false}
          disabled={!status}
          onChange={(e) => {
            const enabled = e.target.checked;
            setStatus((previous) => (previous ? { ...previous, enabled } : previous));
            void request({ type: "PANEL_EXECUTOR_ENABLE", enabled });
          }}
        />
        Enable local execution
      </label>
      <button
        type="button"
        disabled={!approved || !status?.enabled}
        onClick={() => void request({ type: "PANEL_EXECUTOR_START", approved: true })}
      >
        Prepare synthetic application
      </button>
      {error && <p role="alert">{error}</p>}
      <div aria-live="polite">
        {status?.runs.map((run) => (
          <article key={run.id}>
            <h3>
              {run.state === "READY_FOR_REVIEW"
                ? "Application ready for review"
                : run.state.replaceAll("_", " ").toLowerCase()}
            </h3>
            <p>
              {run.actions} execution actions
              {run.pauseReason ? ` · ${run.pauseReason.toLowerCase().replaceAll("_", " ")}` : ""}
            </p>
            {!["CANCELLED", "CONFIRMED", "OUTCOME_UNKNOWN", "FAILED"].includes(run.state) && (
              <>
                <button
                  type="button"
                  disabled={!status.enabled || !["PAUSED", "OBSERVING"].includes(run.state)}
                  onClick={() => void request({ type: "PANEL_EXECUTOR_RESUME", runId: run.id })}
                >
                  Resume execution
                </button>
                <button
                  type="button"
                  onClick={() => void request({ type: "PANEL_EXECUTOR_PAUSE", runId: run.id })}
                >
                  Pause execution
                </button>
                <button
                  type="button"
                  onClick={() => void request({ type: "PANEL_EXECUTOR_PAUSE", runId: run.id })}
                >
                  Take over manually
                </button>
                <button
                  type="button"
                  onClick={() => void request({ type: "PANEL_EXECUTOR_CANCEL", runId: run.id })}
                >
                  Cancel execution
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void chrome.permissions
                      .request({ permissions: ["debugger"] })
                      .then((allowed) => {
                        if (allowed)
                          return request({ type: "PANEL_EXECUTOR_VISUAL", runId: run.id });
                        setError("Visual review permission was not granted.");
                      })
                      .catch(() => setError("Visual review is unavailable."));
                  }}
                >
                  Pause and inspect screenshot
                </button>
              </>
            )}
            <details>
              <summary>Execution events</summary>
              <ol>
                {run.events.map((e) => (
                  <li key={e.sequence}>{e.code}</li>
                ))}
              </ol>
            </details>
          </article>
        ))}
      </div>
      {image && (
        <>
          <img
            src={image}
            alt="Local application screenshot for manual review"
            style={{ maxWidth: "100%" }}
          />
          <button type="button" onClick={() => setImage("")}>
            Clear screenshot
          </button>
        </>
      )}
    </section>
  );
}
