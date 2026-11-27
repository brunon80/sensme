// Playback through a hidden HTMLMediaElement (ADR-017). Browsers only hand
// the OS media session — Windows/Linux now-playing controls, hardware media
// keys, MPRIS on Linux — to pages that own a real media element; a Web-
// Audio-only page never becomes the active media session (w3c/mediasession
// #244/#378, Firefox bug 2067534). Decoding stays browser-native on purpose:
// playback is NOT the analysis path (analysis stays deterministic in wasm,
// ADR-016).
export type PlayerState = "stopped" | "playing" | "paused";

/** Container MIME type for a file name, used for the playback blob. An
 * unknown extension gets an empty type so the browser sniffs the container. */
export function mimeForName(name: string): string {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "mp3":
      return "audio/mpeg";
    case "flac":
      return "audio/flac";
    case "ogg":
    case "oga":
      return "audio/ogg";
    case "m4a":
    case "mp4":
    case "aac":
      return "audio/mp4";
    case "wav":
      return "audio/wav";
    default:
      return "";
  }
}

export class Player {
  private el: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private onEndedCb: (() => void) | null = null;
  state: PlayerState = "stopped";
  private listeners = new Set<() => void>();
  // Optional Web Audio gain stage (Dynamic Normalizer): element → source →
  // gain → destination. The element stays the media session owner (ADR-017);
  // the graph only inserts volume control in front of the speakers.
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private pendingGain = 1;

  /** Subscribe to state changes; returns an unsubscribe function. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setState(s: PlayerState): void {
    this.state = s;
    for (const fn of this.listeners) fn();
  }

  private ensureEl(): HTMLAudioElement {
    if (!this.el) {
      const el = new Audio();
      el.preload = "auto";
      // Only `ended` is observed: every other transition is driven by our
      // own methods (OS transport requests arrive as Media Session action
      // handlers, which call right back into this class).
      el.addEventListener("ended", () => {
        if (this.state !== "playing") return;
        const cb = this.onEndedCb;
        this.setState("stopped");
        cb?.();
      });
      this.el = el;
    }
    return this.el;
  }

  /** PSP mixer ramp interval: 0x70 chunks × 28 samples = 3136 samples
   * ≈ 71 ms @44.1 kHz (RE report §5; moodwave-psp port). Gain changes glide
   * over the same interval the original's ramp engine uses. */
  private static readonly RAMP_SEC = 3136 / 44100;

  /** Lazily insert the gain stage. Once a MediaElementAudioSourceNode is
   * bound, the element's output flows through the graph; if Web Audio is
   * unavailable playback still works at unity gain. */
  private ensureGraph(): void {
    if (this.ctx) return;
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaElementSource(this.ensureEl());
      const gain = ctx.createGain();
      gain.gain.value = this.pendingGain;
      src.connect(gain);
      gain.connect(ctx.destination);
      this.ctx = ctx;
      this.gainNode = gain;
    } catch {
      this.ctx = null;
      this.gainNode = null;
    }
  }

  /** Current target gain (automation seam for the normalizer gate). */
  gainValue(): number {
    return this.pendingGain;
  }

  /** Set output gain (1.0 = unity) with a PSP-style ramp. Safe before the
   * graph exists: the value is applied when it is created. */
  setGain(g: number): void {
    this.pendingGain = Math.max(0, g);
    if (!this.ctx || !this.gainNode) return;
    const t = this.ctx.currentTime;
    this.gainNode.gain.cancelScheduledValues(t);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, t);
    this.gainNode.gain.linearRampToValueAtTime(this.pendingGain, t + Player.RAMP_SEC);
  }

  /** Play a track from the beginning. `mime` names the container so the
   * element can pick a decoder. Rejects only on autoplay-policy or decode
   * failure; the player stays "stopped" in that case. */
  async play(bytes: Uint8Array, onEnded?: () => void, mime = ""): Promise<void> {
    const el = this.ensureEl();
    this.ensureGraph();
    void this.ctx?.resume(); // autoplay policy: the context starts suspended
    this.releaseSource();
    // Copy into a fresh ArrayBuffer: the bytes come out of IndexedDB and the
    // blob keeps its own detached-safe copy (slice() also narrows the type).
    this.objectUrl = URL.createObjectURL(new Blob([bytes.slice()], mime ? { type: mime } : undefined));
    this.onEndedCb = onEnded ?? null;
    el.src = this.objectUrl;
    await el.play();
    this.setState("playing");
  }

  pause(): void {
    if (this.state !== "playing" || !this.el) return;
    this.el.pause();
    this.setState("paused");
  }

  resume(): void {
    if (this.state !== "paused" || !this.el) return;
    void this.el.play().then(() => this.setState("playing"));
  }

  /** START semantics: play/pause toggle (R-2 button map). */
  toggle(bytes?: Uint8Array, onEnded?: () => void): void {
    if (this.state === "playing") this.pause();
    else if (this.state === "paused") this.resume();
    else if (bytes) void this.play(bytes, onEnded);
  }

  stop(): void {
    const el = this.ensureEl();
    this.onEndedCb = null;
    el.pause();
    el.removeAttribute("src");
    el.load(); // drop the loaded track so position/duration reset
    this.releaseSource();
    this.setState("stopped");
  }

  /** Seek to `sec` (clamped to the loaded track). Works while playing or
   * paused; a stopped player ignores it. */
  seek(sec: number): void {
    if (!this.el || !this.objectUrl) return;
    const dur = this.durationSec();
    const t = Math.min(Math.max(0, sec), dur);
    try {
      this.el.currentTime = t;
    } catch {
      // Metadata not loaded yet: nothing to seek into.
    }
  }

  positionSec(): number {
    return this.el?.currentTime ?? 0;
  }

  /** Duration of the loaded track in seconds, 0 when nothing is loaded. */
  durationSec(): number {
    const d = this.el?.duration;
    return d !== undefined && Number.isFinite(d) ? d : 0;
  }

  private releaseSource(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}

export const player = new Player();
