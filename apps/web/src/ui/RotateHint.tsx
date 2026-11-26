// Landscape lock on touch devices (UI_SPEC §9): the PSP is a landscape 16:9
// device, so in portrait on a coarse-pointer device this overlay covers the
// whole scene until the device is turned. Visibility is pure CSS (media
// query), so it also handles orientation changes without JS.
export function RotateHint() {
  return (
    <div className="rotate-hint" aria-hidden="true">
      <div className="rotate-glyph" />
      <div className="rotate-text">Rotate your device</div>
    </div>
  );
}
