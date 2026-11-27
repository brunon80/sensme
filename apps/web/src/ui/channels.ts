// Channel entries for the carousel: 13 classifier channels + 3 utility
// channels (docs/UI_REFERENCES/interaction-model.md).
import { tokens } from "../../../../contracts/design-tokens/tokens";
import type { Channel, LibraryRecord } from "../engine/types";
import { memberChannels, topChannel } from "../engine/types";

export type UtilityChannel = "shuffle" | "favourites" | "newly";
export type CarouselEntry = Channel | UtilityChannel;

/** Time-of-day channels, chronological. Only the one matching the clock is
 * shown by default (UI_SPEC §1); the View Settings option restores all. */
export const TOD_CHANNELS: Channel[] = ["morning", "daytime", "evening", "night", "midnight"];

/** Active time-of-day channel for an hour (0–23). Boundaries as in the
 * original SensMe Channels: Morning 05:00–09:59, Daytime 10:00–15:59,
 * Evening 16:00–18:59, Night 19:00–23:59, Midnight 00:00–04:59. */
export function todForHour(hour: number): Channel {
  if (hour >= 5 && hour < 10) return "morning";
  if (hour >= 10 && hour < 16) return "daytime";
  if (hour >= 16 && hour < 19) return "evening";
  if (hour >= 19) return "night";
  return "midnight";
}

/** One card in the channel grid: column-major flat order (bottom cell then
 * top cell per column), so ←/→ move ±1 column and ↑/↓ toggle the row. */
export interface GridCell {
  entry: CarouselEntry;
  col: number;
  row: 0 | 1; // 0 = bottom, 1 = top
}

/** The channel grid (UI_SPEC §1). Top row: the current time-of-day channel
 * (or all five when View Settings → All Day Channels is ON), then
 * Energetic, Mellow, Emotional, Dance, Favourites. Bottom row: Shuffle,
 * Relax, Upbeat, Lounge, Extreme, Newly Added. */
export function carouselGrid(allDayChannels: boolean, hour: number): GridCell[] {
  const top: CarouselEntry[] = [
    ...(allDayChannels ? TOD_CHANNELS : [todForHour(hour)]),
    "energetic", "mellow", "emotional", "dance", "favourites",
  ];
  const bottom: CarouselEntry[] = ["shuffle", "relax", "upbeat", "lounge", "extreme", "newly"];
  const cells: GridCell[] = [];
  for (let c = 0; c < Math.max(top.length, bottom.length); c++) {
    if (c < bottom.length) cells.push({ entry: bottom[c]!, col: c, row: 0 });
    if (c < top.length) cells.push({ entry: top[c]!, col: c, row: 1 });
  }
  return cells;
}

export function entryName(e: CarouselEntry): string {
  switch (e) {
    case "shuffle": return "Shuffle All";
    case "favourites": return "Favourites";
    case "newly": return "Newly Added";
    default: return e.charAt(0).toUpperCase() + e.slice(1);
  }
}

/** Backdrop hues for an entry (clean-room channel identity, UI_SPEC §6). */
export function entryHues(e: CarouselEntry): readonly string[] {
  if (e === "shuffle") return tokens.color.dotPalette.slice(0, 5);
  if (e === "favourites") return ["#6FA8F0", "#9A8CF5", "#C7D8FF"];
  if (e === "newly") return ["#B8D25E", "#7CC96F", "#E8D26A"];
  return tokens.color.channelHues[e];
}

/** Tracks belonging to a carousel entry, in play order (unshuffled). */
export function entryTracks(e: CarouselEntry, records: LibraryRecord[]): LibraryRecord[] {
  switch (e) {
    case "shuffle":
      return records.filter((r) => !r.blocked);
    case "favourites":
      return records.filter((r) => r.favourite);
    case "newly":
      return [...records]
        .filter((r) => !r.blocked)
        .sort((a, b) => b.addedEpoch - a.addedEpoch)
        .slice(0, 20);
    default:
      return records.filter((r) => !r.blocked && memberChannels(r).includes(e));
  }
}

/** Deterministic per-selection shuffle (R-2: "each channel selection varies
 * the play order"): Fisher–Yates seeded by entry + selection counter. */
export function shuffledQueue(entry: CarouselEntry, selection: number, records: LibraryRecord[]): LibraryRecord[] {
  const out = entryTracks(entry, records);
  let seed = (hash(entry) ^ (selection * 0x9e3779b1)) >>> 0;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The dot-grid shown on now-playing (channel membership indicators). */
export function membershipDots(rec: LibraryRecord): { channel: Channel; on: boolean }[] {
  const on = new Set(memberChannels(rec));
  return (Object.keys(tokens.color.channelHues) as Channel[]).map((channel) => ({
    channel,
    on: on.has(channel) || topChannel(rec) === channel,
  }));
}
