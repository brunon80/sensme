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
  entry: CarouselEntry;
  playing: boolean;
  /** Screen-transition phase (UI_SPEC §1). */
  phase?: "enter" | "exit";
}

interface Slot {
  centerX: number;
  scale: number;
  opacity: number;
}

function slotFor(k: number): Slot | null {
  const np = tokens.layout.np;
  if (k >= 0 && k < np.slots.length) return np.slots[k]!;
  if (k === -1) return np.prev!; // glides out
  return null;
}

export function NowPlaying({ queue, pos, entry, playing, phase }: Props) {
  const n = queue.length;
  const current = queue[pos] ?? null;
  const dots = useMemo(() => (current ? membershipDots(current) : []), [current]);

  const title = current?.title ?? current?.name.replace(/\.[^.]+$/, "") ?? "";
  const second = [current?.artist, current?.album].filter(Boolean).join(" / ");

  const np = tokens.layout.np;
  const offsets = [-1, 0, 1, 2, 3, 4, 5];

  return (
    <div className={`nowplaying ${phase ?? ""}`}>
      {n > 0 &&
        offsets.map((k) => {
          const idx = pos + k;
          if (idx < 0 || idx >= n) return null; // non-cyclic: clamp at the ends
          const slot = slotFor(k);
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
              reflect={k === 0}
            />
          );
        })}

      <div className="np-text">
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
        width: `${size * 100}vh`,
        height: `${size * 100}vh`,
        left: `${slot.centerX * 100}vw`,
        top: `${centerY * 100}vh`,
        transform: `translate(-50%, -50%) scale(${slot.scale})`,
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
