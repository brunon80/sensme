import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { engine } from "./engine/engine";
import { importFiles, pickAudioFiles } from "./engine/importer";
import { lastPositionState, mediaSessionSupported, type MediaControls } from "./engine/mediaSession";
import { allRecords } from "./engine/library";
import { player } from "./engine/player";
import "../../../contracts/design-tokens/tokens.css";
import "./styles.css";

// Debug/automation seam (fidelity review, 4d): drive the import pipeline
// from the console or a headless session without native file dialogs.
// `media` is filled in by App with the Media Session transport handlers
// (media gate, ADR-017) — OS media events cannot be dispatched from JS.
declare global {
  interface Window {
    __sensme?: {
      engine: typeof engine;
      pickAudioFiles: typeof pickAudioFiles;
      importFiles: typeof importFiles;
      allRecords: typeof allRecords;
      player: typeof player;
      media?: MediaControls;
      /** Current channel grid (gates read the layout; UI_SPEC §1). */
      grid?: { entry: string; col: number; row: 0 | 1 }[];
      mediaSession: {
        supported: typeof mediaSessionSupported;
        lastPositionState: typeof lastPositionState;
      };
    };
  }
}
window.__sensme = {
  engine,
  pickAudioFiles,
  importFiles,
  allRecords,
  player,
  mediaSession: { supported: mediaSessionSupported, lastPositionState },
};

// Landscape lock (UI_SPEC §9): best-effort where the browser allows it
// (installed PWA / fullscreen on Android); the manifest declares
// orientation for installed apps, and the rotate overlay covers the rest.
// `lock` is not in the standard ScreenOrientation typings (Chromium-only).
const orientation = screen.orientation as ScreenOrientation & {
  lock?: (o: "landscape") => Promise<void>;
};
if (window.matchMedia?.("(pointer: coarse)").matches && orientation.lock) {
  const tryLock = () => void orientation.lock?.("landscape").catch(() => {});
  window.addEventListener("pointerdown", tryLock, { once: true });
}

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
