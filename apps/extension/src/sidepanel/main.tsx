import { PanelRequestSchema, RuntimeResponseSchema } from "@copilot/browser-command-schema";
import type { PageSnapshot } from "@copilot/form-schema";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

type ViewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; snapshot: PageSnapshot }
  | { status: "error"; message: string };

function App() {
  const [state, setState] = useState<ViewState>({ status: "idle" });

  async function scan() {
    setState({ status: "loading" });
    const request = PanelRequestSchema.parse({ type: "PANEL_SCAN_ACTIVE_TAB" });

    try {
      const untrustedResponse: unknown = await chrome.runtime.sendMessage(request);
      const response = RuntimeResponseSchema.parse(untrustedResponse);
      if (!response.ok) {
        setState({ status: "error", message: response.error.message });
      } else if ("fields" in response.data) {
        setState({ status: "success", snapshot: response.data });
      } else {
        setState({ status: "error", message: "The scan returned no form data." });
      }
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not reach the extension worker.",
      });
    }
  }

  return (
    <main>
      <header>
        <p className="eyebrow">Local Only · Observe Mode</p>
        <h1>Job Application Copilot</h1>
        <p className="intro">
          Inspect the active application page. Nothing is filled or submitted.
        </p>
      </header>

      <button className="primary" disabled={state.status === "loading"} onClick={() => void scan()}>
        {state.status === "loading" ? "Scanning…" : "Scan visible form"}
      </button>

      <section aria-live="polite" aria-busy={state.status === "loading"}>
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
      </section>

      <footer>Passwords and hidden controls are never included.</footer>
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
