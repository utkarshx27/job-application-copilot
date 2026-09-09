import { useEffect, useState } from "react";
import { DiscoveryViewSchema } from "@copilot/agent-core";
import type { z } from "zod";
import { sendPanelRequest } from "./panel-shared";
export function JobsPanel() {
  const [view, setView] = useState<z.infer<typeof DiscoveryViewSchema> | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showDismissed, setShowDismissed] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    company: "",
    location: "",
    url: "",
    description: "",
  });
  async function request(input: Parameters<typeof sendPanelRequest>[0]) {
    setBusy(true);
    setMessage("");
    try {
      const response = await sendPanelRequest(input);
      if (!response.ok) throw new Error(response.error.message);
      setView(DiscoveryViewSchema.parse(response.data));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Jobs unavailable.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void request({ type: "PANEL_JOBS_GET" });
  }, []);
  return (
    <section className="jobs-research" aria-label="Jobs research">
      <h2>Find and review jobs</h2>
      <p>
        Search the synthetic local catalog or paste a listing. Scores explain matches to your saved
        role and location preferences. Imported listings open for manual review; their availability
        is unverified.
      </p>
      <label>
        Search local catalog
        <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={200} />
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={() => void request({ type: "PANEL_JOBS_SEARCH", query })}
      >
        Search demo jobs
      </button>
      <button
        type="button"
        disabled={!busy}
        onClick={() => {
          void sendPanelRequest({ type: "PANEL_JOBS_CANCEL" }).catch(() =>
            setMessage("Could not cancel the search. Refresh its status."),
          );
        }}
      >
        Cancel search
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void request({ type: "PANEL_JOBS_GET" })}
      >
        Refresh preferences and jobs
      </button>
      {message && <p role="alert">{message}</p>}
      {view && (
        <p>
          {view.remainingReads} local catalog reads remaining today · {view.sourceStatus}
        </p>
      )}
      <details>
        <summary>Paste a job listing</summary>
        {(
          [
            ["title", "Job title"],
            ["company", "Company"],
            ["location", "Job location"],
            ["url", "Listing URL"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              value={draft[key]}
              onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
            />
          </label>
        ))}
        <label>
          Job description
          <textarea
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </label>
        <button
          type="button"
          disabled={busy || !draft.title || !draft.company || !draft.url}
          onClick={() => void request({ type: "PANEL_JOBS_IMPORT", ...draft })}
        >
          Import listing
        </button>
      </details>
      <label>
        <input
          type="checkbox"
          checked={showDismissed}
          onChange={(event) => setShowDismissed(event.target.checked)}
        />
        Show dismissed and excluded jobs
      </label>
      <p>
        {view?.jobs.filter((entry) => !entry.dismissed && !entry.excluded).length ?? 0} shortlisted
        jobs
      </p>
      {view?.jobs
        .filter((entry) => showDismissed || (!entry.dismissed && !entry.excluded))
        .map((entry) => (
          <article
            key={entry.job.id}
            aria-label={`${entry.job.title} at ${entry.job.company} in ${entry.job.location}`}
          >
            <h3>{entry.job.title}</h3>
            <p>
              {entry.job.company} · {entry.job.location} ·{" "}
              {entry.job.source === "LOCAL_TEST_ATS" ? "Synthetic demo" : "Imported listing"}
            </p>
            <p>
              Preference match: {entry.score}/100 · {entry.job.availability}
              {entry.stale ? " · Needs fresh availability check" : ""}
            </p>
            <ul>
              {entry.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            {entry.job.salary && (
              <p>
                Listed pay: {entry.job.salary.amount} {entry.job.salary.currency} /{" "}
                {entry.job.salary.period}
              </p>
            )}
            {entry.job.applicationUrl &&
              entry.job.availability !== "EXPIRED" &&
              !entry.excluded && (
                <a href={entry.job.applicationUrl} target="_blank" rel="noreferrer">
                  {entry.job.source === "LOCAL_TEST_ATS"
                    ? "Open application demo"
                    : "Review imported listing"}
                </a>
              )}
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void request({
                  type: "PANEL_JOBS_DISMISS",
                  id: entry.job.id,
                  dismissed: !entry.dismissed,
                })
              }
            >
              {entry.dismissed ? "Restore job" : "Dismiss job"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void request({ type: "PANEL_JOBS_FORGET", id: entry.job.id })}
            >
              Forget listing
            </button>
            <h4>Company evidence</h4>
            {entry.job.source === "IMPORT" && (
              <p>
                Manually entered source claims, not independently verified. Evidence is shared only
                with listings for this exact stored employer and location.
              </p>
            )}
            {entry.evidence.status === "UNAVAILABLE" ? (
              <p>Company evidence unavailable for this employer identity.</p>
            ) : (
              entry.evidence.ratings.map((rating, index) => (
                <p key={index}>
                  <a href={rating.sourceUrl} target="_blank" rel="noreferrer">
                    {rating.source}
                  </a>
                  :{" "}
                  {rating.value === null ? "Rating unavailable" : `${rating.value}/${rating.scale}`}{" "}
                  · {rating.count} reviews · {rating.retrievedAt}
                  {rating.stale ? " · Stale source" : ""}
                  {rating.smallSample ? " · Small sample" : ""}
                </p>
              ))
            )}
            {entry.job.source === "IMPORT" && (
              <CompanyEvidenceInput jobId={entry.job.id} busy={busy} request={request} />
            )}
            <details>
              <summary>Listing sources</summary>
              {entry.job.provenance.map((url) => (
                <p key={url}>
                  <a href={url} target="_blank" rel="noreferrer">
                    {url}
                  </a>
                </p>
              ))}
            </details>
          </article>
        ))}
    </section>
  );
}

