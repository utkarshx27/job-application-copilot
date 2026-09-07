import { PanelRequestSchema, RuntimeResponseSchema } from "@copilot/browser-command-schema";
import { AiConfigStatusSchema, type AiConfigStatus } from "@copilot/ai-gateway";
import { FillResultSchema, HighlightResultSchema } from "@copilot/form-schema";
import { GroundedDraftResultSchema, type GroundedDraftResult } from "@copilot/grounded-generation";
import {
  ApplicationPageAnalysisSchema,
  ApplicationStatusSchema,
  ApplicationTrackerSchema,
  TrackerCsvExportSchema,
  TrackerCsvImportResultSchema,
  UploadResultSchema,
  type ApplicationPageAnalysis,
  type ApplicationTracker,
  type ApplicationRecord,
  type ApplicationStatus,
  type ApprovedUploadFile,
  type CustomQuestion,
} from "@copilot/job-schema";
import {
  ProfileDraftSchema,
  ProfileVaultSchema,
  countFactsByStatus,
  profileToDraft,
  type ProfileDraft,
  type ProfileVault,
} from "@copilot/profile-core";
import {
  SyncAccountStatusSchema,
  SyncBackupResultSchema,
  SyncDevicesResultSchema,
  SyncRunResultSchema,
  type SyncAccountStatus,
  type SyncDevice,
} from "@copilot/sync-core";
import {
  AutoNextActionResultSchema,
  AutoNextPanelStateSchema,
  type AutoNextPanelState,
} from "@copilot/navigation-core";
import {
  SubmissionActionResultSchema,
  SubmissionPanelStateSchema,
  type SubmissionPanelState,
} from "@copilot/submission-core";
import { StrictMode, useEffect, useRef, useState, type ChangeEvent } from "react";
import { createRoot } from "react-dom/client";

import { readApprovedResumeFile, readResumeFile } from "../resume-file";
import { ensureActiveSiteAccess } from "../site-access";

import { AgentLab } from "./agent-lab";
import { AGENT_LAB_AVAILABLE } from "../agent-config";

type Tab = "profile" | "observe" | "applications" | "sync";
type Notice = { kind: "success" | "error"; message: string } | null;
type ScanState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; analysis: ApplicationPageAnalysis }
  | { status: "error"; message: string };

function suggestedControlValue(question: CustomQuestion): string {
  const suggestion = question.savedResponse;
  if (suggestion.status !== "MATCH" || !suggestion.answer) return "";
  if (question.responseMode !== "SELECT") return suggestion.answer;
  const normalized = suggestion.answer.trim().toLocaleLowerCase();
  return (
    question.field.options.find(
      (option) =>
        !option.disabled &&
        (option.value.trim().toLocaleLowerCase() === normalized ||
          option.text.trim().toLocaleLowerCase() === normalized),
    )?.value ?? ""
  );
}

function scopeLabel(scope: string): string {
  if (scope === "APPLICATION") return "Only this application";
  if (scope === "COMPANY") return "This company";
  if (scope === "COUNTRY") return "Jobs in this country";
  if (scope === "ROLE") return "Similar roles";
  return "Similar questions everywhere";
}

async function sendPanelRequest(untrustedRequest: unknown) {
  const request = PanelRequestSchema.parse(untrustedRequest);
  const response: unknown = await chrome.runtime.sendMessage(request);
  return RuntimeResponseSchema.parse(response);
}

function blankWork(): ProfileDraft["workHistory"][number] {
  return {
    id: `work-${crypto.randomUUID()}`,
    employer: "",
    title: "",
    location: "",
    start: "",
    end: "",
    current: false,
    description: "",
  };
}

function blankEducation(): ProfileDraft["education"][number] {
  return {
    id: `education-${crypto.randomUUID()}`,
    institution: "",
    degree: "",
    fieldOfStudy: "",
    start: "",
    end: "",
    current: false,
  };
}

function blankAuthorization(): ProfileDraft["workAuthorization"][number] {
  return {
    id: `authorization-${crypto.randomUUID()}`,
    countryCode: "IN",
    currentlyAuthorized: "UNKNOWN",
    currentSponsorshipRequired: "UNKNOWN",
    futureSponsorshipRequired: "UNKNOWN",
  };
}

