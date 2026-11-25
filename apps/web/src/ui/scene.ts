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

/** Render the static backdrop (bokeh field) for a channel's hue set. */
export function renderBackdrop(key: string, hues: Hues, w: number, h: number): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d")!;
  const rnd = mulberry32(hashStr(key));
  const waterY = Math.round(h * tokens.layout.waterlineY);

  // Base gradient: near-black at top, slightly lifted toward the waterline.
  const grad = ctx.createLinearGradient(0, 0, 0, waterY);
  grad.addColorStop(0, tokens.color.bgBase);
  grad.addColorStop(1, "#141824");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Bokeh dot field (channel-hued, soft, varied sizes).
  const count = 90;
  for (let i = 0; i < count; i++) {
    const x = rnd() * w;
    const y = rnd() * (waterY - 8);
    const r = 1.5 + rnd() * rnd() * 14;
    const hue = hues[Math.floor(rnd() * hues.length)] ?? "#ffffff";
    const alpha = 0.06 + rnd() * 0.30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, hexA(hue, alpha));
    g.addColorStop(0.7, hexA(hue, alpha * 0.5));
    g.addColorStop(1, hexA(hue, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return cv;
}

function hexA(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
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

  // Water: vertical mirror of the backdrop, sliced into bands with a
  // horizontal sine offset (cheap ripple), faded and darkened.
  const band = 3;
  const loop = tokens.motion.rippleLoopS;
  const phase = (t % loop) / loop * Math.PI * 2;
  ctx.save();
  ctx.globalAlpha = tokens.color.waterOpacity;
  for (let y = 0; y < h - waterY; y += band) {
    const srcY = Math.max(0, waterY - y - band); // mirrored source row
    const depth = y / (h - waterY);
    const dx = Math.sin(phase + y * 0.12) * (1.5 + depth * 6);
    ctx.drawImage(backdrop, 0, srcY, w, band, dx, waterY + y, w, band);
  }
  ctx.restore();
  // Darken toward the bottom + waterline sheen.
  const g = ctx.createLinearGradient(0, waterY, 0, h);
  g.addColorStop(0, "rgba(0,0,0,0.15)");
  g.addColorStop(1, "rgba(0,0,0,0.75)");
  ctx.fillStyle = g;
  ctx.fillRect(0, waterY, w, h - waterY);
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.fillRect(0, waterY - 1, w, 2);
}
