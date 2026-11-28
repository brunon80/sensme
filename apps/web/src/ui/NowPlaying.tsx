// Now-playing screen (UI_SPEC §2): a track carousel — current track big at
// left, next tracks receding to the right, morphing on next/prev. Artwork
// stands on the water with reflection; right-aligned title block; channel
// dot grid; captions.
import { useEffect, useMemo, useRef, useState } from "react";
import { tokens } from "../../../../contracts/design-tokens/tokens";
import type { LibraryRecord } from "../engine/types";
import { entryHues, entryName, membershipDots, type CarouselEntry } from "./channels";

interface Props {
  queue: LibraryRecord[];
  pos: number;
  /** Candidate staged by L/R but not yet confirmed: big slot at pending scale. */
  pending?: boolean;
  entry: CarouselEntry;
  playing: boolean;
  /** Screen-transition phase (UI_SPEC §1): dim = channel grid open,
   * elements scaled down + faded but still visible. */
  phase?: "enter" | "dim";
  /** Mouse click on a track card (UI_SPEC §9): App stages a candidate or
   * confirms/plays, reusing the two-step L/R + START semantics. */
  onCardClick?: (queueIndex: number) => void;
  /** Live drag progress in slot units (UI_SPEC §9 mouse drag): the whole
   * stack renders at fractional slot offsets so it follows the pointer. */
  dragFrac?: number;
  /** Drag in progress: slot transitions off, so cards track the pointer. */
  dragging?: boolean;
}

interface Slot {
  centerX: number; // vh units (see slotChain)
  scale: number;
  opacity: number;
}

/** Viewport aspect (innerWidth/innerHeight), kept live on resize. Used to
 * convert vw-based anchors into vh, the unit the card size lives in. */
