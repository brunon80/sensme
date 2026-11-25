// Web Audio playback. Decoding here is browser-native on purpose: playback
// is NOT the analysis path (analysis stays deterministic in wasm, ADR-016).
export type PlayerState = "stopped" | "playing" | "paused";

export class Player {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  private startedAt = 0; // ctx time when current source started
  private offsetSec = 0; // buffer offset of the current source
  private onEndedCb: (() => void) | null = null;
  state: PlayerState = "stopped";
  private listeners = new Set<() => void>();

  /** Subscribe to state changes; returns an unsubscribe function. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setState(s: PlayerState): void {
    this.state = s;
    for (const fn of this.listeners) fn();
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /** Play a track from the beginning. */
  async play(bytes: Uint8Array, onEnded?: () => void): Promise<void> {
    const ctx = this.ensureCtx();
    this.stopSource();
    // Copy: wasm memory may be grown/reused; decodeAudioData detaches the buffer.
    const copy = bytes.slice().buffer;
    this.buffer = await ctx.decodeAudioData(copy);
    this.onEndedCb = onEnded ?? null;
    this.offsetSec = 0;
    this.startSource();
  }

  private startSource(): void {
    const ctx = this.ensureCtx();
    if (!this.buffer) return;
    this.source = ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.gain!);
    this.source.onended = () => {
      if (this.state === "playing" && this.onEndedCb) {
        const naturalEnd = this.offsetSec + (this.buffer?.duration ?? 0) - ctx.currentTime < 0.15;
        if (naturalEnd) {
          this.setState("stopped");
          this.onEndedCb();
        }
      }
    };
    this.startedAt = ctx.currentTime;
    this.source.start(0, this.offsetSec);
    this.setState("playing");
  }

  pause(): void {
    if (this.state !== "playing" || !this.ctx || !this.source) return;
    this.offsetSec += this.ctx.currentTime - this.startedAt;
    this.stopSource();
    this.setState("paused");
  }

  resume(): void {
    if (this.state !== "paused") return;
    this.startSource();
  }

  /** START semantics: play/pause toggle (R-2 button map). */
  toggle(bytes?: Uint8Array, onEnded?: () => void): void {
    if (this.state === "playing") this.pause();
    else if (this.state === "paused") this.resume();
    else if (bytes) void this.play(bytes, onEnded);
  }

  stop(): void {
    this.stopSource();
    this.buffer = null;
    this.setState("stopped");
  }

  private stopSource(): void {
    if (this.source) {
      this.source.onended = null;
      this.source.stop();
      this.source.disconnect();
      this.source = null;
    }
  }

  positionSec(): number {
    if (this.state !== "playing" || !this.ctx) return this.offsetSec;
    return this.offsetSec + (this.ctx.currentTime - this.startedAt);
  }
}

export const player = new Player();