function ProfileEditor({
  vault,
  onVault,
}: {
  vault: ProfileVault;
  onVault: (vault: ProfileVault) => void;
}) {
  const [draft, setDraft] = useState(() => profileToDraft(vault.currentProfile));
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(profileToDraft(vault.currentProfile)), [vault]);

  function updateWork(id: string, patch: Partial<ProfileDraft["workHistory"][number]>) {
    setDraft((current) => ({
      ...current,
      workHistory: current.workHistory.map((work) =>
        work.id === id ? { ...work, ...patch } : work,
      ),
    }));
  }

  function updateEducation(id: string, patch: Partial<ProfileDraft["education"][number]>) {
    setDraft((current) => ({
      ...current,
      education: current.education.map((record) =>
        record.id === id ? { ...record, ...patch } : record,
      ),
    }));
  }

  function updateAuthorization(
    id: string,
    patch: Partial<ProfileDraft["workAuthorization"][number]>,
  ) {
    setDraft((current) => ({
      ...current,
      workAuthorization: current.workAuthorization.map((record) =>
        record.id === id ? { ...record, ...patch } : record,
      ),
    }));
  }

  async function save() {
    setBusy(true);
    setNotice(null);
    try {
      if (vault.conflicts.length > 0)
        throw new Error("Resolve every résumé conflict before saving and verifying the profile.");
      const checkedDraft = ProfileDraftSchema.parse(draft);
      const response = await sendPanelRequest({ type: "PANEL_PROFILE_SAVE", draft: checkedDraft });
      if (!response.ok) throw new Error(response.error.message);
      const saved = ProfileVaultSchema.safeParse(response.data);
      if (!saved.success) throw new Error("The profile worker returned invalid data.");
      onVault(saved.data);
      setNotice({
        kind: "success",
        message: `Profile version ${saved.data.currentProfile.profileVersion} saved locally.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not save the profile.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function exportJson() {
    setNotice(null);
    try {
      const response = await sendPanelRequest({ type: "PANEL_PROFILE_EXPORT" });
      if (!response.ok) throw new Error(response.error.message);
      if (!("backupJson" in response.data)) throw new Error("The export response was invalid.");
      const url = URL.createObjectURL(
        new Blob([response.data.backupJson], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `job-application-copilot-profile-v${vault.currentProfile.profileVersion}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice({
        kind: "success",
        message: "Exported JSON contains personal data; store it securely.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not export the profile.",
      });
    }
  }

  async function importJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await sendPanelRequest({
        type: "PANEL_PROFILE_IMPORT_JSON",
        json: await file.text(),
      });
      if (!response.ok) throw new Error(response.error.message);
      const imported = ProfileVaultSchema.safeParse(response.data);
      if (!imported.success) throw new Error("The imported profile was invalid.");
      onVault(imported.data);
      setNotice({ kind: "success", message: `Imported ${file.name} after schema validation.` });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not import the profile.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function importResume(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setNotice(null);
    try {
      const importedFile = await readResumeFile(file);
      const response = await sendPanelRequest({
        type: "PANEL_PROFILE_IMPORT_RESUME",
        ...importedFile,
      });
      if (!response.ok) throw new Error(response.error.message);
      const imported = ProfileVaultSchema.safeParse(response.data);
      if (!imported.success) throw new Error("The résumé import returned invalid data.");
      onVault(imported.data);
      const reviewCount = countFactsByStatus(imported.data.currentProfile, "VERIFIED_DOCUMENT");
      setNotice({
        kind: "success",
        message: `Imported ${file.name}. Review ${reviewCount} document-derived fact${reviewCount === 1 ? "" : "s"} and ${imported.data.conflicts.length} conflict${imported.data.conflicts.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not read the résumé.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function verifyImported() {
    setBusy(true);
    setNotice(null);
    try {
      if (vault.conflicts.length > 0)
        throw new Error("Resolve every conflict before verifying imported facts.");
      const response = await sendPanelRequest({ type: "PANEL_PROFILE_VERIFY_IMPORTED" });
      if (!response.ok) throw new Error(response.error.message);
      const verified = ProfileVaultSchema.safeParse(response.data);
      if (!verified.success) throw new Error("The verification response was invalid.");
      onVault(verified.data);
      setNotice({
        kind: "success",
        message: "Résumé facts verified by you and saved as a new profile version.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not verify imported facts.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function resolveConflict(conflictId: string, resolution: "KEEP_EXISTING" | "USE_IMPORTED") {
    setBusy(true);
    setNotice(null);
    try {
      const response = await sendPanelRequest({
        type: "PANEL_PROFILE_RESOLVE_CONFLICT",
        conflictId,
        resolution,
      });
      if (!response.ok) throw new Error(response.error.message);
      const resolved = ProfileVaultSchema.safeParse(response.data);
      if (!resolved.success) throw new Error("The conflict response was invalid.");
      onVault(resolved.data);
      setNotice({
        kind: "success",
        message: "Conflict resolved. Review the resulting profile before verification.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not resolve the conflict.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="version-row">
        <span>Profile version {vault.currentProfile.profileVersion}</span>
        <span>
          {vault.history.length} saved revision{vault.history.length === 1 ? "" : "s"}
        </span>
      </div>

      <section className="import-card" aria-labelledby="resume-import-heading">
        <h2 id="resume-import-heading">Import résumé</h2>
        <p className="help">
          PDF and DOCX files are read locally. Extracted facts stay unverified until you review
          them; sensitive facts are never inferred.
        </p>
        <label className="file-button">
          Choose PDF or DOCX
          <input
            type="file"
            accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
            disabled={busy}
            onChange={(event) => void importResume(event)}
          />
        </label>
        {countFactsByStatus(vault.currentProfile, "VERIFIED_DOCUMENT") > 0 && (
          <div className="review-summary">
            <strong>
              {countFactsByStatus(vault.currentProfile, "VERIFIED_DOCUMENT")} facts awaiting your
              verification
            </strong>
            <button
              type="button"
              className="primary"
              disabled={busy || vault.conflicts.length > 0}
              onClick={() => void verifyImported()}
            >
              Verify imported facts
            </button>
          </div>
        )}
        {vault.conflicts.length > 0 && (
          <div className="conflicts" aria-label="Import conflicts">
            <strong>
              {vault.conflicts.length} conflict{vault.conflicts.length === 1 ? "" : "s"} to resolve
            </strong>
            {vault.conflicts.map((conflict) => (
              <div className="conflict" key={conflict.id}>
                <span>{conflict.path}</span>
                <small>Current: {JSON.stringify(conflict.existingValue)}</small>
                <small>Résumé: {JSON.stringify(conflict.importedValue)}</small>
                <div className="button-row">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void resolveConflict(conflict.id, "KEEP_EXISTING")}
                  >
                    Keep current
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void resolveConflict(conflict.id, "USE_IMPORTED")}
                  >
                    Use résumé
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <fieldset>
        <legend>Identity</legend>
        <label>
          Full legal name
          <input
            required
            value={draft.identity.full}
            onChange={(event) =>
              setDraft({ ...draft, identity: { ...draft.identity, full: event.target.value } })
            }
          />
        </label>
        <div className="two-column">
          <label>
            Given name
            <input
              required
              value={draft.identity.given}
              onChange={(event) =>
                setDraft({ ...draft, identity: { ...draft.identity, given: event.target.value } })
              }
            />
          </label>
          <label>
            Family name <span className="optional">optional</span>
            <input
              value={draft.identity.family}
              onChange={(event) =>
                setDraft({ ...draft, identity: { ...draft.identity, family: event.target.value } })
              }
            />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Contact and links</legend>
        <label>
          Email
          <input
            type="email"
            value={draft.email}
            onChange={(event) => setDraft({ ...draft, email: event.target.value })}
          />
        </label>
        <label>
          Phone <span className="optional">E.164, for example +919876543210</span>
          <input
            inputMode="tel"
            pattern="\+[1-9][0-9]{6,14}"
            value={draft.phone}
            onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
          />
        </label>
        <label>
          Portfolio URL
          <input
            type="url"
            value={draft.portfolio}
            onChange={(event) => setDraft({ ...draft, portfolio: event.target.value })}
          />
        </label>
        <label>
          GitHub URL
          <input
            type="url"
            value={draft.github}
            onChange={(event) => setDraft({ ...draft, github: event.target.value })}
          />
        </label>
        <label>
          LinkedIn URL
          <input
            type="url"
            value={draft.linkedin}
            onChange={(event) => setDraft({ ...draft, linkedin: event.target.value })}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Work history</legend>
        {draft.workHistory.map((work, index) => (
          <div className="record" key={work.id}>
            <div className="record-heading">
              <strong>Role {index + 1}</strong>
              <button
                type="button"
                className="text-button danger"
                onClick={() =>
                  setDraft({
                    ...draft,
                    workHistory: draft.workHistory.filter((record) => record.id !== work.id),
                  })
                }
              >
                Remove
              </button>
            </div>
            <label>
              Employer
              <input
                required
                value={work.employer}
                onChange={(event) => updateWork(work.id, { employer: event.target.value })}
              />
            </label>
            <label>
              Job title
              <input
                required
                value={work.title}
                onChange={(event) => updateWork(work.id, { title: event.target.value })}
              />
            </label>
            <label>
              Location
              <input
                value={work.location}
                onChange={(event) => updateWork(work.id, { location: event.target.value })}
              />
            </label>
            <div className="two-column">
              <label>
                Start date
                <input
                  type="date"
                  required
                  value={work.start}
                  onChange={(event) => updateWork(work.id, { start: event.target.value })}
                />
              </label>
              <label>
                End date
                <input
                  type="date"
                  disabled={work.current}
                  required={!work.current}
                  value={work.end}
                  onChange={(event) => updateWork(work.id, { end: event.target.value })}
                />
              </label>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={work.current}
                onChange={(event) =>
                  updateWork(work.id, {
                    current: event.target.checked,
                    end: event.target.checked ? "" : work.end,
                  })
                }
              />
              I currently work here
            </label>
            <label>
              Description
              <textarea
                rows={3}
                value={work.description}
                onChange={(event) => updateWork(work.id, { description: event.target.value })}
              />
            </label>
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          onClick={() => setDraft({ ...draft, workHistory: [...draft.workHistory, blankWork()] })}
        >
          Add work experience
        </button>
      </fieldset>

      <fieldset>
        <legend>Education</legend>
        {draft.education.map((record, index) => (
          <div className="record" key={record.id}>
            <div className="record-heading">
              <strong>Education {index + 1}</strong>
              <button
                type="button"
                className="text-button danger"
                onClick={() =>
                  setDraft({
                    ...draft,
                    education: draft.education.filter((item) => item.id !== record.id),
                  })
                }
              >
                Remove
              </button>
            </div>
            <label>
              Institution
              <input
                required
                value={record.institution}
                onChange={(event) =>
                  updateEducation(record.id, { institution: event.target.value })
                }
              />
            </label>
            <label>
              Degree
              <input
                required
                value={record.degree}
                onChange={(event) => updateEducation(record.id, { degree: event.target.value })}
              />
            </label>
            <label>
              Field of study
              <input
                value={record.fieldOfStudy}
                onChange={(event) =>
                  updateEducation(record.id, { fieldOfStudy: event.target.value })
                }
              />
            </label>
            <div className="two-column">
              <label>
                Start date
                <input
                  type="date"
                  value={record.start}
                  onChange={(event) => updateEducation(record.id, { start: event.target.value })}
                />
              </label>
              <label>
                End date
                <input
                  type="date"
                  disabled={record.current}
                  required={Boolean(record.start && !record.current)}
                  value={record.end}
                  onChange={(event) => updateEducation(record.id, { end: event.target.value })}
                />
              </label>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={record.current}
                onChange={(event) =>
                  updateEducation(record.id, {
                    current: event.target.checked,
                    end: event.target.checked ? "" : record.end,
                  })
                }
              />
              I currently study here
            </label>
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          onClick={() => setDraft({ ...draft, education: [...draft.education, blankEducation()] })}
        >
          Add education
        </button>
      </fieldset>

      <fieldset>
        <legend>Skills</legend>
        <label>
          Skills <span className="optional">one per line or comma-separated</span>
          <textarea
            rows={4}
            value={draft.skills.join("\n")}
            onChange={(event) =>
              setDraft({
                ...draft,
                skills: event.target.value
                  .split(/[\n,]/)
                  .map((value) => value.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>
          Work authorization <span className="sensitive">sensitive</span>
        </legend>
        <p className="help">Enter only facts you know. Unknown is never treated as “No.”</p>
        {draft.workAuthorization.map((record, index) => (
          <div className="record" key={record.id}>
            <div className="record-heading">
              <strong>Country {index + 1}</strong>
              <button
                type="button"
                className="text-button danger"
                onClick={() =>
                  setDraft({
                    ...draft,
                    workAuthorization: draft.workAuthorization.filter(
                      (item) => item.id !== record.id,
                    ),
                  })
                }
              >
                Remove
              </button>
            </div>
            <label>
              Country code
              <input
                required
                maxLength={2}
                pattern="[A-Za-z]{2}"
                value={record.countryCode}
                onChange={(event) =>
                  updateAuthorization(record.id, { countryCode: event.target.value.toUpperCase() })
                }
              />
            </label>
            <label>
              Currently authorized
              <select
                value={record.currentlyAuthorized}
                onChange={(event) =>
                  updateAuthorization(record.id, {
                    currentlyAuthorized: event.target.value as "YES" | "NO" | "UNKNOWN",
                  })
                }
              >
                <option value="UNKNOWN">Unknown</option>
                <option value="YES">Yes</option>
                <option value="NO">No</option>
              </select>
            </label>
            <label>
              Sponsorship required now
              <select
                value={record.currentSponsorshipRequired}
                onChange={(event) =>
                  updateAuthorization(record.id, {
                    currentSponsorshipRequired: event.target.value as "YES" | "NO" | "UNKNOWN",
                  })
                }
              >
                <option value="UNKNOWN">Unknown</option>
                <option value="YES">Yes</option>
                <option value="NO">No</option>
              </select>
            </label>
            <label>
              Sponsorship required later
              <select
                value={record.futureSponsorshipRequired}
                onChange={(event) =>
                  updateAuthorization(record.id, {
                    futureSponsorshipRequired: event.target.value as "YES" | "NO" | "UNKNOWN",
                  })
                }
              >
                <option value="UNKNOWN">Unknown</option>
                <option value="YES">Yes</option>
                <option value="NO">No</option>
              </select>
            </label>
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          onClick={() =>
            setDraft({
              ...draft,
              workAuthorization: [...draft.workAuthorization, blankAuthorization()],
            })
          }
        >
          Add work authorization
        </button>
      </fieldset>

      {notice && (
        <div
          className={`notice ${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.message}
        </div>
      )}
      <button className="primary sticky-save" disabled={busy}>
        {busy ? "Saving…" : "Save and verify profile"}
      </button>

      <section className="data-tools" aria-labelledby="backup-heading">
        <h2 id="backup-heading">Backup and restore</h2>
        <p className="help">JSON backups contain personal information. Store them securely.</p>
        <div className="button-row">
          <button type="button" className="secondary" onClick={() => void exportJson()}>
            Export JSON
          </button>
          <label className="file-button">
            Import JSON
            <input
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(event) => void importJson(event)}
            />
          </label>
        </div>
      </section>
    </form>
  );
}

function ObservePanel() {
  const [state, setState] = useState<ScanState>({ status: "idle" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionNotice, setActionNotice] = useState<Notice>(null);
  const [acting, setActing] = useState(false);
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [customSaveScopes, setCustomSaveScopes] = useState<Record<string, string>>({});
  const [approvedResume, setApprovedResume] = useState<ApprovedUploadFile | null>(null);
  const [aiStatus, setAiStatus] = useState<AiConfigStatus>({ configured: false });
  const [aiModel, setAiModel] = useState("gpt-5-mini");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiNotice, setAiNotice] = useState<Notice>(null);
  const [draftingField, setDraftingField] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, GroundedDraftResult>>({});
  const [autoNext, setAutoNext] = useState<AutoNextPanelState | null>(null);
  const [navigationNotice, setNavigationNotice] = useState<Notice>(null);
  const [countdown, setCountdown] = useState<{ intentId: string; remaining: number } | null>(null);
  const executingIntent = useRef<string | null>(null);
  const [submission, setSubmission] = useState<SubmissionPanelState | null>(null);
  const [submissionConsent, setSubmissionConsent] = useState(false);
  const [submissionNotice, setSubmissionNotice] = useState<Notice>(null);
  const [submissionCountdown, setSubmissionCountdown] = useState<{
    intentId: string;
    remaining: number;
  } | null>(null);
  const executingSubmissionIntent = useRef<string | null>(null);

  async function executePreparedSubmission(intentId: string) {
    if (executingSubmissionIntent.current === intentId) return;
    executingSubmissionIntent.current = intentId;
    setActing(true);
    setSubmissionNotice(null);
    try {
      const response = await sendPanelRequest({ type: "PANEL_SUBMISSION_EXECUTE", intentId });
      if (!response.ok) throw new Error(response.error.message);
      const result = SubmissionActionResultSchema.safeParse(response.data);
      if (!result.success || result.data.intent.state !== "CONFIRMED") {
        throw new Error("The Test ATS submission confirmation was invalid.");
      }
      setSubmissionNotice({
        kind: "success",
        message: `One Test ATS submission was confirmed${result.data.intent.confirmationReferenceId ? ` with reference ${result.data.intent.confirmationReferenceId}` : ""}.`,
      });
      setSubmissionConsent(false);
      await scan();
    } catch (error) {
      setSubmissionNotice({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Controlled submission stopped without retrying.",
      });
    } finally {
      setActing(false);
      executingSubmissionIntent.current = null;
    }
  }

  useEffect(() => {
    if (!submissionCountdown) return;
    if (submissionCountdown.remaining <= 0) {
      const intentId = submissionCountdown.intentId;
      setSubmissionCountdown(null);
      void executePreparedSubmission(intentId);
      return;
    }
    const timer = window.setTimeout(
      () =>
        setSubmissionCountdown((current) =>
          current?.intentId === submissionCountdown.intentId
            ? { ...current, remaining: current.remaining - 1 }
            : current,
        ),
      1_000,
    );
    return () => window.clearTimeout(timer);
  }, [submissionCountdown]);

  async function updateSubmissionSetting(
    type: "PANEL_SUBMISSION_SET_ENABLED" | "PANEL_SUBMISSION_SET_APPLICATION",
    enabled: boolean,
  ) {
    if (state.status !== "success") return;
    if (submission) {
      setSubmission({
        ...submission,
        ...(type === "PANEL_SUBMISSION_SET_ENABLED"
          ? { enabled }
          : { applicationOptedIn: enabled }),
      });
    }
    setActing(true);
    setSubmissionNotice(null);
    try {
      const response = await sendPanelRequest({
        type,
        analysisId: state.analysis.analysisId,
        enabled,
      });
      if (!response.ok) throw new Error(response.error.message);
      const parsed = SubmissionPanelStateSchema.safeParse(response.data);
      if (!parsed.success) throw new Error("The submission setting response was invalid.");
      setSubmission(parsed.data);
      if (!enabled) {
        setSubmissionCountdown(null);
        setSubmissionConsent(false);
      }
    } catch (error) {
      setSubmissionNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not update submission settings.",
      });
    } finally {
      setActing(false);
    }
  }

  async function prepareSubmissionCountdown() {
    if (state.status !== "success" || !submissionConsent) return;
    setActing(true);
    setSubmissionNotice(null);
    try {
      const response = await sendPanelRequest({
        type: "PANEL_SUBMISSION_PREPARE",
        analysisId: state.analysis.analysisId,
        explicitConsent: true,
      });
      if (!response.ok) throw new Error(response.error.message);
      const result = SubmissionActionResultSchema.safeParse(response.data);
      if (!result.success || !result.data.panelState) {
        throw new Error("The prepared submission result was invalid.");
      }
      setSubmission(result.data.panelState);
      setSubmissionCountdown({ intentId: result.data.intent.id, remaining: 5 });
    } catch (error) {
      setSubmissionNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "The application is not ready to submit.",
      });
    } finally {
      setActing(false);
    }
  }

  async function cancelSubmissionCountdown() {
    if (!submissionCountdown) return;
    const intentId = submissionCountdown.intentId;
    setSubmissionCountdown(null);
    try {
      const response = await sendPanelRequest({ type: "PANEL_SUBMISSION_ABORT", intentId });
      if (!response.ok) throw new Error(response.error.message);
      const result = SubmissionActionResultSchema.safeParse(response.data);
      if (!result.success) throw new Error("The submission cancellation result was invalid.");
      if (result.data.panelState) setSubmission(result.data.panelState);
      setSubmissionNotice({
        kind: "success",
        message: "Test ATS submission was canceled before dispatch.",
      });
    } catch (error) {
      setSubmissionNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not cancel submission.",
      });
    }
  }

  async function executePreparedNext(intentId: string) {
    if (executingIntent.current === intentId) return;
    executingIntent.current = intentId;
    setActing(true);
    setNavigationNotice(null);
    try {
      const response = await sendPanelRequest({ type: "PANEL_AUTO_NEXT_EXECUTE", intentId });
      if (!response.ok) throw new Error(response.error.message);
      const result = AutoNextActionResultSchema.safeParse(response.data);
      if (!result.success) throw new Error("The controlled navigation result was invalid.");
      setAutoNext(result.data.panelState);
      setNavigationNotice({
        kind: "success",
        message: "One Next click was dispatched and the new Workday step was verified.",
      });
      await scan();
    } catch (error) {
      setNavigationNotice({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Controlled navigation stopped without retrying.",
      });
    } finally {
      setActing(false);
      executingIntent.current = null;
    }
  }

  useEffect(() => {
    if (!countdown) return;
    if (countdown.remaining <= 0) {
      const intentId = countdown.intentId;
      setCountdown(null);
      void executePreparedNext(intentId);
      return;
    }
    const timer = window.setTimeout(
      () =>
        setCountdown((current) =>
          current?.intentId === countdown.intentId
            ? { ...current, remaining: current.remaining - 1 }
            : current,
        ),
      1_000,
    );
    return () => window.clearTimeout(timer);
  }, [countdown]);

  async function updateAutoNextSetting(
    type: "PANEL_AUTO_NEXT_SET_ENABLED" | "PANEL_AUTO_NEXT_SET_APPLICATION",
    enabled: boolean,
  ) {
    if (state.status !== "success") return;
    if (autoNext) {
      setAutoNext({
        ...autoNext,
        ...(type === "PANEL_AUTO_NEXT_SET_ENABLED" ? { enabled } : { applicationOptedIn: enabled }),
      });
    }
    setActing(true);
    setNavigationNotice(null);
    try {
      const response = await sendPanelRequest({
        type,
        analysisId: state.analysis.analysisId,
        enabled,
      });
      if (!response.ok) throw new Error(response.error.message);
      const parsed = AutoNextPanelStateSchema.safeParse(response.data);
      if (!parsed.success) throw new Error("The auto-next setting response was invalid.");
      setAutoNext(parsed.data);
      if (!enabled && countdown) setCountdown(null);
    } catch (error) {
      setNavigationNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not update auto-next settings.",
      });
    } finally {
      setActing(false);
    }
  }

  async function prepareAutoNextCountdown() {
    if (state.status !== "success") return;
    setActing(true);
    setNavigationNotice(null);
    try {
      const response = await sendPanelRequest({
        type: "PANEL_AUTO_NEXT_PREPARE",
        analysisId: state.analysis.analysisId,
      });
      if (!response.ok) throw new Error(response.error.message);
      const result = AutoNextActionResultSchema.safeParse(response.data);
      if (!result.success) throw new Error("The prepared navigation result was invalid.");
      setAutoNext(result.data.panelState);
      setCountdown({ intentId: result.data.intent.id, remaining: 3 });
    } catch (error) {
      setNavigationNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Controlled navigation was not ready.",
      });
    } finally {
      setActing(false);
    }
  }

  async function cancelAutoNextCountdown() {
    if (!countdown) return;
    const intentId = countdown.intentId;
    setCountdown(null);
    try {
      const response = await sendPanelRequest({ type: "PANEL_AUTO_NEXT_ABORT", intentId });
      if (!response.ok) throw new Error(response.error.message);
      const result = AutoNextActionResultSchema.safeParse(response.data);
      if (!result.success) throw new Error("The cancellation result was invalid.");
      setAutoNext(result.data.panelState);
      setNavigationNotice({
        kind: "success",
        message: "Controlled Next was canceled before click.",
      });
    } catch (error) {
      setNavigationNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not cancel controlled Next.",
      });
    }
  }

  async function loadAiStatus() {
    try {
      const response = await sendPanelRequest({ type: "PANEL_AI_CONFIG_GET" });
      if (!response.ok) throw new Error(response.error.message);
      const parsed = AiConfigStatusSchema.safeParse(response.data);
      if (!parsed.success) throw new Error("The AI configuration status was invalid.");
      setAiStatus(parsed.data);
      if (parsed.data.model) setAiModel(parsed.data.model);
    } catch (error) {
      setAiNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not read AI settings.",
      });
    }
  }

  useEffect(() => void loadAiStatus(), []);

  async function configureAi() {
    if (!aiApiKey.trim() || !aiModel.trim()) {
      setAiNotice({ kind: "error", message: "Enter an API key and model." });
      return;
    }
    setActing(true);
    setAiNotice(null);
    try {
      const granted = await chrome.permissions.request({ origins: ["https://api.openai.com/*"] });
      if (!granted) throw new Error("OpenAI network permission was not granted.");
      const response = await sendPanelRequest({
        type: "PANEL_AI_CONFIG_SET",
        config: { provider: "OPENAI", model: aiModel.trim(), apiKey: aiApiKey.trim() },
      });
      if (!response.ok) throw new Error(response.error.message);
      const parsed = AiConfigStatusSchema.safeParse(response.data);
      if (!parsed.success) throw new Error("The AI configuration status was invalid.");
      setAiStatus(parsed.data);
      setAiApiKey("");
      setAiNotice({
        kind: "success",
        message: "AI drafting is enabled for this browser session only.",
      });
    } catch (error) {
      setAiNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not configure AI drafting.",
      });
    } finally {
      setActing(false);
    }
  }

  async function clearAi() {
    setActing(true);
    setAiNotice(null);
    try {
      const response = await sendPanelRequest({ type: "PANEL_AI_CONFIG_CLEAR" });
      if (!response.ok) throw new Error(response.error.message);
      setAiStatus({ configured: false });
      setDrafts({});
      setAiNotice({ kind: "success", message: "The session-only AI configuration was cleared." });
    } catch (error) {
      setAiNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not clear AI settings.",
      });
    } finally {
      setActing(false);
    }
  }

  async function requestDraft(question: CustomQuestion) {
    if (state.status !== "success") return;
    setDraftingField(question.field.fieldId);
    setActionNotice(null);
    try {
      const response = await sendPanelRequest({
        type: "PANEL_AI_DRAFT",
        analysisId: state.analysis.analysisId,
        fieldId: question.field.fieldId,
        maxChars: question.field.maxLength ?? 1_000,
      });
      if (!response.ok) throw new Error(response.error.message);
      const parsed = GroundedDraftResultSchema.safeParse(response.data);
      if (!parsed.success) throw new Error("The AI draft response was invalid.");
      setDrafts((current) => ({ ...current, [question.field.fieldId]: parsed.data }));
    } catch (error) {
      setActionNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not create an AI draft.",
      });
    } finally {
      setDraftingField(null);
    }
  }

  async function scan() {
    setActionNotice(null);
    try {
      const siteAccess = await ensureActiveSiteAccess(
        () => chrome.tabs.query({ active: true, lastFocusedWindow: true }),
        (originPattern) => chrome.permissions.contains({ origins: [originPattern] }),
        (originPattern) => chrome.permissions.request({ origins: [originPattern] }),
      );
      if (!siteAccess.granted) {
        setState({ status: "error", message: siteAccess.message });
        return;
      }

      setState({ status: "loading" });
      const response = await sendPanelRequest({ type: "PANEL_ANALYZE_ACTIVE_TAB" });
      if (!response.ok) {
        setState({ status: "error", message: response.error.message });
        return;
      }
      const analysis = ApplicationPageAnalysisSchema.safeParse(response.data);
      if (!analysis.success) {
        setState({ status: "error", message: "The scan returned no form analysis." });
        return;
      }
      setSelected(
        new Set(
          analysis.data.mappings
            .filter(
              (mapping) =>
                mapping.fillable &&
                mapping.confidence >= 0.95 &&
                (mapping.tier === "R0" || mapping.tier === "R1"),
            )
            .map((mapping) => mapping.fieldId),
        ),
      );
      if (analysis.data.workflow) {
        const navigationResponse = await sendPanelRequest({
          type: "PANEL_AUTO_NEXT_STATUS",
          analysisId: analysis.data.analysisId,
        });
        const navigationState = navigationResponse.ok
          ? AutoNextPanelStateSchema.safeParse(navigationResponse.data)
          : null;
        setAutoNext(navigationState?.success ? navigationState.data : null);
        const submissionResponse = await sendPanelRequest({
          type: "PANEL_SUBMISSION_STATUS",
          analysisId: analysis.data.analysisId,
        });
        const submissionState = submissionResponse.ok
          ? SubmissionPanelStateSchema.safeParse(submissionResponse.data)
          : null;
        setSubmission(submissionState?.success ? submissionState.data : null);
      } else {
        setAutoNext(null);
        setSubmission(null);
      }
      setState({ status: "success", analysis: analysis.data });
      setSubmissionConsent(false);
      setCustomAnswers(
        Object.fromEntries(
          analysis.data.customQuestions.flatMap((question) => {
            const value = suggestedControlValue(question);
            return value ? [[question.field.fieldId, value]] : [];
          }),
        ),
      );
      setCustomSaveScopes({});
      setApprovedResume(null);
      setDrafts({});
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not reach the extension worker.",
      });
    }
  }

  async function fillCustomAnswers() {
    if (state.status !== "success") return;
    const answers = state.analysis.customQuestions.flatMap((question) => {
      const value = customAnswers[question.field.fieldId] ?? "";
      const saveScope = customSaveScopes[question.field.fieldId];
      return question.responseMode !== "MANUAL" && value.trim()
        ? [
            {
              fieldId: question.field.fieldId,
              value,
              ...(saveScope ? { saveScope } : {}),
            },
          ]
        : [];
    });
    if (answers.length === 0) {
      setActionNotice({ kind: "error", message: "Enter at least one reviewed custom answer." });
      return;
    }
    setActing(true);
    setActionNotice(null);
    try {
      const response = await sendPanelRequest({
        type: "PANEL_FILL_CUSTOM_ANSWERS",
        analysisId: state.analysis.analysisId,
        answers,
      });
      if (!response.ok) throw new Error(response.error.message);
      const result = FillResultSchema.safeParse(response.data);
      if (!result.success) throw new Error("The custom-answer fill response was invalid.");
      setActionNotice({
        kind: "success",
        message: `Filled ${result.data.filledFieldIds.length} explicitly reviewed custom answer${result.data.filledFieldIds.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setActionNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not fill custom answers.",
      });
    } finally {
      setActing(false);
    }
  }

  async function chooseApprovedResume(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setActionNotice(null);
    try {
      setApprovedResume(await readApprovedResumeFile(file));
    } catch (error) {
      setApprovedResume(null);
      setActionNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not approve this résumé file.",
      });
    }
  }

  async function uploadResume(fieldId: string) {
    if (state.status !== "success" || !approvedResume) return;
    setActing(true);
    setActionNotice(null);
    try {
      const response = await sendPanelRequest({
        type: "PANEL_UPLOAD_APPROVED_RESUME",
        analysisId: state.analysis.analysisId,
        fieldId,
        file: approvedResume,
      });
      if (!response.ok) throw new Error(response.error.message);
      const result = UploadResultSchema.safeParse(response.data);
      if (!result.success || !result.data.uploaded)
        throw new Error("The résumé upload was not verified.");
      setActionNotice({
        kind: "success",
        message: `Uploaded only the approved file ${result.data.fileName}.`,
      });
    } catch (error) {
      setActionNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not upload the approved résumé.",
      });
    } finally {
      setActing(false);
    }
  }

  async function runReviewedAction(action: "highlight" | "fill") {
    if (state.status !== "success") return;
    const fieldIds = [...selected];
    if (fieldIds.length === 0) {
      setActionNotice({ kind: "error", message: "Select at least one approved field." });
      return;
    }
    setActing(true);
    setActionNotice(null);
    try {
      const response = await sendPanelRequest({
        type: action === "highlight" ? "PANEL_HIGHLIGHT_ACTIVE_FIELDS" : "PANEL_FILL_ACTIVE_FIELDS",
        analysisId: state.analysis.analysisId,
        fieldIds,
      });
      if (!response.ok) throw new Error(response.error.message);
      if (action === "highlight") {
        const result = HighlightResultSchema.safeParse(response.data);
        if (!result.success) throw new Error("The highlight response was invalid.");
        setActionNotice({
          kind: "success",
          message: `Highlighted ${result.data.highlightedFieldIds.length} reviewed field${result.data.highlightedFieldIds.length === 1 ? "" : "s"}.`,
        });
      } else {
        const result = FillResultSchema.safeParse(response.data);
        if (!result.success) throw new Error("The fill response was invalid.");
        setActionNotice({
          kind: result.data.skipped.length > 0 ? "error" : "success",
          message: `Filled ${result.data.filledFieldIds.length} reviewed field${result.data.filledFieldIds.length === 1 ? "" : "s"}.${result.data.skipped.length > 0 ? ` ${result.data.skipped.length} protected field${result.data.skipped.length === 1 ? " was" : "s were"} skipped.` : ""}`,
        });
      }
    } catch (error) {
      setActionNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "The reviewed action failed.",
      });
    } finally {
      setActing(false);
    }
  }

  function renderAiDraft(question: CustomQuestion) {
    const draft = drafts[question.field.fieldId];
    if (!draft) return null;
    if (draft.status === "REFUSED") {
      return (
        <div className="notice error" role="alert">
          <strong>AI draft withheld</strong>
          <span>{draft.message}</span>
        </div>
      );
    }
    return (
      <div className="ai-draft" role="status">
        <strong>Grounded AI draft — review required</strong>
        <p>{draft.answer}</p>
        <small>
          {draft.charCount}/{draft.maxChars} characters · Evidence:{" "}
          {draft.evidence.map((item) => item.id).join(", ")}
        </small>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            setCustomAnswers({
              ...customAnswers,
              [question.field.fieldId]: draft.answer,
            })
          }
        >
          Use this draft in review
        </button>
      </div>
    );
  }

  return (
    <section className="observe-panel">
      <p className="intro">
        Scan and review deterministic matches. Filling only happens after you select fields here;
        submission is never automated.
      </p>
      <section className="phase3-card ai-settings" aria-labelledby="ai-settings-heading">
        <div className="section-heading">
          <div>
            <h2 id="ai-settings-heading">Optional grounded AI drafts</h2>
            <p className="help">
              The key stays in Chrome session storage and is never saved in your profile, backups,
              page fields, or AI audit records. Drafts never fill automatically.
            </p>
          </div>
          <span className="status">{aiStatus.configured ? "Session on" : "Off"}</span>
        </div>
        {aiStatus.configured ? (
          <div className="approved-file">
            <strong>{aiStatus.provider === "FIXTURE" ? "Test provider" : "OpenAI"}</strong>
            <small>{aiStatus.model}</small>
            <button
              type="button"
              className="secondary"
              disabled={acting}
              onClick={() => void clearAi()}
            >
              Clear session settings
            </button>
          </div>
        ) : (
          <div className="ai-config-grid">
            <label>
              OpenAI model
              <input
                value={aiModel}
                maxLength={200}
                autoComplete="off"
                onChange={(event) => setAiModel(event.target.value)}
              />
            </label>
            <label>
              OpenAI API key
              <input
                type="password"
                value={aiApiKey}
                maxLength={500}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setAiApiKey(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="secondary"
              disabled={acting}
              onClick={() => void configureAi()}
            >
              Enable for this session
            </button>
          </div>
        )}
        {aiNotice && (
          <div
            className={`notice ${aiNotice.kind}`}
            role={aiNotice.kind === "error" ? "alert" : "status"}
          >
            {aiNotice.message}
          </div>
        )}
      </section>
      <button className="primary" disabled={state.status === "loading"} onClick={() => void scan()}>
        {state.status === "loading" ? "Scanning…" : "Scan and match visible form"}
      </button>
      <div aria-live="polite" aria-busy={state.status === "loading"}>
        {state.status === "idle" && <p className="empty">Ready to scan a job application form.</p>}
        {state.status === "error" && (
          <div className="notice error" role="alert">
            <strong>Scan stopped</strong>
            <span>{state.message}</span>
          </div>
        )}
        {state.status === "success" && (
          <>
            <section className="job-card" aria-label="Detected job">
              <div className="job-heading">
                <span className="status">{state.analysis.ats.adapter}</span>
                <span>{Math.round(state.analysis.ats.confidence * 100)}% detected</span>
              </div>
              {state.analysis.job ? (
                <>
                  <h2>{state.analysis.job.title}</h2>
                  <p>
                    {state.analysis.job.company}
                    {state.analysis.job.location ? ` · ${state.analysis.job.location}` : ""}
                  </p>
                  <small>
                    Tracker status: {state.analysis.confirmation.confirmed ? "APPLIED" : "APPLYING"}
                  </small>
                </>
              ) : (
                <p>Job metadata was not available on this page.</p>
              )}
            </section>
            {state.analysis.duplicateWarnings.length > 0 && (
              <section className="duplicate-alert" aria-labelledby="duplicate-alert-heading">
                <h2 id="duplicate-alert-heading">Possible duplicate application</h2>
                {state.analysis.duplicateWarnings.map((warning) => (
                  <p key={`${warning.kind}:${warning.existingApplicationId}`}>
                    {warning.message} ({Math.round(warning.confidence * 100)}% confidence)
                  </p>
                ))}
                <small>
                  This is a warning only. Review the existing tracker record before continuing.
                </small>
              </section>
            )}
            {state.analysis.workflow && (
              <section className="phase3-card workflow-card" aria-labelledby="workflow-heading">
                <div className="job-heading">
                  <h2 id="workflow-heading">Workday application progress</h2>
                  <span className="status">
                    {state.analysis.workflow.pageType.replaceAll("_", " ")}
                  </span>
                </div>
                <p>
                  Tenant {state.analysis.workflow.tenant} · Site {state.analysis.workflow.site}
                </p>
                {state.analysis.workflow.stepLabel && (
                  <p>
                    <strong>{state.analysis.workflow.stepLabel}</strong>
                    {state.analysis.workflow.stepIndex && state.analysis.workflow.stepCount
                      ? ` · Step ${state.analysis.workflow.stepIndex} of ${state.analysis.workflow.stepCount}`
                      : ""}
                  </p>
                )}
                <p className="help">
                  {state.analysis.workflow.pageType === "REVIEW" &&
                  state.analysis.workflow.navigation.mode === "CONTROLLED_TEST_ONLY"
                    ? "Controlled submission is available only on this local Test ATS review fixture. It requires separate opt-ins, an explicit final authorization, and one non-retryable Submit dispatch."
                    : state.analysis.workflow.navigation.mode === "CONTROLLED_TEST_ONLY"
                      ? "Controlled Next is available only on this local Test ATS fixture. It is off by default, clicks once after a cancelable countdown, and never clicks Submit."
                      : "Navigation is manual-only on real Workday pages. Complete this page yourself, move forward once, then rescan. The copilot never clicks Next or Submit."}
                </p>
                <p className="help">
                  Page controls: Back{" "}
                  {state.analysis.workflow.navigation.backVisible ? "available" : "not available"}
                  {" · "}Next{" "}
                  {state.analysis.workflow.navigation.nextVisible ? "available" : "not available"}
                  {" · "}Submit{" "}
                  {state.analysis.workflow.navigation.submitVisible ? "available" : "not available"}
                </p>
                {state.analysis.workflowProgress?.recovered && (
                  <div className="notice success" role="status">
                    <strong>Progress recovered from local storage</strong>
                    <span>
                      {state.analysis.workflowProgress.observedPageKeys.length} distinct Workday
                      page
                      {state.analysis.workflowProgress.observedPageKeys.length === 1
                        ? ""
                        : "s"}{" "}
                      observed across {state.analysis.workflowProgress.observationCount} scans.
                    </span>
                  </div>
                )}
                {state.analysis.workflow.resumeReconciliationRequired && (
                  <div className="notice warning" role="status">
                    <strong>Review résumé-parsed values</strong>
                    <span>
                      {state.analysis.workflow.prefilledFieldCount} visible field
                      {state.analysis.workflow.prefilledFieldCount === 1 ? " is" : "s are"}
                      already populated. They are protected from overwrite and require manual
                      reconciliation.
                    </span>
                  </div>
                )}
                {state.analysis.workflow.authBoundary !== "NONE" && (
                  <div className="notice warning" role="status">
                    <strong>Manual authentication boundary</strong>
                    <span>
                      {state.analysis.workflow.navigation.blockedReason ??
                        "Complete authentication manually, then rescan."}
                    </span>
                  </div>
                )}
                {state.analysis.workflowProgress?.revisitDetected && (
                  <div className="notice warning" role="status">
                    <strong>Previously visited step detected</strong>
                    <span>
                      Check page validation before continuing. The copilot will not repeat a
                      navigation action.
                    </span>
                  </div>
                )}
                {state.analysis.workflow.errorState && (
                  <div className="notice error" role="alert">
                    <strong>{state.analysis.workflow.errorState.kind.replaceAll("_", " ")}</strong>
                    <span>{state.analysis.workflow.errorState.message}</span>
                  </div>
                )}
                {autoNext &&
                  state.analysis.workflow.pageType !== "REVIEW" &&
                  state.analysis.workflow.navigation.mode === "CONTROLLED_TEST_ONLY" && (
                    <div className="auto-next-controls" aria-labelledby="auto-next-heading">
                      <div className="section-heading">
                        <div>
                          <h3 id="auto-next-heading">Experimental controlled Next</h3>
                          <p className="help">Both switches must be on for this application.</p>
                        </div>
                        <span className="status">
                          {autoNext.readiness.ready ? "Ready" : "Stopped"}
                        </span>
                      </div>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={autoNext.enabled}
                          disabled={acting || Boolean(countdown)}
                          onChange={(event) =>
                            void updateAutoNextSetting(
                              "PANEL_AUTO_NEXT_SET_ENABLED",
                              event.target.checked,
                            )
                          }
                        />
                        Enable experimental auto-next globally
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={autoNext.applicationOptedIn}
                          disabled={acting || !autoNext.enabled || Boolean(countdown)}
                          onChange={(event) =>
                            void updateAutoNextSetting(
                              "PANEL_AUTO_NEXT_SET_APPLICATION",
                              event.target.checked,
                            )
                          }
                        />
                        Enable for this application
                      </label>
                      <ul className="readiness-list" aria-label="Controlled Next readiness checks">
                        {autoNext.readiness.checks.map((item) => (
                          <li className={item.passed ? "passed" : "blocked"} key={item.code}>
                            <span aria-hidden="true">{item.passed ? "✓" : "!"}</span>
                            {item.message}
                          </li>
                        ))}
                      </ul>
                      {countdown ? (
                        <div className="notice warning" role="status">
                          <strong>Next in {countdown.remaining} seconds</strong>
                          <span>You can cancel until the single click is dispatched.</span>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => void cancelAutoNextCountdown()}
                          >
                            Cancel controlled Next
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="primary"
                          disabled={acting || !autoNext.readiness.ready}
                          onClick={() => void prepareAutoNextCountdown()}
                        >
                          Prepare controlled Next
                        </button>
                      )}
                      {navigationNotice && (
                        <div
                          className={`notice ${navigationNotice.kind}`}
                          role={navigationNotice.kind === "error" ? "alert" : "status"}
                        >
                          {navigationNotice.message}
                        </div>
                      )}
                    </div>
                  )}
                {submission &&
                  state.analysis.workflow.pageType === "REVIEW" &&
                  state.analysis.workflow.navigation.mode === "CONTROLLED_TEST_ONLY" && (
                    <div className="submission-controls" aria-labelledby="submission-heading">
                      <div className="section-heading">
                        <div>
                          <h3 id="submission-heading">Controlled Test ATS submission</h3>
                          <p className="help">
                            Final submission is irreversible inside this synthetic fixture. Real ATS
                            submission remains disabled.
                          </p>
                        </div>
                        <span className="status">
                          {submission.readiness.ready ? "Ready" : "Stopped"}
                        </span>
                      </div>
                      <div className="submission-summary" aria-label="Final application summary">
                        <strong>{state.analysis.job?.title ?? "Unknown role"}</strong>
                        <span>{state.analysis.job?.company ?? "Unknown company"}</span>
                        <span>Adapter: {state.analysis.ats.adapter}</span>
                        <span>
                          Workflow: {state.analysis.workflowProgress?.observedPageKeys.length ?? 0}/
                          {state.analysis.workflow.stepCount ?? 0} steps observed
                        </span>
                      </div>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={submission.enabled}
                          disabled={acting || Boolean(submissionCountdown)}
                          onChange={(event) =>
                            void updateSubmissionSetting(
                              "PANEL_SUBMISSION_SET_ENABLED",
                              event.target.checked,
                            )
                          }
                        />
                        Enable controlled Test ATS submission globally
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={submission.applicationOptedIn}
                          disabled={acting || !submission.enabled || Boolean(submissionCountdown)}
                          onChange={(event) =>
                            void updateSubmissionSetting(
                              "PANEL_SUBMISSION_SET_APPLICATION",
                              event.target.checked,
                            )
                          }
                        />
                        Enable submission for this application
                      </label>
                      <ul className="readiness-list" aria-label="Submission readiness checks">
                        {submission.readiness.checks.map((item) => (
                          <li className={item.passed ? "passed" : "blocked"} key={item.code}>
                            <span aria-hidden="true">{item.passed ? "✓" : "!"}</span>
                            {item.message}
                          </li>
                        ))}
                      </ul>
                      <label className="final-consent">
                        <input
                          type="checkbox"
                          checked={submissionConsent}
                          disabled={
                            acting || !submission.readiness.ready || Boolean(submissionCountdown)
                          }
                          onChange={(event) => setSubmissionConsent(event.target.checked)}
                        />
                        I reviewed the final summary and authorize exactly one submission to the
                        local Test ATS.
                      </label>
                      {submissionCountdown ? (
                        <div className="notice warning" role="status">
                          <strong>
                            Test submission in {submissionCountdown.remaining} seconds
                          </strong>
                          <span>
                            Cancel now to prevent the single irreversible Test ATS dispatch.
                          </span>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => void cancelSubmissionCountdown()}
                          >
                            Cancel Test ATS submission
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="danger-submit"
                          disabled={acting || !submission.readiness.ready || !submissionConsent}
                          onClick={() => void prepareSubmissionCountdown()}
                        >
                          Prepare one Test ATS submission
                        </button>
                      )}
                      {submissionNotice && (
                        <div
                          className={`notice ${submissionNotice.kind}`}
                          role={submissionNotice.kind === "error" ? "alert" : "status"}
                        >
                          {submissionNotice.message}
                        </div>
                      )}
                    </div>
                  )}
              </section>
            )}
            {state.analysis.confirmation.confirmed && (
              <div className="notice success" role="status">
                <strong>{state.analysis.confirmation.heading ?? "Application confirmed"}</strong>
                <span>
                  The local tracker was updated to APPLIED
                  {state.analysis.confirmation.referenceId
                    ? ` with reference ${state.analysis.confirmation.referenceId}.`
                    : "."}
                </span>
              </div>
            )}
            <div className="summary">
              <strong>{state.analysis.snapshot.fields.length}</strong>
              <span>inspectable fields · {selected.size} approved for review</span>
            </div>
            <div className="review-actions">
              <button
                type="button"
                className="secondary"
                disabled={acting || selected.size === 0}
                onClick={() => void runReviewedAction("highlight")}
              >
                Highlight selected
              </button>
              <button
                type="button"
                className="primary"
                disabled={acting || selected.size === 0}
                onClick={() => void runReviewedAction("fill")}
              >
                {acting ? "Working…" : "Fill selected fields"}
              </button>
            </div>
            {actionNotice && (
              <div
                className={`notice ${actionNotice.kind}`}
                role={actionNotice.kind === "error" ? "alert" : "status"}
              >
                {actionNotice.message}
              </div>
            )}
            <ol className="fields mapping-fields">
              {state.analysis.mappings.map((mapping) => {
                const field = state.analysis.snapshot.fields.find(
                  (candidate) => candidate.fieldId === mapping.fieldId,
                );
                const label = field?.accessibleName || "Unnamed field";
                return (
                  <li key={mapping.fieldId}>
                    <label className="field-select">
                      <input
                        type="checkbox"
                        aria-label={`Select ${label}`}
                        checked={selected.has(mapping.fieldId)}
                        disabled={!mapping.fillable}
                        onChange={(event) => {
                          const next = new Set(selected);
                          if (event.target.checked) next.add(mapping.fieldId);
                          else next.delete(mapping.fieldId);
                          setSelected(next);
                        }}
                      />
                      <span>
                        <strong>{label}</strong>
                        <small>{mapping.canonicalQuestion ?? "Unmapped"}</small>
                        {mapping.blockedReason && <small>{mapping.blockedReason}</small>}
                      </span>
                    </label>
                    <div className="mapping-meta">
                      <span className="status">{mapping.tier}</span>
                      <span>{Math.round(mapping.confidence * 100)}%</span>
                      {field?.required && <span>Required</span>}
                      {field?.userEdited && <span className="protected">User edited</span>}
                      {field?.valueState === "PREFILLED" && (
                        <span className="protected">Pre-filled · review manually</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            {state.analysis.mappings.some(
              (mapping) => mapping.canonicalQuestion === "APPLICATION.resume",
            ) && (
              <section className="phase3-card" aria-labelledby="resume-upload-heading">
                <h2 id="resume-upload-heading">Approved résumé upload</h2>
                <p className="help">
                  Select the exact PDF or DOCX for this application. The file is verified, sent only
                  to the detected résumé control, and is not retained by the extension.
                </p>
                <label className="file-button">
                  Choose résumé for this application
                  <input
                    type="file"
                    accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
                    disabled={acting}
                    onChange={(event) => void chooseApprovedResume(event)}
                  />
                </label>
                {approvedResume && (
                  <div className="approved-file">
                    <strong>{approvedResume.fileName}</strong>
                    <small>SHA-256 {approvedResume.sha256.slice(0, 12)}…</small>
                    <button
                      type="button"
                      className="primary"
                      disabled={acting}
                      onClick={() => {
                        const field = state.analysis.mappings.find(
                          (mapping) => mapping.canonicalQuestion === "APPLICATION.resume",
                        );
                        if (field) void uploadResume(field.fieldId);
                      }}
                    >
                      Upload this approved résumé
                    </button>
                  </div>
                )}
              </section>
            )}
            {state.analysis.customQuestions.length > 0 && (
              <section className="phase3-card" aria-labelledby="custom-questions-heading">
                <h2 id="custom-questions-heading">Custom question review</h2>
                <p className="help">
                  These questions did not match verified profile facts. Answers are filled only from
                  what you enter here.
                </p>
                {state.analysis.customQuestions.map((question, index) => (
                  <div className="custom-question" key={question.field.fieldId}>
                    <div className="question-heading">
                      <strong>{question.label}</strong>
                      <span className={`risk risk-${question.savedResponse.risk ?? "unknown"}`}>
                        {question.savedResponse.risk ?? "Unclassified"}
                      </span>
                    </div>
                    {question.required && <span className="sensitive">Required</span>}
                    <p className="help">{question.reviewReason}</p>
                    {question.savedResponse.status === "MATCH" && (
                      <div className="saved-suggestion" role="status">
                        <strong>Saved response suggested</strong>
                        <span>
                          {question.savedResponse.method?.replaceAll("_", " ")} · Expires{" "}
                          {question.savedResponse.expiresAt?.slice(0, 10)} · Review before filling
                        </span>
                      </div>
                    )}
                    {question.savedResponse.status === "STALE" && (
                      <div className="notice error">
                        A matching saved response is stale. Enter and confirm a current answer.
                      </div>
                    )}
                    {aiStatus.configured &&
                      question.savedResponse.status !== "MATCH" &&
                      question.responseMode === "TEXT" &&
                      (question.field.controlKind === "text" ||
                        question.field.controlKind === "textarea") &&
                      (question.field.maxLength ?? 1_000) >= 50 && (
                        <button
                          type="button"
                          className="secondary"
                          disabled={draftingField !== null}
                          onClick={() => void requestDraft(question)}
                        >
                          {draftingField === question.field.fieldId
                            ? "Drafting…"
                            : "Draft with grounded AI"}
                        </button>
                      )}
                    {renderAiDraft(question)}
                    {question.responseMode === "TEXT" && (
                      <label htmlFor={`custom-answer-${index}`}>
                        Your reviewed answer
                        <textarea
                          id={`custom-answer-${index}`}
                          aria-label={question.label}
                          rows={3}
                          value={customAnswers[question.field.fieldId] ?? ""}
                          onChange={(event) =>
                            setCustomAnswers({
                              ...customAnswers,
                              [question.field.fieldId]: event.target.value,
                            })
                          }
                        />
                      </label>
                    )}
                    {question.responseMode === "SELECT" && (
                      <label htmlFor={`custom-answer-${index}`}>
                        Your reviewed answer
                        <select
                          id={`custom-answer-${index}`}
                          aria-label={question.label}
                          value={customAnswers[question.field.fieldId] ?? ""}
                          onChange={(event) =>
                            setCustomAnswers({
                              ...customAnswers,
                              [question.field.fieldId]: event.target.value,
                            })
                          }
                        >
                          <option value="">Choose an answer</option>
                          {question.field.options
                            .filter((option) => !option.disabled && option.value)
                            .map((option) => (
                              <option value={option.value} key={option.value}>
                                {option.text}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    {question.responseMode === "MANUAL" && (
                      <small>Complete this control manually on the application page.</small>
                    )}
                    {question.responseMode !== "MANUAL" && (
                      <label htmlFor={`save-scope-${index}`}>
                        Save this answer for future applications?
                        <select
                          id={`save-scope-${index}`}
                          value={customSaveScopes[question.field.fieldId] ?? ""}
                          onChange={(event) =>
                            setCustomSaveScopes({
                              ...customSaveScopes,
                              [question.field.fieldId]: event.target.value,
                            })
                          }
                        >
                          <option value="">Do not save</option>
                          {question.savedResponse.allowedScopes.map((scope) => (
                            <option value={scope} key={scope}>
                              {scopeLabel(scope)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className="primary"
                  disabled={acting}
                  onClick={() => void fillCustomAnswers()}
                >
                  Fill reviewed custom answers
                </button>
              </section>
            )}
          </>
        )}
      </div>
    </section>
  );
}

const TRACKER_COLUMNS: Array<{ label: string; statuses: ApplicationStatus[] }> = [
  { label: "Saved", statuses: ["DISCOVERED", "SAVED", "SHORTLISTED"] },
  { label: "Applying", statuses: ["APPLYING"] },
  { label: "Applied", statuses: ["APPLIED"] },
  { label: "Interviews", statuses: ["SCREEN", "INTERVIEW", "FINAL"] },
  { label: "Decision", statuses: ["OFFER", "REJECTED", "WITHDRAWN", "ARCHIVED"] },
];

function duplicateApplicationIds(applications: ApplicationRecord[]): Set<string> {
  const groups = new Map<string, string[]>();
  for (const application of applications) {
    const identity = application.canonicalIdentity;
    const key = `${identity.normalizedCompany}|${identity.normalizedTitle}|${identity.normalizedLocation}`;
    groups.set(key, [...(groups.get(key) ?? []), application.id]);
  }
  return new Set([...groups.values()].filter((ids) => ids.length > 1).flat());
}

function ApplicationsPanel() {
  const [tracker, setTracker] = useState<ApplicationTracker | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [atsFilter, setAtsFilter] = useState("ALL");
  const [view, setView] = useState<"board" | "table">("board");
  const [busyId, setBusyId] = useState("");

  async function loadTracker() {
    setError("");
    try {
      const response = await sendPanelRequest({ type: "PANEL_TRACKER_GET" });
      if (!response.ok) throw new Error(response.error.message);
      const parsed = ApplicationTrackerSchema.safeParse(response.data);
      if (!parsed.success) throw new Error("The local tracker response was invalid.");
      setTracker(parsed.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the local tracker.");
    }
  }

  useEffect(() => void loadTracker(), []);

  async function updateStatus(applicationId: string, status: ApplicationStatus) {
    setBusyId(applicationId);
    setError("");
    setNotice("");
    try {
      const response = await sendPanelRequest({
        type: "PANEL_TRACKER_UPDATE_STATUS",
        applicationId,
        status,
      });
      if (!response.ok) throw new Error(response.error.message);
      const parsed = ApplicationTrackerSchema.safeParse(response.data);
      if (!parsed.success) throw new Error("The updated tracker response was invalid.");
      setTracker(parsed.data);
      setNotice("Application status updated locally.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the application.");
    } finally {
      setBusyId("");
    }
  }

  async function exportCsv() {
    setError("");
    setNotice("");
    try {
      const response = await sendPanelRequest({ type: "PANEL_TRACKER_EXPORT_CSV" });
      if (!response.ok) throw new Error(response.error.message);
      const parsed = TrackerCsvExportSchema.safeParse(response.data);
      if (!parsed.success) throw new Error("The tracker export was invalid.");
      const url = URL.createObjectURL(
        new Blob([parsed.data.csv], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `job-application-tracker-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice(
        `Exported ${parsed.data.exported} application${parsed.data.exported === 1 ? "" : "s"}.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not export the tracker.");
    }
  }

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setNotice("");
    try {
      const response = await sendPanelRequest({
        type: "PANEL_TRACKER_IMPORT_CSV",
        csv: await file.text(),
      });
      if (!response.ok) throw new Error(response.error.message);
      const parsed = TrackerCsvImportResultSchema.safeParse(response.data);
      if (!parsed.success) throw new Error("The tracker import result was invalid.");
      setTracker(parsed.data.tracker);
      setNotice(
        `Imported ${parsed.data.imported}, updated ${parsed.data.updated}, skipped ${parsed.data.skipped}.${parsed.data.warnings[0] ? ` ${parsed.data.warnings[0]}` : ""}`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not import the tracker CSV.");
    }
  }

  const applications = tracker?.applications ?? [];
  const duplicateIds = duplicateApplicationIds(applications);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = applications.filter(
    (application) =>
      (!normalizedQuery ||
        [application.job.title, application.job.company, application.job.location ?? ""]
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalizedQuery)) &&
      (statusFilter === "ALL" || application.status === statusFilter) &&
      (atsFilter === "ALL" || application.ats === atsFilter),
  );
  const statuses = ApplicationStatusSchema.options;
  const atsOptions = [...new Set(applications.map((application) => application.ats))].sort();

  function ApplicationCard({ application }: { application: ApplicationRecord }) {
    return (
      <article className="tracker-card">
        <div className="tracker-card-heading">
          <strong>{application.job.title}</strong>
          {duplicateIds.has(application.id) && (
            <span className="duplicate-badge">Possible duplicate</span>
          )}
        </div>
        <span>{application.job.company}</span>
        <small>
          {application.job.location ?? "Location not specified"} · {application.ats}
        </small>
        <small>
          {application.snapshots.length} snapshot{application.snapshots.length === 1 ? "" : "s"} ·
          Updated {new Date(application.updatedAt).toLocaleDateString()}
        </small>
        {application.resumeFileName && <small>Résumé: {application.resumeFileName}</small>}
        <label className="status-control">
          <span>Status</span>
          <select
            aria-label={`Status for ${application.job.title} at ${application.job.company}`}
            value={application.status}
            disabled={busyId === application.id}
            onChange={(event) =>
              void updateStatus(application.id, ApplicationStatusSchema.parse(event.target.value))
            }
          >
            {statuses.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
        <a href={application.applicationUrl} target="_blank" rel="noreferrer">
          Open application page
        </a>
      </article>
    );
  }

  return (
    <section className="applications-panel">
      <div className="section-heading">
        <div>
          <h2>Application tracker</h2>
          <p className="help">Versioned job snapshots and progress stay in this browser.</p>
        </div>
        <button type="button" className="text-button" onClick={() => void loadTracker()}>
          Refresh
        </button>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice success" role="status">
          {notice}
        </div>
      )}
      {tracker && (
        <>
          <div className="tracker-summary" aria-label="Tracker summary">
            <div>
              <strong>{applications.length}</strong>
              <span>Total</span>
            </div>
            <div>
              <strong>{applications.filter((item) => item.status === "APPLIED").length}</strong>
              <span>Applied</span>
            </div>
            <div>
              <strong>
                {
                  applications.filter((item) =>
                    ["SCREEN", "INTERVIEW", "FINAL"].includes(item.status),
                  ).length
                }
              </strong>
              <span>Interviews</span>
            </div>
            <div>
              <strong>{duplicateIds.size}</strong>
              <span>Duplicates</span>
            </div>
          </div>
          <div className="tracker-transfer">
            <button type="button" className="secondary" onClick={() => void exportCsv()}>
              Export CSV
            </button>
            <label className="file-button">
              Import CSV
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => void importCsv(event)}
              />
            </label>
          </div>
          <div className="tracker-filters">
            <label>
              <span>Search</span>
              <input
                type="search"
                value={query}
                placeholder="Company, role, or location"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label>
              <span>Status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="ALL">All statuses</option>
                {statuses.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
            <label>
              <span>ATS</span>
              <select value={atsFilter} onChange={(event) => setAtsFilter(event.target.value)}>
                <option value="ALL">All ATS</option>
                {atsOptions.map((ats) => (
                  <option key={ats}>{ats}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="view-toggle" aria-label="Tracker view">
            <button type="button" aria-pressed={view === "board"} onClick={() => setView("board")}>
              Board
            </button>
            <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")}>
              Table
            </button>
          </div>
          {applications.length === 0 && <p className="empty">No applications tracked yet.</p>}
          {applications.length > 0 && filtered.length === 0 && (
            <p className="empty">No applications match these filters.</p>
          )}
          {view === "board" && filtered.length > 0 && (
            <div className="tracker-board">
              {TRACKER_COLUMNS.map((column) => {
                const items = filtered.filter((application) =>
                  column.statuses.includes(application.status),
                );
                return (
                  <section
                    className="tracker-column"
                    key={column.label}
                    aria-labelledby={`column-${column.label}`}
                  >
                    <h3 id={`column-${column.label}`}>
                      {column.label} <span>{items.length}</span>
                    </h3>
                    {items.map((application) => (
                      <ApplicationCard key={application.id} application={application} />
                    ))}
                  </section>
                );
              })}
            </div>
          )}
          {view === "table" && filtered.length > 0 && (
            <div className="tracker-table-wrap">
              <table className="tracker-table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Status</th>
                    <th>ATS</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((application) => (
                    <tr key={application.id}>
                      <td>
                        <strong>{application.job.title}</strong>
                        <span>{application.job.company}</span>
                        {duplicateIds.has(application.id) && <small>Possible duplicate</small>}
                      </td>
                      <td>
                        <select
                          aria-label={`Status for ${application.job.title} at ${application.job.company}`}
                          value={application.status}
                          disabled={busyId === application.id}
                          onChange={(event) =>
                            void updateStatus(
                              application.id,
                              ApplicationStatusSchema.parse(event.target.value),
                            )
                          }
                        >
                          {statuses.map((status) => (
                            <option key={status}>{status}</option>
                          ))}
                        </select>
                      </td>
                      <td>{application.ats}</td>
                      <td>{new Date(application.updatedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function syncOriginPattern(endpoint: string): string {
  const url = new URL(endpoint);
  return `${url.origin}/*`;
}

function saveTextFile(contents: string, fileName: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function SyncPanel() {
  const [status, setStatus] = useState<SyncAccountStatus | null>(null);
  const [devices, setDevices] = useState<SyncDevice[]>([]);
  const [mode, setMode] = useState<"register" | "login">("register");
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:8787");
  const [email, setEmail] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [deviceName, setDeviceName] = useState(navigator.platform || "Chrome browser");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function loadDevices() {
    const response = await sendPanelRequest({ type: "PANEL_SYNC_DEVICES" });
    if (!response.ok) throw new Error(response.error.message);
    setDevices(SyncDevicesResultSchema.parse(response.data).devices);
  }

  useEffect(() => {
    void sendPanelRequest({ type: "PANEL_SYNC_STATUS" })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.error.message);
        const next = SyncAccountStatusSchema.parse(response.data);
        setStatus(next);
        if (next.endpoint) setEndpoint(next.endpoint);
        if (next.email) setEmail(next.email);
        if (next.deviceName) setDeviceName(next.deviceName);
        if (next.enabled) setMode("login");
        if (next.unlocked) await loadDevices();
      })
      .catch((error: unknown) =>
        setNotice({
          kind: "error",
          message: error instanceof Error ? error.message : "Could not load sync settings.",
        }),
      );
  }, []);

  async function connect() {
    setBusy(true);
    setNotice(null);
    try {
      const granted = await chrome.permissions.request({ origins: [syncOriginPattern(endpoint)] });
      if (!granted) throw new Error("Cloud sync needs access to the selected sync server.");
      const response = await sendPanelRequest({
        type: mode === "register" ? "PANEL_SYNC_REGISTER" : "PANEL_SYNC_LOGIN",
        input: { endpoint, email, passphrase, deviceName },
      });
      if (!response.ok) throw new Error(response.error.message);
      const result = SyncRunResultSchema.parse(response.data);
      setStatus(result.status);
      setPassphrase("");
      await loadDevices();
      setNotice({
        kind: "success",
        message:
          mode === "register"
            ? "Encrypted sync is enabled and this browser's local data was backed up."
            : "Signed in and restored the encrypted cloud copy to this browser.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not enable cloud sync.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    setNotice(null);
    try {
      const response = await sendPanelRequest({ type: "PANEL_SYNC_RUN" });
      if (!response.ok) throw new Error(response.error.message);
      const result = SyncRunResultSchema.parse(response.data);
      setStatus(result.status);
      setNotice({
        kind: "success",
        message: `Sync complete: ${result.pushed.length} uploaded, ${result.pulled.length} restored, ${result.conflictsResolved.length} conflicts resolved.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Sync failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function exportBackup() {
    setBusy(true);
    setNotice(null);
    try {
      const response = await sendPanelRequest({ type: "PANEL_SYNC_EXPORT_BACKUP" });
      if (!response.ok) throw new Error(response.error.message);
      const backup = SyncBackupResultSchema.parse(response.data);
      saveTextFile(
        backup.backupJson,
        `job-copilot-encrypted-sync-${new Date().toISOString().slice(0, 10)}.json`,
        "application/json",
      );
      setNotice({ kind: "success", message: "Encrypted cloud backup downloaded." });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not export the encrypted backup.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function lock() {
    const response = await sendPanelRequest({ type: "PANEL_SYNC_LOCK" });
    if (!response.ok) {
      setNotice({ kind: "error", message: response.error.message });
      return;
    }
    setStatus(SyncAccountStatusSchema.parse(response.data));
    setDevices([]);
    setMode("login");
    setNotice({ kind: "success", message: "Sync is locked for this browser session." });
  }

  async function disable() {
    const response = await sendPanelRequest({ type: "PANEL_SYNC_DISABLE" });
    if (!response.ok) {
      setNotice({ kind: "error", message: response.error.message });
      return;
    }
    setStatus(SyncAccountStatusSchema.parse(response.data));
    setDevices([]);
    setMode("register");
    setNotice({
      kind: "success",
      message: "Sync was disabled on this browser. Local profile and tracker data were kept.",
    });
  }

  async function revoke(device: SyncDevice) {
    if (!window.confirm(`Revoke cloud access for ${device.name}?`)) return;
    setBusy(true);
    try {
      const response = await sendPanelRequest({
        type: "PANEL_SYNC_REVOKE_DEVICE",
        deviceId: device.id,
      });
      if (!response.ok) throw new Error(response.error.message);
      setDevices(SyncDevicesResultSchema.parse(response.data).devices);
      setNotice({ kind: "success", message: `${device.name} was revoked.` });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not revoke the device.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    if (
      !window.confirm(
        "Permanently delete the encrypted cloud account, every device, and all cloud backups? Local browser data will remain.",
      )
    )
      return;
    setBusy(true);
    try {
      const response = await sendPanelRequest({ type: "PANEL_SYNC_DELETE_ACCOUNT" });
      if (!response.ok) throw new Error(response.error.message);
      setStatus({ enabled: false, unlocked: false, datasets: [] });
      setDevices([]);
      setMode("register");
      setNotice({
        kind: "success",
        message: "The cloud account and encrypted server data were deleted. Local data remains.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not delete the cloud account.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <p className="empty">Loading optional sync settings…</p>;

  if (!status.enabled || !status.unlocked) {
    return (
      <section aria-labelledby="sync-title">
        <h2 id="sync-title">Optional encrypted sync</h2>
        <p className="intro">
          Local mode remains available. When enabled, the server receives encrypted profile and
          tracker snapshots, not their readable contents.
        </p>
        {notice && (
          <div
            className={`notice ${notice.kind}`}
            role={notice.kind === "error" ? "alert" : "status"}
          >
            {notice.message}
          </div>
        )}
        <div className="mode-switch" role="group" aria-label="Sync account action">
          <button
            type="button"
            className={mode === "register" ? "primary" : "secondary"}
            onClick={() => setMode("register")}
          >
            Create account
          </button>
          <button
            type="button"
            className={mode === "login" ? "primary" : "secondary"}
            onClick={() => setMode("login")}
          >
            Sign in
          </button>
        </div>
        <fieldset>
          <legend>{mode === "register" ? "Create encrypted account" : "Unlock cloud copy"}</legend>
          <label>
            Sync server
            <input
              type="url"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="https://sync.example.com"
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
            />
          </label>
          <label>
            Sync passphrase
            <input
              type="password"
              value={passphrase}
              minLength={12}
              maxLength={1024}
              onChange={(event) => setPassphrase(event.target.value)}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
            />
          </label>
          <label>
            Device name
            <input
              value={deviceName}
              maxLength={100}
              onChange={(event) => setDeviceName(event.target.value)}
            />
          </label>
          {mode === "login" && (
            <p className="warning-copy">
              Signing in restores the cloud profile and tracker on this browser. Export any local
              profile you need before continuing.
            </p>
          )}
          <button
            type="button"
            className="primary"
            disabled={busy || passphrase.length < 12 || !email || !endpoint || !deviceName}
            onClick={() => void connect()}
          >
            {busy
              ? "Connecting…"
              : mode === "register"
                ? "Enable encrypted sync"
                : "Sign in & restore"}
          </button>
        </fieldset>
        {status.enabled && (
          <button type="button" className="text-button danger" onClick={() => void disable()}>
            Forget sync settings on this browser
          </button>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby="sync-title">
      <h2 id="sync-title">Encrypted sync</h2>
      <p className="intro">
        Unlocked as {status.email}. The encryption key exists only in this browser session.
      </p>
      {notice && (
        <div
          className={`notice ${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.message}
        </div>
      )}
      <div className="sync-summary">
        <span>Server</span>
        <strong>{status.endpoint}</strong>
        <span>Last sync</span>
        <strong>
          {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : "Never"}
        </strong>
      </div>
      <button type="button" className="primary" disabled={busy} onClick={() => void syncNow()}>
        {busy ? "Working…" : "Sync now"}
      </button>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() => void exportBackup()}
      >
        Download encrypted backup
      </button>
      <button type="button" className="secondary" disabled={busy} onClick={() => void lock()}>
        Lock sync session
      </button>

      <h3 className="section-heading">Devices</h3>
      <div className="device-list">
        {devices.map((device) => (
          <article className="device-card" key={device.id}>
            <div>
              <strong>{device.name}</strong>
              <small>
                {device.current ? "This device" : device.revokedAt ? "Revoked" : "Active"}
              </small>
            </div>
            {!device.current && !device.revokedAt && (
              <button
                type="button"
                className="text-button danger"
                disabled={busy}
                onClick={() => void revoke(device)}
              >
                Revoke
              </button>
            )}
          </article>
        ))}
      </div>
      <div className="danger-zone">
        <strong>Cloud controls</strong>
        <button type="button" className="text-button" onClick={() => void disable()}>
          Disable on this browser
        </button>
        <button type="button" className="text-button danger" onClick={() => void deleteAccount()}>
          Delete cloud account
        </button>
      </div>
    </section>
  );
}

function App() {
  const [tab, setTab] = useState<Tab>("profile");
  const [vault, setVault] = useState<ProfileVault | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    void sendPanelRequest({ type: "PANEL_PROFILE_GET" })
      .then((response) => {
        if (!response.ok) throw new Error(response.error.message);
        const parsed = ProfileVaultSchema.safeParse(response.data);
        if (!parsed.success) throw new Error("The stored profile is invalid.");
        setVault(parsed.data);
      })
      .catch((error: unknown) =>
        setLoadError(error instanceof Error ? error.message : "Could not load the local profile."),
      );
  }, []);

  return (
    <main>
      <header>
        <p className="eyebrow">Local first · User controlled</p>
        <h1>Job Application Copilot</h1>
      </header>
      <nav className="tabs" aria-label="Copilot views">
        <button
          type="button"
          aria-current={tab === "profile" ? "page" : undefined}
          onClick={() => setTab("profile")}
        >
          Profile
        </button>
        <button
          type="button"
          aria-current={tab === "observe" ? "page" : undefined}
          onClick={() => setTab("observe")}
        >
          Observe
        </button>
        <button
          type="button"
          aria-current={tab === "applications" ? "page" : undefined}
          onClick={() => setTab("applications")}
        >
          Applications
        </button>
        <button
          type="button"
          aria-current={tab === "sync" ? "page" : undefined}
          onClick={() => setTab("sync")}
        >
          Sync
        </button>
      </nav>
      {tab === "profile" &&
        (loadError ? (
          <div className="notice error" role="alert">
            {loadError}
          </div>
        ) : vault ? (
          <ProfileEditor vault={vault} onVault={setVault} />
        ) : (
          <p className="empty">Loading your local profile…</p>
        ))}
      {tab === "observe" && <ObservePanel />}
      {tab === "applications" && <ApplicationsPanel />}
      {tab === "sync" && <SyncPanel />}
      {AGENT_LAB_AVAILABLE && (
        <details className="agent-lab-toggle">
          <summary>Experimental agent lab</summary>
          <AgentLab />
        </details>
      )}
      <footer>Local by default. Cloud sync runs only when you enable and unlock it.</footer>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing side panel root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