function CompanyEvidenceInput({
  jobId,
  busy,
  request,
}: {
  jobId: string;
  busy: boolean;
  request: (input: Parameters<typeof sendPanelRequest>[0]) => Promise<void>;
}) {
  const [source, setSource] = useState("");
  const [url, setUrl] = useState("");
  const [value, setValue] = useState("");
  const [scale, setScale] = useState("5");
  const [count, setCount] = useState("");
  const [date, setDate] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  return (
    <details>
      <summary>Add or remove company evidence</summary>
      <p>
        Copy only public rating metadata from a source you can access. Do not paste review text or
        personal information. Saving the same source URL replaces its previous rating.
      </p>
      <label>
        Rating source name
        <input value={source} onChange={(event) => setSource(event.target.value)} maxLength={300} />
      </label>
      <label>
        Rating source URL
        <input type="url" value={url} onChange={(event) => setUrl(event.target.value)} />
      </label>
      <label>
        Rating value
        <input
          type="number"
          min="0"
          step="any"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <label>
        Rating scale
        <input
          type="number"
          min="1"
          max="100"
          step="any"
          value={scale}
          onChange={(event) => setScale(event.target.value)}
        />
      </label>
      <label>
        Review count
        <input
          type="number"
          min="0"
          step="1"
          value={count}
          onChange={(event) => setCount(event.target.value)}
        />
      </label>
      <label>
        Source retrieval date
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </label>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        I checked this source refers to this employer and location
      </label>
      <button
        type="button"
        disabled={
          busy || !confirmed || !source || !url || !date || value === "" || count === "" || !scale
        }
        onClick={() =>
          void request({
            type: "PANEL_JOBS_EVIDENCE",
            id: jobId,
            rating: {
              source,
              sourceUrl: url,
              value: Number(value),
              scale: Number(scale),
              count: Number(count),
              retrievedAt: date,
            },
            confirmed: true,
          })
        }
      >
        Save sourced rating
      </button>
      <p>
        Forgetting evidence removes it from every listing for this stored employer and location. It
        cannot be undone.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void request({ type: "PANEL_JOBS_FORGET_EVIDENCE", id: jobId })}
      >
        Forget company evidence
      </button>
    </details>
  );
}
