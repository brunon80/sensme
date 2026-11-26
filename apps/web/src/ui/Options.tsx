// Options menu (UI_SPEC §3): scrim + right panel, items per R-2.
import { useState } from "react";

export interface Settings {
  showClock: boolean;
  showCaptions: boolean;
}

interface Props {
  settings: Settings;
  onSettings: (s: Settings) => void;
  onClearFavourites: () => void;
  onClearBlocked: () => void;
  onRebuild: () => void;
  onWipe: () => void;
  onImport: () => void;
  meta: { algorithmVersion: string; featureVectorVersion: number; axisWeightsVersion: string; channelWeightsVersion: string; pspAlgorithmVersion?: string } | null;
  onClose: () => void;
}

type Page = "root" | "view" | "sound" | "database" | "help" | "about";

export function Options({ settings, onSettings, onClearFavourites, onClearBlocked, onRebuild, onWipe, onImport, meta, onClose }: Props) {
  const [page, setPage] = useState<Page>("root");
  const [soundFx, setSoundFx] = useState(true);
  const [normalizer, setNormalizer] = useState(true);

  const item = (label: string, action: () => void, note?: string) => (
    <button key={label} className="menu-item" onClick={action}>
      {label}
      {note && <span className="menu-note">{note}</span>}
    </button>
  );

  return (
    <div className="menu-scrim" onClick={onClose}>
      <div className="menu-panel" onClick={(e) => e.stopPropagation()}>
        {page === "root" && (
          <>
            {item("View Settings", () => setPage("view"))}
            {item("Sound Settings", () => setPage("sound"))}
            {item("Music Scan", onImport, "add new music")}
            {item("Favourites Setting", onClearFavourites, "delete all")}
            {item("Block List Settings", onClearBlocked, "delete all")}
            {item("Database Settings", () => setPage("database"), "rebuild / wipe")}
            {item("Help", () => setPage("help"))}
            {item("Check for Updates", () => undefined, "offline")}
            {item("About SensMe channels", () => setPage("about"))}
          </>
        )}
        {page === "view" && (
          <>
            {item(`Time and Battery: ${settings.showClock ? "ON" : "OFF"}`,
              () => onSettings({ ...settings, showClock: !settings.showClock }))}
            {item(`Button Caption: ${settings.showCaptions ? "ON" : "OFF"}`,
              () => onSettings({ ...settings, showCaptions: !settings.showCaptions }))}
            {item("Back", () => setPage("root"))}
          </>
        )}
        {page === "sound" && (
          <>
            {item(`Dynamic Normalizer: ${normalizer ? "ON" : "OFF"}`, () => setNormalizer(!normalizer))}
            {item(`Sound Effects: ${soundFx ? "ON" : "OFF"}`, () => setSoundFx(!soundFx))}
            {item("Back", () => setPage("root"))}
          </>
        )}
        {page === "database" && (
          <>
            {item("Clear and Rebuild", onRebuild, "re-analyze all music")}
            {item("Delete All Music", onWipe, "remove everything")}
            {item("Back", () => setPage("root"))}
          </>
        )}
        {page === "help" && (
          <div className="menu-text">
            ← → change channel · ◯/Enter select · ✕/Esc back · START/Space play or
            pause · , . previous/next · ↑/F add to Favourites · ↓/⇧F remove ·
            △/O options. Channels with no tracks cannot be selected. A track may
            belong to several channels.
            {item("Back", () => setPage("root"))}
          </div>
        )}
        {page === "about" && (
          <div className="menu-text">
            SensMe — an independent, offline reimplementation inspired by Sony's
            SensMe channels. Not affiliated with Sony.
            <br />
            algorithm {meta?.pspAlgorithmVersion ?? meta?.algorithmVersion} · features v{meta?.featureVectorVersion} ·
            weights {meta?.axisWeightsVersion}
            {item("Back", () => setPage("root"))}
          </div>
        )}
        <div className="menu-caption">✕ Select&nbsp;&nbsp;&nbsp;◯ Close</div>
      </div>
    </div>
  );
}
