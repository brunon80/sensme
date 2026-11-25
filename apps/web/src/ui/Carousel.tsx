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
  const colStep = (t.card.w + t.colGap) * 100; // vw between column centers
  const bottomVh = (1 - t.baseline) * 100;
  const topVh = bottomVh + t.card.h * 100 + t.rowGap * 100;
  const nameBottom = bottomVh - 3.5; // always under the bottom row (PSP)

  return (
    <div className={`carousel ${phase ?? ""}`}>
      {cards.map(({ entry, col, row, sel }) => {
        const empty = counts[entry] === 0;
        const style = {
          width: `${t.card.w * 100}vw`,
          height: `${t.card.h * 100}vh`,
          bottom: `${row === 0 ? bottomVh : topVh}vh`,
          transform: `translateX(calc(-50% + ${col * colStep}vw)) scale(${sel ? t.selectedScale : 1})`,
          opacity: empty ? 0.8 : 1,
          zIndex: sel ? 30 : 20,
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
