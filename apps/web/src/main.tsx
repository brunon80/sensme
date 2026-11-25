import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { engine } from "./engine/engine";
import { importFiles, pickAudioFiles } from "./engine/importer";
import { allRecords } from "./engine/library";
import { player } from "./engine/player";
import "../../../contracts/design-tokens/tokens.css";
import "./styles.css";

// Debug/automation seam (fidelity review, 4d): drive the import pipeline
// from the console or a headless session without native file dialogs.
declare global {
  interface Window {
    __sensme?: { engine: typeof engine; pickAudioFiles: typeof pickAudioFiles; importFiles: typeof importFiles; allRecords: typeof allRecords; player: typeof player };
  }
}
window.__sensme = { engine, pickAudioFiles, importFiles, allRecords, player };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// PWA: register the service worker in production builds only (dev keeps
// plain reloads). Relative URL works under the Pages project path.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js").catch(() => {
      // Offline capability is progressive enhancement; ignore failures.
    });
  });
}
