import { AGENT_EXECUTION_URL } from "@copilot/agent-core";
import { z } from "zod";
import {
  EXECUTION_PORT,
  ExecutionCommandSchema,
  type ExecutionCommand,
} from "./agent-execution-protocol";

type Connection = {
  port: chrome.runtime.Port;
  documentId: string;
  pending: Map<string, { resolve: (data: unknown) => void; reject: (error: Error) => void }>;
};
export class ExecutionTransport {
  private readonly connections = new Map<number, Connection>();
  constructor(private readonly available: boolean) {
    chrome.runtime.onConnect.addListener((port) => {
      const sender = port.sender;
      if (port.name !== EXECUTION_PORT) return;
      if (
        !available ||
        sender?.id !== chrome.runtime.id ||
        sender.url !== AGENT_EXECUTION_URL ||
        sender.frameId !== 0 ||
        sender.tab?.id === undefined ||
        !sender.documentId
      ) {
        port.disconnect();
        return;
      }
      const tabId = sender.tab.id;
      this.connections.get(tabId)?.port.disconnect();
      const connection: Connection = { port, documentId: sender.documentId, pending: new Map() };
      this.connections.set(tabId, connection);
      port.onMessage.addListener((raw: unknown) => {
        const response = z
          .object({ id: z.uuid(), ok: z.boolean(), data: z.unknown().optional() })
          .strict()
          .safeParse(raw);
        if (!response.success || this.connections.get(tabId) !== connection) return;
        const pending = connection.pending.get(response.data.id);
        connection.pending.delete(response.data.id);
        if (response.data.ok) pending?.resolve(response.data.data);
        else pending?.reject(new Error("DOCUMENT_REJECTED_ACTION"));
      });
      port.onDisconnect.addListener(() => {
        if (this.connections.get(tabId) === connection) this.connections.delete(tabId);
        for (const pending of connection.pending.values())
          pending.reject(new Error("DOCUMENT_DISCONNECTED"));
        connection.pending.clear();
      });
    });
  }
  async connect(tabId: number) {
    if (!this.available || (await chrome.tabs.get(tabId)).url !== AGENT_EXECUTION_URL)
      throw new Error("LOCAL_EXECUTION_PAGE_REQUIRED");
    if (!this.connections.has(tabId)) {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        world: "ISOLATED",
        files: ["agent-execution.js"],
      });
      for (let i = 0; i < 50 && !this.connections.has(tabId); i++)
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const connection = this.connections.get(tabId);
    if (!connection) throw new Error("EXECUTOR_UNAVAILABLE");
    return connection.documentId;
  }
  request(tabId: number, input: ExecutionCommand): Promise<unknown> {
    const command = ExecutionCommandSchema.parse(input);
    const connection = this.connections.get(tabId);
    if (!connection) return Promise.reject(new Error("DOCUMENT_DISCONNECTED"));
    if ("ticket" in command && command.ticket.binding.documentId !== connection.documentId)
      return Promise.reject(new Error("DOCUMENT_CHANGED"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        connection.pending.delete(command.id);
        reject(new Error("DOCUMENT_TIMEOUT"));
      }, 4000);
      connection.pending.set(command.id, {
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      try {
        connection.port.postMessage(command);
      } catch {
        clearTimeout(timer);
        connection.pending.delete(command.id);
        reject(new Error("DOCUMENT_DISCONNECTED"));
      }
    });
  }
  async revoke(tabId: number, fence: number) {
    if (this.connections.has(tabId))
      await this.request(tabId, { type: "REVOKE", id: crypto.randomUUID(), fence });
  }
}
