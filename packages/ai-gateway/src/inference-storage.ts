import {
  InferenceBudgetSchema,
  type InferenceBudget,
  type InferenceBudgetStore,
} from "./inference-budget";

// Atomic reservation across panels/workers. A crash leaves PENDING, never a free retry.
export class IndexedInferenceBudgetStore implements InferenceBudgetStore {
  private database: Promise<IDBDatabase> | undefined;
  constructor(
    private readonly factory: IDBFactory = indexedDB,
    private readonly name = "copilot-inference-v1",
  ) {}
  private open() {
    this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(this.name, 1);
      let abandoned = false;
      request.onupgradeneeded = () =>
        request.result.createObjectStore("budgets", { keyPath: "runId" });
      request.onerror = () => {
        this.database = undefined;
        reject(new Error("INFERENCE_STORAGE_UNAVAILABLE"));
      };
      request.onblocked = () => {
        abandoned = true;
        this.database = undefined;
        reject(new Error("INFERENCE_STORAGE_BLOCKED"));
      };
      request.onsuccess = () => {
        if (abandoned) {
          request.result.close();
          return;
        }
        request.result.onversionchange = () => {
          request.result.close();
          this.database = undefined;
        };
        resolve(request.result);
      };
    });
    return this.database;
  }
  async create(initial: InferenceBudget) {
    const budget = InferenceBudgetSchema.parse(initial);
    if (budget.attempts.length) throw new Error("NEW_BUDGET_MUST_BE_EMPTY");
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("budgets", "readwrite");
      tx.objectStore("budgets").add(budget);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(new Error("BUDGET_ALREADY_EXISTS_OR_STORAGE_FAILED"));
    });
    return budget;
  }
  async update(runId: string, reducer: (current: InferenceBudget) => InferenceBudget) {
    const db = await this.open();
    return new Promise<InferenceBudget>((resolve, reject) => {
      const tx = db.transaction("budgets", "readwrite");
      const store = tx.objectStore("budgets");
      const request = store.get(runId);
      let next: InferenceBudget;
      let error: unknown;
      request.onsuccess = () => {
        try {
          const prior = InferenceBudgetSchema.parse(request.result);
          next = InferenceBudgetSchema.parse(reducer(prior));
          if (next.runId !== runId) throw new Error("BUDGET_ID_CHANGED");
          if (
            next.maxCostMicros !== prior.maxCostMicros ||
            next.maxAttempts !== prior.maxAttempts ||
            next.expiresAt !== prior.expiresAt
          )
            throw new Error("BUDGET_LIMITS_IMMUTABLE");
          store.put(next);
        } catch (cause) {
          error = cause;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(next);
      tx.onabort = tx.onerror = () =>
        reject(error instanceof Error ? error : new Error("INFERENCE_STORAGE_FAILED"));
    });
  }
  async close() {
    if (this.database) (await this.database).close();
    this.database = undefined;
  }
}
