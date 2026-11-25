// Now-playing screen (UI_SPEC §2): artwork standing on the water with
// reflection, right-aligned title block, channel dot grid, captions.
import { useEffect, useMemo, useState } from "react";
import { tokens } from "../../../../contracts/design-tokens/tokens";
import type { LibraryRecord } from "../engine/types";
import { entryHues, entryName, membershipDots, type CarouselEntry } from "./channels";

interface Props {
  record: LibraryRecord | null;
  entry: CarouselEntry;
  playing: boolean;
}

export function NowPlaying({ record, entry, playing }: Props) {
  const [artUrl, setArtUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!record?.artwork) {
      setArtUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([record.artwork.slice().buffer], { type: "image/*" }));
    setArtUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [record?.id, record?.artwork]);

  const dots = useMemo(() => (record ? membershipDots(record) : []), [record]);
  const art = tokens.layout.art;

  const title = record?.title ?? record?.name.replace(/\.[^.]+$/, "") ?? "";
  const second = [record?.artist, record?.album].filter(Boolean).join(" / ");

  return (
    <div className="nowplaying">
      <div
        className="artwork"
        style={{
          width: `${art.size * 100}vh`,
          height: `${art.size * 100}vh`,
          left: `${(art.centerX - art.size / 2) * 100}vw`,
          bottom: `${(1 - art.bottom) * 100}vh`,
        }}
      >
        {artUrl ? (
          <img src={artUrl} alt={title} draggable={false} />
        ) : (
          <Placeholder entry={entry} />
        )}
        <div className="artwork-reflect" />
      </div>

      <div className="np-text">
        <div className="np-title">{title}</div>
        <div className="np-rule" />
        {second && <div className="np-second">{second}</div>}
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
