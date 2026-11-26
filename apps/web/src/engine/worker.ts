// Analysis worker: hosts the sensme-wasm core off the main thread so the
// PSP-style UI stays at 60 fps while channels update (UI_SPEC §4).
import init, { analyze_and_classify, psp_analyze_and_classify, contract_meta } from "sensme-wasm";
import wasmUrl from "sensme-wasm/sensme_wasm_bg.wasm?url";

type Req =
  | { type: "init" }
  | { type: "analyze"; id: number; label: string; bytes: Uint8Array; psp?: boolean };

let ready = false;

async function ensureReady(): Promise<void> {
  if (!ready) {
    await init({ module_or_path: wasmUrl });
    ready = true;
  }
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const msg = e.data;
  if (msg.type === "init") {
    await ensureReady();
    postMessage({ type: "ready", meta: contract_meta() });
    return;
  }
  if (msg.type === "analyze") {
    try {
      await ensureReady();
      // The faithful PSP engine is the core analyzer (psp flag defaults to
      // true); the v1 feature/classify path stays available for tooling.
      const result = msg.psp === false
        ? analyze_and_classify(msg.label, msg.bytes)
        : psp_analyze_and_classify(msg.label, msg.bytes);
      postMessage({ type: "analyzed", id: msg.id, result });
    } catch (err) {
      postMessage({ type: "error", id: msg.id, message: String(err) });
    }
  }
};
