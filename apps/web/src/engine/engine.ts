// Main-thread handle to the analysis worker.
import type { Classification, ContractMeta, FeatureVector } from "./types";

interface Pending {
  resolve: (v: { featureVector: FeatureVector; classification: Classification }) => void;
  reject: (e: Error) => void;
}

class Engine {
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private nextId = 0;
  private meta: ContractMeta | null = null;
  readonly ready: Promise<ContractMeta>;

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.ready = new Promise<ContractMeta>((resolve) => {
      this.worker.onmessage = (e: MessageEvent) => {
        const m = e.data as { type: string; id?: number; meta?: ContractMeta;
          result?: { featureVector: FeatureVector; classification: Classification };
          message?: string };
        if (m.type === "ready" && m.meta) {
          this.meta = m.meta;
          resolve(m.meta);
          return;
        }
        if (m.id === undefined) return;
        const cb = this.pending.get(m.id);
        if (!cb) return;
        this.pending.delete(m.id);
        if (m.type === "analyzed" && m.result) cb.resolve(m.result);
        else cb.reject(new Error(m.message ?? "analysis failed"));
      };
    });
    this.worker.postMessage({ type: "init" });
  }

  /** Decode + analyze + classify one file's bytes (deterministic, wasm). */
  analyze(label: string, bytes: Uint8Array): Promise<{
    featureVector: FeatureVector;
    classification: Classification;
  }> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: "analyze", id, label, bytes });
    });
  }

  contract(): ContractMeta | null {
    return this.meta;
  }
}

export const engine = new Engine();
