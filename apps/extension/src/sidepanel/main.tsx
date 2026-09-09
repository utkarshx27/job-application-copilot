import { ProfileVaultSchema, type ProfileVault } from "@copilot/profile-core";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentLab } from "./agent-lab";
import { AGENT_LAB_AVAILABLE } from "../agent-config";
import { sendPanelRequest } from "./panel-shared";
import { ProfileEditor } from "./profile-editor";
import { Onboarding } from "./onboarding";
import { ObservePanel } from "./observe-panel";
import { ApplicationsPanel } from "./applications-panel";
import { SyncPanel } from "./sync-panel";
import { JobsPanel } from "./jobs-panel";

type Tab = "profile" | "observe" | "applications" | "sync" | "jobs";

function App() {
  const [fullProfile, setFullProfile] = useState(false);
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
      <nav
        className={AGENT_LAB_AVAILABLE ? "tabs research-tabs" : "tabs"}
        aria-label="Copilot views"
      >
        {AGENT_LAB_AVAILABLE && (
          <button
            type="button"
            aria-current={tab === "jobs" ? "page" : undefined}
            onClick={() => setTab("jobs")}
          >
            Jobs
          </button>
        )}
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
          fullProfile ? (
            <>
              <button type="button" className="secondary" onClick={() => setFullProfile(false)}>
                Back to simple setup
              </button>
              <ProfileEditor vault={vault} onVault={setVault} />
            </>
          ) : (
            <Onboarding
              vault={vault}
              onVault={setVault}
              onAdvanced={() => setFullProfile(true)}
              onReady={() => setTab("observe")}
            />
          )
        ) : (
          <p className="empty">Loading your local profile…</p>
        ))}
      {tab === "observe" && <ObservePanel />}
      {tab === "applications" && <ApplicationsPanel />}
      {tab === "sync" && <SyncPanel />}
      {AGENT_LAB_AVAILABLE && tab === "jobs" && <JobsPanel />}
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
