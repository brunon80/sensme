// OS media integration (ADR-017): the Media Session API publishes the
// current track and transport controls to the operating system, so
// Windows/Linux desktop environments show now-playing metadata in their
// media overlays and hardware media keys (and Linux MPRIS clients) drive
// playback. Requires the HTMLMediaElement player — browsers never activate
// the media session for Web-Audio-only pages.
import { player } from "./player";
import type { PlayerState } from "./player";
import type { LibraryRecord } from "./types";

/** Transport actions the OS can request. They mirror the on-screen PSP
 * controls, except next/prev skip immediately: hardware keys mean "now",
 * not the two-step L/R candidate staging. */
export interface MediaControls {
  play: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
  stop: () => void;
}

export function mediaSessionSupported(): boolean {
  return "mediaSession" in navigator;
}

/** App icon fallback (resolved against the document base, which carries
 * the GitHub Pages project path). */
function appIconUrl(): string {
  return new URL("icon.svg", document.baseURI).href;
}

let artworkUrl: string | null = null;

function artworkFor(rec: LibraryRecord): MediaImage[] {
  const icon: MediaImage = { src: appIconUrl(), sizes: "any", type: "image/svg+xml" };
  if (!rec.artwork) return [icon];
  if (artworkUrl) URL.revokeObjectURL(artworkUrl);
  artworkUrl = URL.createObjectURL(new Blob([rec.artwork.slice()], { type: "image/*" }));
  return [{ src: artworkUrl, sizes: "any" }, icon];
}

/** Publish the current track to the OS (title / artist / album / artwork). */
export function setTrackMetadata(rec: LibraryRecord | null): void {
  if (!mediaSessionSupported()) return;
  if (!rec) {
    navigator.mediaSession.metadata = null;
    return;
  }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: rec.title || rec.name.replace(/\.[^.]+$/, ""),
    artist: rec.artist ?? "",
    album: rec.album ?? "",
    artwork: artworkFor(rec),
  });
}

/** Reflect the player state in the OS controls (play/pause button). */
export function setPlaybackState(state: PlayerState): void {
  if (!mediaSessionSupported()) return;
  navigator.mediaSession.playbackState = state === "stopped" ? "none" : state;
}

let lastPos: MediaPositionState | null = null;

/** Push the playhead so OS scrubbing UIs follow along. Firefox has no
 * `setPositionState` — skipped there. */
export function updatePositionState(): void {
  if (!mediaSessionSupported()) return;
  const ms = navigator.mediaSession;
  if (typeof ms.setPositionState !== "function") return;
  const duration = player.durationSec();
  if (duration <= 0) return;
  const position = Math.min(player.positionSec(), duration);
  try {
    ms.setPositionState({ duration, position, playbackRate: 1 });
    lastPos = { duration, position, playbackRate: 1 };
  } catch {
    // Position outside [0, duration] mid-seek: skip this tick.
  }
}

/** Last position state accepted by the OS (automation seam: proves the
 * position ticker ran). */
export function lastPositionState(): MediaPositionState | null {
  return lastPos;
}

/** Wire OS transport requests to app actions. Returns a cleanup that
 * unregisters the handlers. */
export function registerMediaControls(ctl: MediaControls): () => void {
  if (!mediaSessionSupported()) return () => {};
  const ms = navigator.mediaSession;
  const handlers: [MediaSessionAction, (d: MediaSessionActionDetails) => void][] = [
    ["play", () => ctl.play()],
    ["pause", () => ctl.pause()],
    ["previoustrack", () => ctl.prev()],
    ["nexttrack", () => ctl.next()],
    ["stop", () => ctl.stop()],
    ["seekto", (d) => {
      if (typeof d.seekTime === "number") player.seek(d.seekTime);
    }],
    ["seekbackward", (d) => player.seek(player.positionSec() - (d.seekOffset ?? 10))],
    ["seekforward", (d) => player.seek(player.positionSec() + (d.seekOffset ?? 10))],
  ];
  for (const [action, h] of handlers) ms.setActionHandler(action, h);
  return () => {
    for (const [action] of handlers) ms.setActionHandler(action, null);
  };
}
