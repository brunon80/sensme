// Options menu (UI_SPEC §3): scrim + right panel, items per R-2.
import { useState } from "react";

export interface Settings {
  showClock: boolean;
  showCaptions: boolean;
  /** PSP Sound Settings → Dynamic Normalizer (default ON, per the original's
   * MenuParam8_DefaultCheck=1). Normalizes playback loudness per track. */
  dynamicNormalizer: boolean;
  /** View Settings → All Day Channels (default OFF): OFF shows only the
   * time-of-day channel matching the clock; ON restores all five. */
  allDayChannels: boolean;
}

interface Props {
  settings: Settings;
  onSettings: (s: Settings) => void;
  onClearFavourites: () => void;
  onClearBlocked: () => void;
  onRebuild: () => void;
  onEnrich: () => void;
  onWipe: () => void;
  onImport: () => void;
  meta: { algorithmVersion: string; featureVectorVersion: number; axisWeightsVersion: string; channelWeightsVersion: string; pspAlgorithmVersion?: string } | null;
  onClose: () => void;
}

type Page = "root" | "view" | "sound" | "database" | "help" | "about";

export function Options({ settings, onSettings, onClearFavourites, onClearBlocked, onRebuild, onEnrich, onWipe, onImport, meta, onClose }: Props) {
  const [page, setPage] = useState<Page>("root");

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
            {item("Metadata Lookup", onEnrich, "fill missing tags")}
            {item("Favourites Setting", onClearFavourites, "delete all")}
            {item("Block List Settings", onClearBlocked, "delete all")}
            {item("Database Settings", () => setPage("database"), "rebuild / wipe")}
            {item("Help", () => setPage("help"))}
            {item("About Moodwave channels", () => setPage("about"))}
          </>
        )}
        {page === "view" && (
          <>
            {item(`Time and Battery: ${settings.showClock ? "ON" : "OFF"}`,
              () => onSettings({ ...settings, showClock: !settings.showClock }))}
            {item(`Button Caption: ${settings.showCaptions ? "ON" : "OFF"}`,
              () => onSettings({ ...settings, showCaptions: !settings.showCaptions }))}
            {item(`All Day Channels: ${settings.allDayChannels ? "ON" : "OFF"}`,
              () => onSettings({ ...settings, allDayChannels: !settings.allDayChannels }))}
            {item("Back", () => setPage("root"))}
          </>
        )}
        {page === "sound" && (
          <>
            {item(`Dynamic Normalizer: ${settings.dynamicNormalizer ? "ON" : "OFF"}`,
              () => onSettings({ ...settings, dynamicNormalizer: !settings.dynamicNormalizer }))}
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
            Moodwave — an independent, offline reimplementation inspired by
            Sony's SensMe channels. Not affiliated with, or endorsed by, Sony.
            <br />
            The music analysis algorithm and the Dynamic Normalizer were
            reverse-engineered from the original PSP SensMe Channels
            application (NPIA00013) for interoperability — reverse engineering
            for that purpose is legal. No Sony code, assets, or services are
            used.
            <br />
            algorithm {meta?.pspAlgorithmVersion ?? meta?.algorithmVersion} · features v{meta?.featureVectorVersion} ·
            weights {meta?.axisWeightsVersion}
            {item("Back", () => setPage("root"))}
          </div>
        )}
      </div>
    </div>
  );
}
