import { PanelRequestSchema, RuntimeResponseSchema } from "@copilot/browser-command-schema";
import type { PageSnapshot } from "@copilot/form-schema";
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

import { readResumeFile } from "../resume-file";

type Tab = "profile" | "observe";
type Notice = { kind: "success" | "error"; message: string } | null;
type ScanState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; snapshot: PageSnapshot }
  | { status: "error"; message: string };

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

  async function scan() {
    setState({ status: "loading" });
    try {
      const response = await sendPanelRequest({ type: "PANEL_SCAN_ACTIVE_TAB" });
      if (!response.ok) setState({ status: "error", message: response.error.message });
      else if ("fields" in response.data) setState({ status: "success", snapshot: response.data });
      else setState({ status: "error", message: "The scan returned no form data." });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not reach the extension worker.",
      });
    }
  }

  return (
    <section className="observe-panel">
      <p className="intro">Inspect the active application page. Nothing is filled or submitted.</p>
      <button className="primary" disabled={state.status === "loading"} onClick={() => void scan()}>
        {state.status === "loading" ? "Scanning…" : "Scan visible form"}
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
            <div className="summary">
              <strong>{state.snapshot.fields.length}</strong>
              <span>inspectable fields found</span>
            </div>
            <ol className="fields">
              {state.snapshot.fields.map((field) => (
                <li key={field.fieldId}>
                  <div>
                    <strong>{field.accessibleName || "Unnamed field"}</strong>
                    <span>{field.controlKind}</span>
                  </div>
                  <span className="status">{field.required ? "Required" : "Optional"}</span>
                </li>
              ))}
            </ol>
          </>
        )}
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
