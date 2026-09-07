import {
  SyncAccountStatusSchema,
  SyncBackupResultSchema,
  SyncDevicesResultSchema,
  SyncRunResultSchema,
  type SyncAccountStatus,
  type SyncDevice,
} from "@copilot/sync-core";
import { useEffect, useState } from "react";
import { sendPanelRequest } from "./panel-shared";
import { type Notice } from "./panel-shared";

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

export function SyncPanel() {
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
