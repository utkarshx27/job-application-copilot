import type { z } from "zod";
export class PrivateRepository<T> {
  constructor(
    private readonly name: string,
    private readonly schema: z.ZodType<T>,
    private readonly empty: () => T,
    private readonly factory: IDBFactory = indexedDB,
  ) {}
  async transact(change?: (state: T) => T): Promise<T> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(this.name, 1);
      let abandoned = false;
      request.onupgradeneeded = () => request.result.createObjectStore("state");
      request.onerror = () => reject(new Error("Private storage unavailable."));
      request.onblocked = () => {
        abandoned = true;
        reject(new Error("Close older extension views."));
      };
      request.onsuccess = () => {
        if (abandoned) request.result.close();
        else resolve(request.result);
      };
    });
    return new Promise((resolve, reject) => {
      const tx = db.transaction("state", change ? "readwrite" : "readonly");
      const table = tx.objectStore("state");
      const get = table.get("value");
      let value: T;
      let error: unknown;
      get.onsuccess = () => {
        try {
          const stored: unknown = get.result;
          value = stored === undefined ? this.empty() : this.schema.parse(stored);
          if (change) {
            value = this.schema.parse(change(value));
            table.put(value, "value");
          }
        } catch (cause) {
          error = cause;
          tx.abort();
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve(value);
      };
      tx.onabort = () => {
        db.close();
        reject(error instanceof Error ? error : new Error("Private storage transaction failed."));
      };
      tx.onerror = () => {
        error ??= new Error("Private storage write failed.");
      };
    });
  }
}
