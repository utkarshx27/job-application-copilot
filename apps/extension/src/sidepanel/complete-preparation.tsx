import { useEffect, useState } from "react";
import {
  PreparationExtraAnswersSchema,
  PreparationFileSchema,
  type PreparationRecord,
  type MemoryMeaningSchema,
} from "@copilot/agent-core";
import type { z } from "zod";
import type { PanelRequest } from "@copilot/browser-command-schema";

export function CompletePreparationOptions({
  record,
  city,
  arrangement,
  blocked,
  busy,
  request,
}: {
  record: PreparationRecord;
  city: string;
  arrangement: string;
  blocked: boolean;
  busy: boolean;
  request: (input: PanelRequest) => Promise<void>;
}) {
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [file, setFile] = useState<z.infer<typeof PreparationFileSchema> | null>(null);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  useEffect(() => setApproved(false), [city, arrangement, record.revision]);
  const fields = [
    ["experienceMonths", "Total experience in months"],
    ["noticeDays", "Notice period in days"],
    ["currentSalary", "Current compensation"],
    ["expectedSalary", "Expected compensation"],
  ];
  const hasScreening = /scenario=portal-(30|31)/.test(record.job.applicationUrl!);
  const parsed = PreparationExtraAnswersSchema.safeParse(extra);
  async function selectFile(selected: File | undefined) {
    setApproved(false);
    setFile(null);
    setError("");
    if (!selected) return;
    setReading(true);
    try {
      if (!selected.size || selected.size > 500000)
        throw new Error("Choose a synthetic résumé under 500 KB.");
      const bytes = new Uint8Array(await selected.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      setFile(PreparationFileSchema.parse({ name: selected.name, base64: btoa(binary), sha256 }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the résumé.");
    } finally {
      setReading(false);
    }
  }
  return (
    <details open={hasScreening}>
      <summary>Prepare all local application steps</summary>
      <p>
        Use synthetic details for the local demo. Review your answers and file here; the application
        stops at final review for separate submission approval.
      </p>
      {hasScreening && (
        <fieldset>
          <legend>Screening answers for this application</legend>
          {fields.map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                inputMode="decimal"
                value={extra[key!] ?? ""}
                onChange={(e) => {
                  setExtra({ ...extra, [key!]: e.target.value });
                  setApproved(false);
                }}
              />
            </label>
          ))}
          {(
            [
              ["currency", "Compensation currency", ["INR", "USD", "EUR"]],
              ["salaryPeriod", "Compensation period", ["Year", "Month", "Hour"]],
            ] as const
          ).map(([key, label, options]) => (
            <label key={key}>
              {label}
              <select
                aria-label={label}
                value={extra[key] ?? ""}
                onChange={(e) => {
                  setExtra({ ...extra, [key]: e.target.value });
                  setApproved(false);
                }}
              >
                <option value="">Choose an answer</option>
                {options.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
          ))}
        </fieldset>
      )}
      <label>
        Résumé for this local application
        <input
          type="file"
          accept=".txt,.pdf,.docx"
          disabled={busy || reading}
          onChange={(e) => void selectFile(e.target.files?.[0])}
        />
      </label>
      {file && (
        <p>Selected: {file.name}. This exact file will be uploaded if requested by the form.</p>
      )}
      {error && <p role="alert">{error}</p>}
      <label>
        <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
        I approve these answers, this file, and preparation through local review
      </label>
      <button
        type="button"
        disabled={
          busy ||
          reading ||
          blocked ||
          !approved ||
          !city.trim() ||
          !arrangement ||
          (hasScreening && (!parsed.success || !file))
        }
        onClick={() => {
          if (arrangement !== "Remote" && arrangement !== "Hybrid" && arrangement !== "On-site")
            return;
          void request({
            type: "PANEL_PREPARATION_COMPLETE",
            id: record.id,
            revision: record.revision,
            confirmed: true,
            answers: { currentLocation: city, workArrangement: arrangement },
            extraAnswers: hasScreening && parsed.success ? parsed.data : null,
            file,
          });
        }}
      >
        Prepare complete local application
      </button>
    </details>
  );
}

export function PreparationProgress({
  record,
  busy,
  request,
}: {
  record: PreparationRecord;
  busy: boolean;
  request: (input: PanelRequest) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<
    Record<
      string,
      { value: string; meaning: z.infer<typeof MemoryMeaningSchema> | null; remember: boolean }
    >
  >({});
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    setConfirmed(false);
    setAnswers({});
  }, [record.revision]);
  function answer(key: string) {
    return answers[key] ?? { value: "", meaning: null, remember: false };
  }
  function exportMetrics() {
    const report = {
      version: 1,
      scope: "local-native-preparation",
      state: record.state,
      actions: record.actionCount,
      manualInterventions: record.manualInterventions,
      memoryUses: record.memoryUses,
      elapsedMs:
        record.startedAt && record.completedAt ? record.completedAt - record.startedAt : null,
      inferenceCostMicros: 0,
      receiptVerified: !!record.receipt,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "ag09-run-summary.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      {record.completeFlow && (
        <>
          <p>
            {record.actionCount} actions
            {record.startedAt && record.completedAt
              ? ` · ${((record.completedAt - record.startedAt) / 1000).toFixed(1)} seconds`
              : ""}
          </p>
          <button type="button" onClick={exportMetrics}>
            Download metrics without personal data
          </button>
        </>
      )}
      {record.completeFlow && record.state === "PREPARING" && (
        <button
          type="button"
          onClick={() =>
            void request({
              type: "PANEL_PREPARATION_PAUSE",
              id: record.id,
              revision: record.revision,
            })
          }
        >
          Pause and take over
        </button>
      )}
      {record.completeFlow && (
        <p>
          {record.memoryUses} memory-assisted actions · {record.manualInterventions} question
          reviews · inference cost: $0 (deterministic local execution)
        </p>
      )}
      {record.state === "QUESTIONS" && (
        <fieldset>
          <legend>Review missing or conflicting answers</legend>
          {record.questions.map((question) => (
            <div key={question.key}>
              {question.value && (
                <p>
                  Currently on the page: {question.value}. Clear or correct a conflicting value on
                  the page before continuing.
                </p>
              )}
              <label>
                {question.label}
                <input
                  aria-label={`Answer: ${question.label}`}
                  value={answer(question.key).value}
                  onChange={(e) => {
                    setAnswers({
                      ...answers,
                      [question.key]: { ...answer(question.key), value: e.target.value },
                    });
                    setConfirmed(false);
                  }}
                />
              </label>
              <label>
                Meaning of {question.label}
                <select
                  aria-label={`Meaning: ${question.label}`}
                  value={answer(question.key).meaning ?? ""}
                  onChange={(e) => {
                    setAnswers({
                      ...answers,
                      [question.key]: {
                        ...answer(question.key),
                        meaning: (e.target.value || null) as z.infer<
                          typeof MemoryMeaningSchema
                        > | null,
                      },
                    });
                    setConfirmed(false);
                  }}
                >
                  <option value="">Answer this question only</option>
                  <option value="ADDRESS.city">Current city</option>
                  <option value="COMP.current_compensation">Current compensation</option>
                  <option value="COMP.desired_base">Expected compensation</option>
                  <option value="AVAIL.notice_period">Notice period in days</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={answer(question.key).remember}
                  disabled={!answer(question.key).meaning}
                  onChange={(e) => {
                    setAnswers({
                      ...answers,
                      [question.key]: { ...answer(question.key), remember: e.target.checked },
                    });
                    setConfirmed(false);
                  }}
                />
                Remember this field meaning for my profile
              </label>
            </div>
          ))}
        </fieldset>
      )}
      {record.completeFlow &&
        ["QUESTIONS", "NEEDS_REVIEW", "READY_TO_SUBMIT"].includes(record.state) && (
          <>
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              {record.state === "READY_TO_SUBMIT"
                ? "I reviewed this application and approve one local submission"
                : "I reviewed the page and approve continuing this preparation"}
            </label>
            <button
              type="button"
              disabled={busy || !confirmed}
              onClick={() =>
                void request({
                  type: "PANEL_PREPARATION_RESUME",
                  id: record.id,
                  revision: record.revision,
                  confirmed: true,
                  answers: record.questions.map((q) => ({ key: q.key, ...answer(q.key) })),
                })
              }
            >
              Resume reviewed preparation
            </button>
          </>
        )}
      {record.state === "READY_TO_SUBMIT" && (
        <>
          <dl>
            {record.reviewedQuestions.map((q) => (
              <div key={q.key}>
                <dt>{q.label}</dt>
                <dd>{q.meaning === "resume" ? record.file?.name : q.value}</dd>
              </div>
            ))}
          </dl>
          <button
            type="button"
            disabled={busy || !confirmed}
            onClick={() =>
              void request({
                type: "PANEL_PREPARATION_SUBMIT",
                id: record.id,
                revision: record.revision,
                confirmed: true,
              })
            }
          >
            Submit this local application once
          </button>
        </>
      )}
      {record.state === "OUTCOME_UNKNOWN" && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void request({ type: "PANEL_PREPARATION_RECEIPT", id: record.id })}
        >
          Check application receipt
        </button>
      )}
      {record.receipt && (
        <p>
          Verified receipt: {record.receipt.applicationId} · {record.receipt.jobId}
        </p>
      )}
      {["SUBMITTED", "OUTCOME_UNKNOWN"].includes(record.state) && (
        <>
          <p>
            Clear the saved answers and résumé when finished. Job identity and receipt status remain
            to prevent duplicate submission; correction memory is managed separately in Observe.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void request({
                type: "PANEL_PREPARATION_CLEAR_PRIVATE",
                id: record.id,
                revision: record.revision,
              })
            }
          >
            Clear private application data
          </button>
        </>
      )}
      {record.workflowId && (
        <p>
          A workflow candidate was captured. After a matching separate run validates it, you can
          enable reuse. Manage or forget stored memory in Observe.
        </p>
      )}
      {record.workflowId && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void request({ type: "PANEL_PREPARATION_WORKFLOW", id: record.id, confirmed: true })
          }
        >
          Enable validated workflow reuse
        </button>
      )}
    </>
  );
}
