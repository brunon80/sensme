// Channel selection (UI_SPEC §1; PSP references IMG_7506/7510): a static
// two-row grid of near-square photo cards — not a carousel. Column c holds
// entries 2c (bottom row) and 2c+1 (top row); ←/→ move between columns and
// ↑/↓ move within a column. The selected card scales up slightly with a
// light glow; the grid scrolls horizontally to keep it centered.
import { tokens } from "../../../../contracts/design-tokens/tokens";
import { photoUrlFor } from "./scene";
import { CAROUSEL_ORDER, entryName, type CarouselEntry } from "./channels";

interface Props {
  selected: number;
  /** Entries with zero tracks are dimmed and unselectable (R-2 hint). */
  counts: Record<CarouselEntry, number>;
  /** Screen-transition phase (UI_SPEC §1). */
  phase?: "enter" | "exit";
}

const COLS = Math.ceil(CAROUSEL_ORDER.length / 2);

interface Card {
  entry: CarouselEntry;
  col: number; // column offset from the selected column
  row: 0 | 1; // 0 = bottom, 1 = top
  sel: boolean;
}

export function Carousel({ selected, counts, phase }: Props) {
  const selCol = Math.floor(selected / 2);

  const cards: Card[] = [];
  for (let c = selCol - 2; c <= selCol + 2; c++) {
    if (c < 0 || c >= COLS) continue;
    for (const r of [0, 1] as const) {
      const idx = 2 * c + r;
      if (idx >= CAROUSEL_ORDER.length) continue;
      cards.push({ entry: CAROUSEL_ORDER[idx]!, col: c - selCol, row: r, sel: idx === selected });
    }
  }

  const t = tokens.layout.carousel;
  const g = t.globe;
  // Globe placement: cards sit on a cylinder of radius `globe.radius` (vw);
  // stepping rotates the globe by `globe.stepDeg` per column.
  const thetaOf = (col: number) => (col * g.stepDeg * Math.PI) / 180;
  const bottomVh = ((1 - t.centerY) - (2 * t.card.h + t.rowGap) / 2) * 100;
  const topVh = bottomVh + t.card.h * 100 + t.rowGap * 100;
  const nameBottom = bottomVh - 8; // fully below the bottom row (PSP)

  return (
    <div className={`carousel ${phase ?? ""}`}>
      {cards.map(({ entry, col, row, sel }) => {
        const empty = counts[entry] === 0;
        const theta = thetaOf(col);
        const x = g.radius * Math.sin(theta) * 100; // vw along the globe
        const z = g.radius * (Math.cos(theta) - 1) * 100; // vw (negative recedes)
        const rotY = col * g.stepDeg; // face outward on the cylinder
        const rotX = (row === 1 ? 1 : -1) * g.rowTiltDeg; // rows curve too
        const dim = 1 - Math.min(2, Math.abs(col)) * 0.12; // far cards darker
        const style = {
          width: `${t.card.w * 100}vw`,
          height: `${t.card.h * 100}vh`,
          bottom: `${row === 0 ? bottomVh : topVh}vh`,
          transform: `translateX(calc(-50% + ${x}vw)) translateZ(${z}vw) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(${sel ? t.selectedScale : 1})`,
          opacity: (empty ? 0.8 : 1) * dim,
          zIndex: 30 - Math.abs(col) * 2,
          borderRadius: `${t.tileRadius * 100}vmin`,
        };
        return (
          <div key={entry} className={`tile ${sel ? "tile-sel" : ""}`} style={style}>
            <img src={photoUrlFor(entry)} alt="" draggable={false} />
            {row === 0 && (
              <div className="tile-reflect" style={{ backgroundImage: `url(${photoUrlFor(entry)})` }} />
            )}
          </div>
        );
      })}
      {/* keyed by selection so the name crossfades on every change */}
      <div className="carousel-name" key={CAROUSEL_ORDER[selected]} style={{ bottom: `${nameBottom}vh`, top: "auto" }}>
        {entryName(CAROUSEL_ORDER[selected]!)}
        <span className="carousel-name-reflect" aria-hidden="true">
          {entryName(CAROUSEL_ORDER[selected]!)}
        </span>
      </div>
    </div>
  );
}
