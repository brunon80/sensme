// Platform-adapted control captions (AGENTS.md §6: "Input adaptation, not
// redesign"). Desktop keyboards show real key names (SPACE, ENTER, arrows,
// ESC); touch/console platforms keep the PSP glyph vocabulary. Each caption
// is a key chip + description so buttons read distinctly from help text.
// The key bindings themselves are identical across platforms
// (interaction-model.md).

export type Platform = "desktop" | "touch";

/** Coarse pointer (touch/stick) → PSP glyphs; fine pointer → key names. */
export function detectPlatform(): Platform {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches
    ? "touch"
    : "desktop";
}

export type CaptionScreen = "boot" | "empty" | "carousel" | "nowplaying";

export interface CaptionState {
  playing: boolean;
  /** Two-step selection candidate staged (now-playing). */
  pending: boolean;
}

export interface CaptionSeg {
  /** Button/key shown as a chip. */
  key: string;
  /** What it does (plain help text). */
  desc: string;
}

/** Bottom caption strip segments for the current screen (UI_SPEC §1–§2). */
export function captionsFor(screen: CaptionScreen, state: CaptionState, platform: Platform): CaptionSeg[] {
  if (platform === "desktop") {
    switch (screen) {
      case "carousel":
        return [{ key: "Esc", desc: "Back" }, { key: "Enter", desc: "Select" }];
      case "empty":
        return [{ key: "Space", desc: "Import Music…" }];
      default:
        if (state.pending)
          return [
            { key: "Space", desc: "Confirm" },
            { key: "Esc", desc: "Cancel" },
            { key: "←", desc: "Prev" },
            { key: "→", desc: "Next" },
          ];
        return [
          { key: "Esc", desc: "Change Channels" },
          { key: "Space", desc: state.playing ? "Pause" : "Play" },
          { key: "←", desc: "Prev" },
          { key: "→", desc: "Next" },
          { key: "F", desc: "Favourites" },
        ];
    }
  }
  switch (screen) {
    case "carousel":
      return [{ key: "✕", desc: "Back" }, { key: "◯", desc: "Select" }];
    case "empty":
      return [{ key: "◯", desc: "Import Music…" }];
    default:
      if (state.pending)
        return [
          { key: "START", desc: "Confirm" },
          { key: "✕", desc: "Cancel" },
          { key: "L", desc: "Prev" },
          { key: "R", desc: "Next" },
        ];
      return [
        { key: "SELECT", desc: "Change Channels" },
        { key: "START", desc: state.playing ? "Pause" : "Play" },
        { key: "L", desc: "Prev" },
        { key: "R", desc: "Next" },
        { key: "♥", desc: "Favourites" },
      ];
  }
}
