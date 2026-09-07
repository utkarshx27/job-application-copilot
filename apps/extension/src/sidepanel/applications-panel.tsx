import {
  ApplicationStatusSchema,
  ApplicationTrackerSchema,
  TrackerCsvExportSchema,
  TrackerCsvImportResultSchema,
  type ApplicationTracker,
  type ApplicationRecord,
  type ApplicationStatus,
} from "@copilot/job-schema";
import { useEffect, useState, type ChangeEvent } from "react";
import { sendPanelRequest } from "./panel-shared";

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

export function ApplicationsPanel() {
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
