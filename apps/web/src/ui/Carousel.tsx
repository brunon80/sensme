// Channel carousel (UI_SPEC §1): horizontal row of photographic-style
// tiles centered on the waterline, selected tile centered + enlarged,
// neighbors receding with scale/dim steps; reflections below the water.
import { useMemo } from "react";
import { tokens } from "../../../../contracts/design-tokens/tokens";
import { renderBackdrop } from "./scene";
import { CAROUSEL_ORDER, entryHues, entryName, type CarouselEntry } from "./channels";

interface Props {
  selected: number;
  /** Entries with zero tracks are dimmed and unselectable (R-2 hint). */
  counts: Record<CarouselEntry, number>;
}

const tileCache = new Map<string, string>();
function tileImage(entry: CarouselEntry): string {
  const key = entry;
  let url = tileCache.get(key);
  if (!url) {
    const cv = renderBackdrop(`tile:${key}`, entryHues(entry), 240, 320);
    url = cv.toDataURL("image/png");
    tileCache.set(key, url);
  }
  return url;
}

export function Carousel({ selected, counts }: Props) {
  const n = CAROUSEL_ORDER.length;
  const items = useMemo(
    () =>
      CAROUSEL_ORDER.map((entry, i) => {
        let d = i - selected;
        if (d > n / 2) d -= n;
        if (d < -n / 2) d += n;
        return { entry, d };
      }).filter(({ d }) => Math.abs(d) <= 4),
    [selected, n],
  );

  const selW = tokens.layout.carousel.selected.w;
  const selH = tokens.layout.carousel.selected.h;

  return (
    <div className="carousel">
      {items.map(({ entry, d }) => {
        const scale = d === 0 ? 1 : Math.pow(tokens.layout.carousel.scaleStep, Math.abs(d));
        const dim = Math.max(0.25, 1 - tokens.layout.carousel.dimStep * Math.abs(d));
        const empty = counts[entry] === 0;
        const wPct = selW * scale * 100;
        const hPct = selH * scale * 100;
        const xVw = d * selW * 0.72 * 100;
        const tilt = d === 0 ? 0 : d > 0 ? -tokens.layout.carousel.tiltDeg : tokens.layout.carousel.tiltDeg;
        const style = {
          width: `${wPct}vw`,
          height: `${hPct}vh`,
          transform: `translateX(calc(-50% + ${xVw}vw)) perspective(1200px) rotateY(${tilt}deg)`,
          opacity: (empty ? 0.35 : 1) * dim,
          zIndex: 10 - Math.abs(d),
          borderRadius: `${tokens.layout.carousel.tileRadius * 100}vmin`,
        };
        return (
          <div key={entry} className={`tile ${d === 0 ? "tile-sel" : ""}`} style={style}>
            <img src={tileImage(entry)} alt="" draggable={false} />
            <div className="tile-reflect" style={{ backgroundImage: `url(${tileImage(entry)})` }} />
          </div>
        );
      })}
      <div className="carousel-name">{entryName(CAROUSEL_ORDER[selected]!)}</div>
    </div>
  );
}
