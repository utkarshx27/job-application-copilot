import { AiConfigStatusSchema, type AiConfigStatus } from "@copilot/ai-gateway";
import { FillResultSchema, HighlightResultSchema } from "@copilot/form-schema";
import { GroundedDraftResultSchema, type GroundedDraftResult } from "@copilot/grounded-generation";
import {
  ApplicationPageAnalysisSchema,
  UploadResultSchema,
  type ApplicationPageAnalysis,
  type ApprovedUploadFile,
  type CustomQuestion,
} from "@copilot/job-schema";
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
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { readApprovedResumeFile } from "../resume-file";
import { ensureActiveSiteAccess } from "../site-access";
import { type Notice, sendPanelRequest } from "./panel-shared";
import { AGENT_LAB_AVAILABLE } from "../agent-config";
import { TeachField } from "./correction-memory";

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

export function ObservePanel() {
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
                    {AGENT_LAB_AVAILABLE &&
                      new URL(state.analysis.snapshot.url).origin === "http://127.0.0.1:4173" && (
                        <TeachField
                          analysisId={state.analysis.analysisId}
                          fieldId={mapping.fieldId}
                          label={label}
                          onSaved={scan}
                        />
                      )}
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
