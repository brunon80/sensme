// Channel selection (UI_SPEC §1; PSP references IMG_7506/7510): a static
// two-row grid of near-square photo cards — not a carousel. ←/→ move
// between columns and ↑/↓ move within a column. The selected card scales
// up slightly with a light glow; the grid scrolls horizontally to keep it
// centered.
import { tokens } from "../../../../contracts/design-tokens/tokens";
import { photoUrlFor } from "./scene";
import { entryName, type GridCell } from "./channels";

interface Props {
  /** Column-major grid cells (channels.ts carouselGrid). */
  grid: GridCell[];
  selected: number;
  /** Entries with zero tracks are dimmed and unselectable (R-2 hint). */
  counts: Record<string, number>;
  /** Screen-transition phase (UI_SPEC §1). */
  phase?: "enter" | "exit";
  /** Mouse click on a tile (UI_SPEC §9): App resolves select/enter with the
   * same semantics as a touch tap. */
  onSelect?: (idx: number) => void;
  /** Live drag progress in column units (UI_SPEC §9 mouse drag): the globe
   * geometry is a pure function of column offset, so a fractional offset
   * rotates the whole globe continuously under the pointer. */
  dragFrac?: number;
  /** Drag in progress: step transitions off, so tiles track the pointer. */
  dragging?: boolean;
}

export function Carousel({ grid, selected, counts, phase, onSelect, dragFrac = 0, dragging = false }: Props) {
  const sel = grid[Math.min(selected, grid.length - 1)]!;
  const selCol = sel.col;

  const cards: GridCell[] = [];
  for (const cell of grid) {
    if (cell.col >= selCol - 2 && cell.col <= selCol + 2) cards.push(cell);
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
    <div className={`carousel ${phase ?? ""} ${dragging ? "dragging" : ""}`}>
      {cards.map((cell) => {
        const { entry, row } = cell;
        // Offset from the selected column; dragFrac shifts the effective
        // selection fractionally, rotating the globe under the pointer.
        const col = cell.col - selCol - dragFrac;
        const isSel = cell === sel;
        const empty = counts[entry] === 0;
        const theta = thetaOf(col);
        // Inside-the-globe, PSP-faithful (IMG_7504): uniform spacing
        // (never overlap), arc opening to the sides (outer columns
        // bow toward the viewer), and a gentle globe angle — cards
        // face inward like on the inside of a sphere.
        const x = col * (t.card.w + t.colGap) * 100; // uniform, no stacking
        const z = g.depth * (1 - Math.cos(theta)) * 100; // sides nearer
        const rotY = -col * g.angleDeg; // face inward (concave)
        const vShift = g.rowCurve * (1 - Math.cos(theta)) * 100; // rows bow inward
        const dim = 1 - Math.min(2, Math.abs(col)) * 0.12; // far cards darker
        // Selected card grows; during a drag the growth is interpolated by
        // distance so the incoming card scales up as it nears the center.
        const scale = 1 + (t.selectedScale - 1) * Math.max(0, 1 - Math.abs(col));
        const style = {
          width: `${t.card.w * 100}dvw`,
          height: `${t.card.h * 100}dvh`,
          bottom: `${(row === 0 ? bottomVh + vShift : topVh - vShift)}dvh`,
          transform: `translateX(calc(-50% + ${x}dvw)) translateZ(${z}dvw) rotateY(${rotY}deg) scale(${scale})`,
          opacity: (empty ? 0.8 : 1) * dim,
          zIndex: 30 + Math.abs(col) * 2,
          borderRadius: `${t.tileRadius * 100}vmin`,
        };
        return (
          <div
            key={entry}
            className={`tile ${isSel ? "tile-sel" : ""} ${empty ? "tile-empty" : ""}`}
            style={style}
            data-entry={entry}
            onClick={onSelect ? () => onSelect(grid.indexOf(cell)) : undefined}
          >
            <img src={photoUrlFor(entry)} alt="" draggable={false} />
            {row === 0 && (
              <div className="tile-reflect" style={{ backgroundImage: `url(${photoUrlFor(entry)})` }} />
            )}
          </div>
        );
      })}
      {/* keyed by selection so the name crossfades on every change */}
      <div className="carousel-name" key={sel.entry} style={{ bottom: `${nameBottom}dvh`, top: "auto" }}>
        {entryName(sel.entry)}
        <span className="carousel-name-reflect" aria-hidden="true">
          {entryName(sel.entry)}
        </span>
      </div>
    </div>
  );
}
