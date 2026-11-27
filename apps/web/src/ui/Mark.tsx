// The Moodwave wave-bars mark as inline SVG (same geometry as
// public/icon-mark.svg; ADR-020). Used where a small logo is needed
// inline (e.g. the Favourited caption label) instead of the heart.

/** Twelve spectrum-ordered bars, one per channel. */
export function Mark({ className }: { className?: string }) {
  const bars: Array<[number, number, number, string]> = [
    [69, 181, 150, "#E06A6A"],
    [101, 111, 290, "#E89A55"],
    [133, 111, 290, "#E8B455"],
    [165, 181, 150, "#E8D26A"],
    [197, 281, 150, "#B8D25E"],
    [229, 316, 80, "#7CC96F"],
    [261, 181, 150, "#5FC2B8"],
    [293, 111, 290, "#6FC7E8"],
    [325, 111, 290, "#6FA8F0"],
    [357, 181, 150, "#9A8CF5"],
    [389, 281, 150, "#E06CE0"],
    [421, 316, 80, "#E87BA8"],
  ];
  return (
    <svg className={className} viewBox="60 100 392 320" aria-hidden="true">
      {bars.map(([x, y, h, fill]) => (
        <rect key={x} x={x} y={y} width="22" height={h} rx="11" fill={fill} />
      ))}
    </svg>
  );
}
