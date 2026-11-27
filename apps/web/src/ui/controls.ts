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
  /** Current track is a favourite (now-playing): the favourite chip
   * becomes a toggle showing the action the press performs
   * ("Unfavourite"); the caption row crossfades on the change (PSP
   * reference IMG_7534.MOV 2026-11-27). */
  favourite: boolean;
}

export interface CaptionSeg {
  /** Button/key shown as a chip. */
  key: string;
  /** What it does (plain help text). */
  desc: string;
  /** Action fired when the chip is tapped (touch platforms render chips
   * as buttons; UI_SPEC §9). */
  action: ActionId;
}

/** Shared action vocabulary: every keyboard binding, caption button and
 * touch gesture resolves to one of these (App's action dispatcher). */
export type ActionId =
  | "back"
  | "select"
  | "play"
  | "prev"
  | "next"
  | "colLeft"
  | "colRight"
  | "rowUp"
  | "rowDown"
  | "add"
  | "menu"
  | "favourite"
  | "change";

/** Bottom caption strip segments for the current screen (UI_SPEC §1–§2). */
export function captionsFor(screen: CaptionScreen, state: CaptionState, platform: Platform): CaptionSeg[] {
  if (platform === "desktop") {
    switch (screen) {
      case "carousel":
        return [{ key: "Esc", desc: "Back", action: "back" }, { key: "Enter", desc: "Select", action: "select" }];
      case "empty":
        return [{ key: "Space", desc: "Import Music…", action: "play" }];
      default:
        if (state.pending)
          return [
            { key: "Space", desc: "Confirm", action: "play" },
            { key: "Esc", desc: "Cancel", action: "back" },
            { key: "←", desc: "Prev", action: "prev" },
            { key: "→", desc: "Next", action: "next" },
          ];
        return [
          { key: "Esc", desc: "Change Channels", action: "change" },
          { key: "Space", desc: state.playing ? "Pause" : "Play", action: "play" },
          { key: "←", desc: "Prev", action: "prev" },
          { key: "→", desc: "Next", action: "next" },
          // Toggle chip: the description reflects the action the press
          // performs (PSP-faithful state-aware caption).
          state.favourite
            ? { key: "F", desc: "Unfavourite", action: "favourite" }
            : { key: "F", desc: "Favourite", action: "favourite" },
          { key: "C", desc: "Add Music", action: "add" },
          { key: "O", desc: "Options", action: "menu" },
        ];
    }
  }
  switch (screen) {
    case "carousel":
      return [
        { key: "✕", desc: "Back", action: "back" },
        { key: "◯", desc: "Select", action: "select" },
      ];
    case "empty":
      return [{ key: "◯", desc: "Import Music…", action: "play" }];
    default:
      if (state.pending)
        return [
          { key: "START", desc: "Confirm", action: "play" },
          { key: "✕", desc: "Cancel", action: "back" },
          { key: "L", desc: "Prev", action: "prev" },
          { key: "R", desc: "Next", action: "next" },
        ];
      return [
        { key: "SELECT", desc: "Change Channels", action: "change" },
        { key: "START", desc: state.playing ? "Pause" : "Play", action: "play" },
        { key: "L", desc: "Prev", action: "prev" },
        { key: "R", desc: "Next", action: "next" },
        state.favourite
          ? { key: "♥", desc: "Unfavourite", action: "favourite" }
          : { key: "♥", desc: "Favourite", action: "favourite" },
        { key: "OPTIONS", desc: "Add Music", action: "add" },
        { key: "⚙", desc: "Settings", action: "menu" },
      ];
  }
}
