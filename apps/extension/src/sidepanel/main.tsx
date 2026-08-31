import { PanelRequestSchema, RuntimeResponseSchema } from "@copilot/browser-command-schema";
import { AiConfigStatusSchema, type AiConfigStatus } from "@copilot/ai-gateway";
import { FillResultSchema, HighlightResultSchema } from "@copilot/form-schema";
import { GroundedDraftResultSchema, type GroundedDraftResult } from "@copilot/grounded-generation";
import {
  ApplicationPageAnalysisSchema,
  ApplicationTrackerSchema,
  UploadResultSchema,
  type ApplicationPageAnalysis,
  type ApplicationTracker,
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
import { StrictMode, useEffect, useState, type ChangeEvent } from "react";
import { createRoot } from "react-dom/client";

import { readApprovedResumeFile, readResumeFile } from "../resume-file";

type Tab = "profile" | "observe" | "applications";
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
    setState({ status: "loading" });
    setActionNotice(null);
    try {
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
      setState({ status: "success", analysis: analysis.data });
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
                  Navigation is manual-only. Complete this page yourself, move forward once, then
                  rescan. The copilot never clicks Next or Submit.
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

function ApplicationsPanel() {
  const [tracker, setTracker] = useState<ApplicationTracker | null>(null);
  const [error, setError] = useState("");

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

  return (
    <section className="applications-panel">
      <div className="section-heading">
        <div>
          <h2>Application tracker</h2>
          <p className="help">Prepared and confirmed applications are stored locally.</p>
        </div>
        <button type="button" className="text-button" onClick={() => void loadTracker()}>
          Refresh
        </button>
      </div>
      {error && <div className="notice error">{error}</div>}
      {tracker?.applications.length === 0 && <p className="empty">No applications tracked yet.</p>}
      <ol className="tracker-list">
        {tracker?.applications.map((application) => (
          <li key={application.id}>
            <div>
              <strong>{application.job.title}</strong>
              <span>{application.job.company}</span>
              <small>
                {application.ats} · Profile v{application.profileVersion}
              </small>
              {application.resumeFileName && <small>Résumé: {application.resumeFileName}</small>}
              {application.workflowProgress && (
                <small>
                  Workday: {application.workflowProgress.currentPageType.replaceAll("_", " ")}
                  {application.workflowProgress.currentStepIndex &&
                  application.workflowProgress.stepCount
                    ? ` · Step ${application.workflowProgress.currentStepIndex} of ${application.workflowProgress.stepCount}`
                    : ""}
                </small>
              )}
            </div>
            <span className="status">{application.status}</span>
          </li>
        ))}
      </ol>
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
        <p className="eyebrow">Local only · User controlled</p>
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
      <footer>Profile data stays in this browser unless you export it.</footer>
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
