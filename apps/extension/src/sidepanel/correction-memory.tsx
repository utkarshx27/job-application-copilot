import { useEffect, useState } from "react";
import {
  MemoryMeaningSchema,
  MemoryViewSchema,
  AgentLabStatusSchema,
  type AgentLabStatus,
} from "@copilot/agent-core";
import type { z } from "zod";
import { sendPanelRequest } from "./panel-shared";

export const memoryLabels: Record<z.infer<typeof MemoryMeaningSchema>, string> = {
  MANUAL: "Complete manually",
  "IDENTITY.legal_name.full": "Full legal name",
  "IDENTITY.legal_name.given": "First name",
  "IDENTITY.legal_name.family": "Last name",
  "CONTACT.email": "Email",
  "CONTACT.phone": "Full phone number",
  PHONE_DIAL_CODE: "Phone dialing prefix (manual)",
  "ADDRESS.country": "Country of residence",
  "ADDRESS.city": "City",
  "LINKS.linkedin": "LinkedIn URL",
  "LINKS.portfolio": "Portfolio URL",
  "LINKS.github": "GitHub URL",
  "COMP.current_compensation": "Current compensation",
  "COMP.desired_base": "Expected base compensation",
  "AVAIL.notice_period": "Notice period",
};
export function MeaningOptions() {
  return MemoryMeaningSchema.options.map((meaning) => (
    <option value={meaning} key={meaning}>
      {memoryLabels[meaning]}
    </option>
  ));
}
export function TeachField({
  analysisId,
  fieldId,
  label,
  onSaved,
}: {
  analysisId: string;
  fieldId: string;
  label: string;
  onSaved: () => Promise<void>;
}) {
  const [meaning, setMeaning] = useState<z.infer<typeof MemoryMeaningSchema>>("MANUAL");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <details>
      <summary>Correct field meaning</summary>
      <label>
        Meaning for {label}
        <select
          value={meaning}
          onChange={(event) => setMeaning(MemoryMeaningSchema.parse(event.target.value))}
        >
          <MeaningOptions />
        </select>
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void sendPanelRequest({
            type: "PANEL_MEMORY_CORRECT",
            analysisId,
            fieldId,
            accepted: meaning,
            confirmed: true,
          })
            .then(async (response) => {
              if (!response.ok) throw new Error(response.error.message);
              setMessage("Correction saved for matching controls on this test site.");
              await onSaved();
            })
            .catch((error: unknown) =>
              setMessage(error instanceof Error ? error.message : "Could not save correction."),
            )
            .finally(() => setBusy(false));
        }}
      >
        Confirm and remember meaning
      </button>
      {message && <p role="status">{message}</p>}
    </details>
  );
}
export function CorrectionMemoryPanel() {
  const [view, setView] = useState<z.infer<typeof MemoryViewSchema> | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [runs, setRuns] = useState<AgentLabStatus["runs"]>([]);
  const [runId, setRunId] = useState("");
  async function refreshRuns() {
    try {
      const response = await sendPanelRequest({ type: "PANEL_EXECUTOR_STATUS" });
      if (!response.ok) throw new Error(response.error.message);
      setRuns(
        AgentLabStatusSchema.parse(response.data).runs.filter(
          (run) => run.state === "READY_FOR_REVIEW",
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Runs unavailable.");
    }
  }
  async function request(input: Parameters<typeof sendPanelRequest>[0]) {
    setBusy(true);
    try {
      const response = await sendPanelRequest(input);
      if (!response.ok) throw new Error(response.error.message);
      setView(MemoryViewSchema.parse(response.data));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Memory unavailable.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void request({ type: "PANEL_MEMORY_GET" });
  }, []);
  return (
    <section aria-label="Correction memory">
      <h2>Correction memory</h2>
      <p>
        Reviewed field meanings for local test forms. Your answers remain in your profile. Changes
        to your profile make earlier corrections stale until you reconfirm them. Memory stays local
        and is excluded from sync and profile backups.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void request({ type: "PANEL_MEMORY_GET" })}
      >
        Refresh corrections
      </button>
      {message && <p role="alert">{message}</p>}
      {!view?.corrections.length && (
        <p>No corrections yet. Scan a local form in Observe and select Correct field meaning.</p>
      )}
      {view?.corrections.map((record) => (
        <article key={record.id}>
          <h3>{record.scope.question}</h3>
          <p>
            {record.scope.origin} · {record.scope.adapter} · {record.scope.control}
          </p>
          <p>
            {record.owner.profileRevision !== view.owner.profileRevision ||
            record.expiresAt <= Date.now()
              ? "Stale — reconfirm before reuse"
              : "Current"}{" "}
            · Revision {record.revision}
          </p>
          <label>
            Edit meaning for {record.scope.question}
            <select
              value={edits[record.id] ?? record.accepted}
              onChange={(event) => setEdits({ ...edits, [record.id]: event.target.value })}
            >
              <MeaningOptions />
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void request({
                type: "PANEL_MEMORY_EDIT",
                id: record.id,
                revision: record.revision,
                accepted: MemoryMeaningSchema.parse(edits[record.id] ?? record.accepted),
                confirmed: true,
              })
            }
          >
            Reconfirm correction
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void request({
                type: "PANEL_MEMORY_FORGET",
                id: record.id,
                revision: record.revision,
              })
            }
          >
            Forget correction
          </button>
        </article>
      ))}
      <h3>Local workflow library</h3>
      <p>
        Capture a completed demo, open a second demo in a new tab to validate it, then activate its
        reviewed field order. Existing page checks still apply. Retire or forget a workflow to stop
        reuse.
      </p>
      <button type="button" disabled={busy} onClick={() => void refreshRuns()}>
        Refresh completed demos
      </button>
      <label>
        Completed demo
        <select
          aria-label="Completed demo"
          value={runId}
          onChange={(event) => setRunId(event.target.value)}
        >
          <option value="">Select a completed run</option>
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.id.slice(0, 8)} · {new Date(run.updatedAt).toLocaleString()}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={busy || !runId}
        onClick={() => void request({ type: "PANEL_WORKFLOW_CAPTURE", runId })}
      >
        Capture workflow candidate
      </button>
      {view?.workflows.map((workflow) => (
        <article key={workflow.id}>
          <h4>Workflow {workflow.id.slice(0, 8)}</h4>
          <p>
            {workflow.state} · Revision {workflow.revision} · {workflow.steps.length} typed steps
          </p>
          {workflow.owner.profileRevision !== view.owner.profileRevision && (
            <p>Stale profile revision</p>
          )}
          <details>
            <summary>Review workflow steps</summary>
            <ol>
              {workflow.steps.map((step, index) => (
                <li key={index}>
                  {step.kind} — {step.parameter}
                </li>
              ))}
            </ol>
          </details>
          <button
            type="button"
            disabled={busy || !runId || workflow.state !== "CANDIDATE"}
            onClick={() =>
              void request({
                type: "PANEL_WORKFLOW_CHANGE",
                id: workflow.id,
                revision: workflow.revision,
                action: "VALIDATE",
                runId,
              })
            }
          >
            Validate against selected demo
          </button>
          <button
            type="button"
            disabled={busy || workflow.state !== "OFFLINE_VALIDATED"}
            onClick={() =>
              void request({
                type: "PANEL_WORKFLOW_CHANGE",
                id: workflow.id,
                revision: workflow.revision,
                action: "ACTIVATE",
              })
            }
          >
            Activate workflow
          </button>
          <button
            type="button"
            disabled={busy || workflow.state === "RETIRED"}
            onClick={() =>
              void request({
                type: "PANEL_WORKFLOW_CHANGE",
                id: workflow.id,
                revision: workflow.revision,
                action: "RETIRE",
              })
            }
          >
            Retire workflow
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void request({
                type: "PANEL_WORKFLOW_CHANGE",
                id: workflow.id,
                revision: workflow.revision,
                action: "FORGET",
              })
            }
          >
            Forget workflow
          </button>
        </article>
      ))}
    </section>
  );
}
