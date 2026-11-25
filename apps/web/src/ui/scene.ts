// Scene renderer: static channel backdrop above the waterline, rippling
// water reflection below (UI_SPEC §0; product-owner note: "the background
// is a static image but the middle/bottom is like water reflecting this
// image and albums above the water surface").
import { tokens } from "../../../../contracts/design-tokens/tokens";

/** Deterministic PRNG so a channel's backdrop is stable across sessions. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type Hues = readonly string[];

function hexRGB(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function mixWhite(hex: string, t: number): string {
  const [r, g, b] = hexRGB(hex);
  const m = (c: number) => Math.round(c + (255 - c) * t);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}
function hexA(hex: string, a: number): string {
  const [r, g, b] = hexRGB(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Render the static backdrop for a channel: a bright, luminous scene
 * (channel-tinted sky gradient + glowing bokeh), reflected on a glossy
 * floor below the waterline (UI_SPEC §0; PSP references IMG_75xx). */
export function renderBackdrop(key: string, hues: Hues, w: number, h: number): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d")!;
  const rnd = mulberry32(hashStr(key));
  const waterY = Math.round(h * tokens.layout.waterlineY);
  const base = hues[0] ?? "#6f86a8";

  // Bright sky gradient: near-white tint at top, channel colour lower.
  const grad = ctx.createLinearGradient(0, 0, 0, waterY);
  grad.addColorStop(0, mixWhite(base, 0.82));
  grad.addColorStop(0.6, mixWhite(base, 0.5));
  grad.addColorStop(1, mixWhite(base, 0.28));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Large soft light source (sun/stage glow) for luminosity.
  const gx = w * (0.3 + rnd() * 0.4);
  const gy = waterY * (0.25 + rnd() * 0.3);
  const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(w, h) * 0.5);
  glow.addColorStop(0, "rgba(255,255,255,0.55)");
  glow.addColorStop(0.5, "rgba(255,255,255,0.12)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, waterY);

  // Glowing bokeh field (channel-hued, bright, varied sizes).
  const count = 110;
  for (let i = 0; i < count; i++) {
    const x = rnd() * w;
    const y = rnd() * (waterY - 8);
    const r = 2 + rnd() * rnd() * 22;
    const hue = hues[Math.floor(rnd() * hues.length)] ?? "#ffffff";
    const alpha = 0.12 + rnd() * 0.4;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, mixWhite(hue, 0.5));
    g.addColorStop(0.4, hexA(hue, alpha));
    g.addColorStop(1, hexA(hue, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return cv;
}

/**
 * Draw one animation frame: static backdrop on top, mirrored + rippling
 * water below the waterline. `t` is seconds (ripple loop ~motion.rippleLoopS).
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  backdrop: HTMLCanvasElement,
  w: number,
  h: number,
  t: number,
): void {
  const waterY = Math.round(h * tokens.layout.waterlineY);
  ctx.clearRect(0, 0, w, h);
  // Top: static image.
  ctx.drawImage(backdrop, 0, 0, w, waterY, 0, 0, w, waterY);

  // Glossy floor: vertical mirror of the backdrop, sliced into bands with a
  // gentle horizontal ripple. Bright (not blackened) — the PSP floor is a
  // luminous reflective surface.
  const band = 3;
  const loop = tokens.motion.rippleLoopS;
  const phase = (t % loop) / loop * Math.PI * 2;
  ctx.save();
  ctx.globalAlpha = 0.6;
  for (let y = 0; y < h - waterY; y += band) {
    const srcY = Math.max(0, waterY - y - band); // mirrored source row
    const depth = y / (h - waterY);
    const dx = Math.sin(phase + y * 0.1) * (1 + depth * 4);
    ctx.drawImage(backdrop, 0, srcY, w, band, dx, waterY + y, w, band);
  }
  ctx.restore();
  // Floor sheen: bright near the waterline, gently deepening downward.
  const g = ctx.createLinearGradient(0, waterY, 0, h);
  g.addColorStop(0, "rgba(255,255,255,0.18)");
  g.addColorStop(0.4, "rgba(255,255,255,0.02)");
  g.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = g;
  ctx.fillRect(0, waterY, w, h - waterY);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(0, waterY - 1, w, 2);
}

/** Blend two same-size backdrops into `out` at mix `p` (0 = a, 1 = b).
 * Used for the channel-switch crossfade (UI_SPEC §1). */
export function crossfade(
  out: HTMLCanvasElement,
  a: HTMLCanvasElement,
  b: HTMLCanvasElement,
  p: number,
): void {
  const ctx = out.getContext("2d")!;
  ctx.clearRect(0, 0, out.width, out.height);
  ctx.globalAlpha = 1;
  ctx.drawImage(a, 0, 0);
  ctx.globalAlpha = Math.max(0, Math.min(1, p));
  ctx.drawImage(b, 0, 0);
  ctx.globalAlpha = 1;
}
