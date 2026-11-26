// Now-playing screen (UI_SPEC §2): a track carousel — current track big at
// left, next tracks receding to the right, morphing on next/prev. Artwork
// stands on the water with reflection; right-aligned title block; channel
// dot grid; captions.
import { useEffect, useMemo, useState } from "react";
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
function slotChain(aspect: number): Slot[] {
  const np = tokens.layout.np;
  const rightEdge = aspect; // screen width in vh-fraction units (×100 at render)
  const ratio = np.slots[np.slots.length - 1]!.scale / np.slots[np.slots.length - 2]!.scale;
  const scaleOf = (k: number) =>
    k < np.slots.length
      ? np.slots[k]!.scale
      : np.slots[np.slots.length - 1]!.scale * Math.pow(ratio, k - np.slots.length + 1);
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

export function NowPlaying({ queue, pos, pending, entry, playing, phase }: Props) {
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
    <div className={`nowplaying ${phase ?? ""}`}>
      {n > 0 &&
        offsets.map((k) => {
          const idx = pos + k;
          if (idx < 0 || idx >= n) return null; // non-cyclic: clamp at the ends
          const slot = slotFor(k, pending ?? false, slots, aspect);
          if (!slot) return null;
          const rec = queue[idx]!;
          return (
            <TrackCard
              key={rec.id}
              record={rec}
              entry={entry}
              slot={slot}
              size={np.size}
              centerY={np.centerY}
              z={10 - Math.abs(k)}
              reflect={k >= 0}
            />
          );
        })}

      {/* keyed by track so the title/artist crossfade replays on change */}
      <div className="np-text" key={current?.id ?? "none"}>
        <div className="np-title">{title}</div>
        <div className="np-rule" />
        {second && <div className="np-second">{second}</div>}
        <div className="np-text-reflect" aria-hidden="true">
          {title}
          {second && <><br />{second}</>}
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
 * Vertically centered on `centerY`, aligned with the current (big) card. */
function TrackCard({
  record,
  entry,
  slot,
  size,
  centerY,
  z,
  reflect,
}: {
  record: LibraryRecord;
  entry: CarouselEntry;
  slot: Slot;
  size: number;
  centerY: number;
  z: number;
  reflect: boolean;
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

  return (
    <div
      className="np-track"
      style={{
        width: `${size * 100}dvh`,
        height: `${size * 100}dvh`,
        // Position lives INSIDE the transform (left/top stay 0) so slot
        // changes animate; transitioning `left` would teleport the card.
        // X is in vh (the unit card sizes live in) so the stack overlap
        // is aspect-independent.
        transform: `translate(${slot.centerX * 100}dvh, ${centerY * 100}dvh) translate(-50%, -50%) scale(${slot.scale})`,
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
