import {
  AgentStoreSchema,
  emptyAgentStore,
  reduceAgentStore,
  type AgentOperation,
  type AgentStore,
} from "@copilot/agent-core";

const STORE = "controller";
const KEY = "state";

// One record per controller deliberately serializes cross-panel/cross-worker updates.
// A rejected reducer or schema aborts the entire IDB transaction; corrupt data is
// surfaced to the caller rather than overwritten with an empty store.
export class AgentRepository {
  private connection: Promise<IDBDatabase> | undefined;
  constructor(
    private readonly factory: IDBFactory = indexedDB,
    private readonly name = "copilot-agent-v1",
  ) {}

  private open(): Promise<IDBDatabase> {
    this.connection ??= new Promise((resolve, reject) => {
      const request = this.factory.open(this.name, 1);
      let abandoned = false;
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onerror = () => {
        this.connection = undefined;
        reject(new Error("Could not open agent storage."));
      };
      request.onblocked = () => {
        abandoned = true;
        this.connection = undefined;
        reject(new Error("Close older extension views to upgrade agent storage."));
      };
      request.onsuccess = () => {
        const db = request.result;
        if (abandoned) {
          db.close();
          return;
        }
        db.onversionchange = () => {
          db.close();
          this.connection = undefined;
        };
        resolve(db);
      };
    });
    return this.connection;
  }

  async read(): Promise<AgentStore> {
    return this.transaction();
  }
  async dispatch(operation: AgentOperation, now = Date.now()): Promise<AgentStore> {
    return this.transaction(operation, now);
  }
  async close() {
    if (this.connection) (await this.connection).close();
    this.connection = undefined;
  }

  private async transaction(operation?: AgentOperation, now = Date.now()): Promise<AgentStore> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, operation ? "readwrite" : "readonly");
      let result: AgentStore;
      let failure: unknown;
      const objectStore = tx.objectStore(STORE);
      const get = objectStore.get(KEY);
      get.onsuccess = () => {
        try {
          const stored: unknown = get.result;
          result = stored === undefined ? emptyAgentStore() : AgentStoreSchema.parse(stored);
          if (operation) {
            result = reduceAgentStore(result, operation, now);
            objectStore.put(result, KEY);
          }
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(
          failure instanceof Error ? failure : new Error("Agent storage transaction aborted."),
        );
      tx.onerror = () => {
        failure ??= new Error("Agent storage write failed.");
      };
    });
  }
}