function useAspect(): number {
  const [aspect, setAspect] = useState(() => window.innerWidth / window.innerHeight);
  useEffect(() => {
    const on = () => setAspect(window.innerWidth / window.innerHeight);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return aspect;
}

/** Slot centers (vh) chained from the anchor: each card sits behind the
 * previous one, overlapping it by `np.overlap` of its own width — the
 * PSP's stacked look, uniform at every depth and aspect ratio. The chain
 * does not stop at the token slots: scales continue geometrically (ratio
 * of the last two token slots) until the card is fully past the right
 * edge, so the stack runs to the screen edge at any aspect (UI_SPEC §2). */
export function slotChain(aspect: number): Slot[] {
  const np = tokens.layout.np;
  const rightEdge = aspect; // screen width in vh-fraction units (×100 at render)
  const ratio = np.slots[np.slots.length - 1]!.scale / np.slots[np.slots.length - 2]!.scale;
  // Geometric decay with a low floor (np.minScale): far cards barely
  // shrink and keep stacking horizontally, but the gentle decay makes
  // their TOP edges serrate in steps while the bottom edges stay
  // aligned along the water (PSP, product owner 2026-11-27).
  const scaleOf = (k: number) =>
    k < np.slots.length
      ? Math.max(np.minScale, np.slots[k]!.scale)
      : Math.max(np.minScale, np.slots[np.slots.length - 1]!.scale * Math.pow(ratio, k - np.slots.length + 1));
  const out: Slot[] = [{ centerX: np.anchorX * aspect, scale: scaleOf(0), opacity: np.slots[0]!.opacity }];
  for (let k = 1; ; k++) {
    const scale = scaleOf(k);
    const w = np.size * scale;
    const prevW = np.size * scaleOf(k - 1);
    const centerX = out[k - 1]!.centerX + (prevW + w) / 2 - np.overlap * w;
    out.push({ centerX, scale, opacity: k < np.slots.length ? np.slots[k]!.opacity : 1 });
    if (centerX - w / 2 >= rightEdge) break; // fully past the right edge
  }
  return out;
}

function slotFor(k: number, pending: boolean, slots: Slot[], aspect: number): Slot | null {
  const np = tokens.layout.np;
  if (k === 0 && pending)
    return { centerX: slots[0]!.centerX, scale: np.pendingScale, opacity: 1 }; // staged candidate
  if (k >= 0 && k < slots.length) return slots[k]!;
  if (k === -1) return { ...np.prev, centerX: np.prev.centerX * aspect }; // glides out
  return null;
}

/** Slot at a fractional offset (mouse drag, UI_SPEC §9): linear blend
 * between the two neighbouring integer slots, so the stack follows the
 * pointer continuously and lands exactly on a real slot at whole steps. */
function slotForFrac(k: number, pending: boolean, slots: Slot[], aspect: number): Slot | null {
  const lo = slotFor(Math.floor(k), pending, slots, aspect);
  if (Number.isInteger(k)) return lo;
  const hi = slotFor(Math.ceil(k), pending, slots, aspect);
  if (!lo || !hi) return lo ?? hi;
  const t = k - Math.floor(k);
  return {
    centerX: lo.centerX + (hi.centerX - lo.centerX) * t,
    scale: lo.scale + (hi.scale - lo.scale) * t,
    opacity: lo.opacity + (hi.opacity - lo.opacity) * t,
  };
}

/** Shared document timeline: every marquee animation is pinned to it so
 * title, artist line and their water reflection scroll in lockstep. */
let marqueeTimeline: DocumentTimeline | null = null;
function sharedTimeline(): DocumentTimeline | null {
  // Older Safari has no DocumentTimeline: skip the sync, animations still
  // run (each line just starts on its own).
  if (typeof DocumentTimeline === "undefined") return null;
  marqueeTimeline ??= new DocumentTimeline();
  return marqueeTimeline;
}

/** One line of now-playing text: static (ellipsis) when it fits, marquee
 * auto-scroll when it does not (UI_SPEC §2). The inner span is measured
 * against the container; on overflow it gets a translate animation whose
 * distance is the exact overflow, so the last characters land flush at the
 * right margin before the loop restarts. */
function Marquee({ text, className }: { text: string; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    let raf = 0;
    const measure = () => {
      const over = i.offsetWidth - o.clientWidth;
      if (over <= 1) {
        i.style.removeProperty("--marquee-scroll");
        i.classList.remove("marquee-run");
        return;
      }
      // +8px lets the line breathe before the loop restarts. (px, not %:
      // `calc(<%> * <time>)` is invalid CSS, and a unitless custom property
      // keeps both the translate and the duration calcs valid.)
      i.style.setProperty("--marquee-px", `${over + 8}`);
      i.classList.add("marquee-run");
      // Pin to the shared timeline so every scrolling line stays in sync.
      const anims = i.getAnimations();
      const tl = sharedTimeline();
      if (tl && anims.length > 0) {
        for (const a of anims) {
          // `animationTimeline` is not in the DOM lib types yet (Chrome 116+,
          // Firefox 110+ implement it; Safari falls back to auto-join).
          (a as Animation & { animationTimeline?: unknown }).animationTimeline = tl;
          a.startTime ??= tl.currentTime ?? 0;
        }
      }
    };
    measure();
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    ro.observe(o);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [text]);
  return (
    <div ref={outer} className={`marquee ${className ?? ""}`}>
      <span ref={inner} className="marquee-inner">{text}</span>
    </div>
  );
}

export function NowPlaying({ queue, pos, pending, entry, playing, phase, onCardClick, dragFrac = 0, dragging = false }: Props) {
  const n = queue.length;
  const current = queue[pos] ?? null;
  const dots = useMemo(() => (current ? membershipDots(current) : []), [current]);

  const title = current?.title ?? current?.name.replace(/\.[^.]+$/, "") ?? "";
  const second = [current?.artist, current?.album].filter(Boolean).join(" / ");

  const np = tokens.layout.np;
  const aspect = useAspect();
  const slots = slotChain(aspect);
  // Render the outgoing card (k=-1) plus every slot that reaches the right
  // edge.
  const offsets = [-1, ...slots.map((_, k) => k)];

  return (
    <div className={`nowplaying ${phase ?? ""} ${dragging ? "dragging" : ""}`}>
      {n > 0 &&
        offsets.map((k) => {
          const idx = pos + k;
          if (idx < 0 || idx >= n) return null; // non-cyclic: clamp at the ends
          const fk = k - dragFrac; // fractional slot (drag/morph position)
          const slot = slotForFrac(k - dragFrac, pending ?? false, slots, aspect);
          if (!slot) return null;
          const rec = queue[idx]!;
          return (
            <TrackCard
              key={rec.id}
              record={rec}
              entry={entry}
              slot={slot}
              fk={fk}
              size={np.size}
              centerY={np.centerY}
              z={10 - Math.abs(k)}
              reflect={k >= 0}
              queueIdx={idx}
              onClick={onCardClick}
            />
          );
        })}

      {/* keyed by track so the title/artist crossfade replays on change */}
      <div className="np-text" key={current?.id ?? "none"}>
        <Marquee text={title} className="np-title" />
        <div className="np-rule" />
        {second && <Marquee text={second} className="np-second" />}
        <div className="np-text-reflect" aria-hidden="true">
          <Marquee text={title} />
          {second && <Marquee text={second} className="np-second" />}
        </div>
      </div>

      <div className="dotgrid">
        {dots.map(({ channel, on }) => (
          <span
            key={channel}
            className={`dot ${on ? "dot-on" : ""}`}
            style={{ background: on ? (tokens.color.channelHues[channel]?.[0] ?? "#fff") : "rgba(255,255,255,0.12)" }}
            title={entryName(channel as CarouselEntry)}
          />
        ))}
      </div>

      {playing && <div className="np-playing-tag">▶</div>}
    </div>
  );
}

/** One track card in the now-playing carousel (artwork + reflection).
 * Horizontally on its slot; vertically anchored to the water surface:
 * the card's bottom edge sits at `waterlineY + (npBottom − waterlineY)
 * · scale^floorExp`, so receding cards stand ON the water (bottom edges
 * converge to the waterline) while the big foreground card dips below
 * it — PSP reference IMG_7535 photo, product owner 2026-11-27.
 * Yawed in 3D (np.tiltDeg) so the row reads as a fan, not flat paper:
 * receding cards angle toward the current one, the current card tilts
 * the opposite way (PSP reference photo, product owner 2026-11-27). */
function TrackCard({
  record,
  entry,
  slot,
  fk,
  size,
  centerY,
  z,
  reflect,
  queueIdx,
  onClick,
}: {
  record: LibraryRecord;
  entry: CarouselEntry;
  slot: Slot;
  /** Fractional slot offset (k − dragFrac): drives the 3D yaw blend. */
  fk: number;
  size: number;
  centerY: number;
  z: number;
  reflect: boolean;
  /** Position in the queue, reported on click (UI_SPEC §9 mouse input). */
  queueIdx: number;
  onClick?: (queueIndex: number) => void;
}) {
  const [artUrl, setArtUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!record.artwork) {
      setArtUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([record.artwork.slice().buffer], { type: "image/*" }));
    setArtUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [record.id, record.artwork]);

  // Perspective floor: bottom edge from the waterline up as cards recede
  // (clamped scale -> far bottoms stay aligned along the water; the
  // gentle decay below minScale serrates the TOP edges - PSP, product
  // owner correction 2026-11-27). At scale 1 this reproduces the token
  // centerY exactly.
  const np = tokens.layout.np;
  const s = slot.scale;
  const bottomNear = centerY + size / 2;
  const bottom = tokens.layout.waterlineY + (bottomNear - tokens.layout.waterlineY) * Math.pow(s, np.floorExp);
  const cardCenterY = bottom - (size * s) / 2;
  // 3D yaw: current slot (fk<=0) tilts +tiltDeg, receding cards -tiltDeg
  // (their right edges toward the viewer, the fan wrapping away to the
  // right - PSP reference, product owner correction 2026-11-27), blended
  // across fk so morphs/drag pass smoothly through 0.
  const tilt = -np.tiltDeg * (2 * Math.min(Math.max(fk, 0), 1) - 1);

  return (
    <div
      className="np-track"
      data-np-idx={queueIdx}
      onClick={onClick ? () => onClick(queueIdx) : undefined}
      style={{
        width: `${size * 100}dvh`,
        height: `${size * 100}dvh`,
        // Position lives INSIDE the transform (left/top stay 0) so slot
        // changes animate; transitioning `left` would teleport the card.
        // X is in vh (the unit card sizes live in) so the stack overlap
        // is aspect-independent.
        transform: `translate(${slot.centerX * 100}dvh, ${cardCenterY * 100}dvh) translate(-50%, -50%) scale(${slot.scale}) rotateY(${tilt}deg)`,
        opacity: slot.opacity,
        zIndex: z,
      }}
    >
      {artUrl ? (
        <img src={artUrl} alt="" draggable={false} />
      ) : (
        <Placeholder entry={entry} />
      )}
      {artUrl && reflect && <div className="np-track-reflect" style={{ backgroundImage: `url(${artUrl})` }} />}
    </div>
  );
}

/** Channel placeholder card for missing artwork (UI_SPEC §2). */
function Placeholder({ entry }: { entry: CarouselEntry }) {
  const hues = entryHues(entry);
  const glyph =
    entry === "favourites" ? "♥" : entry === "shuffle" ? "⇄" : entry === "newly" ? "＋" : "♪";
  return (
    <div
      className="art-placeholder"
      style={{
        background: `radial-gradient(circle at 30% 25%, ${hues[0]}, ${hues[1] ?? hues[0]} 55%, #10131c)`,
      }}
    >
      <span>{glyph}</span>
    </div>
  );
}
