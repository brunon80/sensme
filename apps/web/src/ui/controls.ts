// Platform-adapted control captions (AGENTS.md §6: "Input adaptation, not
// redesign"). Desktop keyboards show real key names (SPACE, ENTER, arrows,
// ESC); touch/console platforms keep the PSP glyph vocabulary. The key
// bindings themselves are identical across platforms (interaction-model.md).

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

/** Bottom caption strip text for the current screen (UI_SPEC §1–§2). */
export function captionFor(screen: CaptionScreen, state: CaptionState, platform: Platform): string {
  if (platform === "desktop") {
    switch (screen) {
      case "carousel":
        return "Esc Back    Enter Select";
      case "empty":
        return "Space Import Music…    C";
      default:
        if (state.pending) return "Space/Enter Confirm · Esc Cancel · ← Prev · Next →";
        return state.playing
          ? "Enter Change Channels · Space Pause · ← Prev · Next → · F Favourites"
          : "Enter Change Channels · Space Play · ← Prev · Next → · F Favourites";
    }
  }
  switch (screen) {
    case "carousel":
      return "✕ Back    ◯ Select";
    case "empty":
      return "◯ Import Music…    C";
    default:
      if (state.pending) return "START/◯ Confirm · ✕ Cancel · L ◀ Prev · R Next ▶";
      return state.playing
        ? "SELECT Change Channels · START Pause · L ◀ Prev · R Next ▶ · ♥ Favourites"
        : "SELECT Change Channels · START Play · L ◀ Prev · R Next ▶ · ♥ Favourites";
  }
}
