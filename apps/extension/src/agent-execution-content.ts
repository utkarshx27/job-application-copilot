import { AGENT_EXECUTION_URL, type AgentBinding } from "@copilot/agent-core";
import { AGENT_LAB_AVAILABLE } from "./agent-config";
import { LocalDocumentExecutor } from "./agent-document-executor";
import { EXECUTION_PORT, ExecutionCommandSchema } from "./agent-execution-protocol";

declare global {
  interface Window {
    __copilotExecutionReconnect?: () => void;
  }
}
if (AGENT_LAB_AVAILABLE && location.href === AGENT_EXECUTION_URL && window.top === window) {
  if (window.__copilotExecutionReconnect) window.__copilotExecutionReconnect();
  else {
    let binding: AgentBinding = {
      tabId: 0,
      documentId: "unbound",
      url: AGENT_EXECUTION_URL,
      profileRevision: 0,
    };
    const executor = new LocalDocumentExecutor(document, () => binding);
    let current: chrome.runtime.Port | null = null;
    let fence = 0;
    let revoked = 0;
    const connect = () => {
      if (current) return;
      const port = chrome.runtime.connect({ name: EXECUTION_PORT });
      current = port;
      port.onDisconnect.addListener(() => {
        if (current === port) {
          current = null;
          revoked = Math.max(revoked, fence);
        }
      });
      port.onMessage.addListener((raw: unknown) => {
        const parsed = ExecutionCommandSchema.safeParse(raw);
        if (!parsed.success || current !== port || location.href !== AGENT_EXECUTION_URL) return;
        const command = parsed.data;
        void (async () => {
          try {
            let data: unknown = true;
            if (command.type === "REVOKE") revoked = Math.max(revoked, command.fence);
            else if (command.type === "OBSERVE") {
              if (command.fence <= revoked || command.fence < fence) throw new Error("STALE_LEASE");
              fence = command.fence;
              binding = command.binding;
              data = await executor.observe();
            } else {
              if (command.ticket.fence !== fence || fence <= revoked)
                throw new Error("STALE_LEASE");
              if (command.type === "DISPATCH")
                data = executor.execute(
                  command.ticket,
                  command.proposal,
                  command.fact,
                  () => command.authority,
                );
              else
                data = command.fact.file
                  ? await executor.verifyUpload(command.ticket, command.fact)
                  : executor.verify(command.ticket, command.fact);
            }
            if (current === port) port.postMessage({ id: command.id, ok: true, data });
          } catch {
            if (current === port) port.postMessage({ id: command.id, ok: false });
          }
        })();
      });
    };
    window.__copilotExecutionReconnect = connect;
    connect();
  }
}
