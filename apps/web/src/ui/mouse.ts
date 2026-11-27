// Mouse-wheel navigation (UI_SPEC §9): the wheel maps onto the same
// column/track steps as the D-pad — one step per accumulated notch, so
// high-resolution trackpad deltas cannot fire a burst of steps. Like every
// other input path, the steps resolve to App's shared action dispatcher, so
// behaviour cannot drift between platforms.
import { useEffect, useRef } from "react";

export type WheelDir = "left" | "right" | "up" | "down";
/** Min accumulated delta (px) per navigation step. A standard mouse notch
 * is ~100 px in pixel mode; trackpads send many small deltas that
 * accumulate to the same step size. */
const STEP_PX = 50;

/** Window-level wheel listener: accumulates deltas and reports at most one
 * step per event once the threshold is crossed. The app never scrolls, so
 * the event is swallowed to keep the wheel from driving page scroll or
 * browser back/forward gestures. */
export function useWheelSteps(onStep: (dir: WheelDir) => void): void {
  const cb = useRef(onStep);
  cb.current = onStep;
  useEffect(() => {
    let ax = 0;
    let ay = 0;
    const onWheel = (e: WheelEvent) => {
      // Normalize line/page deltas to pixels.
      const scale = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? window.innerHeight : 1;
      ax += e.deltaX * scale;
      ay += e.deltaY * scale;
      if (Math.abs(ax) < STEP_PX && Math.abs(ay) < STEP_PX) return;
      e.preventDefault();
      const dir: WheelDir =
        Math.abs(ax) >= Math.abs(ay) ? (ax > 0 ? "right" : "left") : ay > 0 ? "down" : "up";
      ax = 0;
      ay = 0;
      cb.current(dir);
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);
}

export interface DragOptions {
  /** Whether a mouse drag may start right now (screen/menu dependent). */
  enabled: () => boolean;
  /** Pixels per full step (progress is positive when advancing). */
  pitch: () => number;
  /** Clamp range for progress, in step units (e.g. -1..0 with no prev). */
  bounds: () => { min: number; max: number };
  /** Live progress updates while dragging (clamped, step units;
   * positive = advance toward the next item). */
  onProgress: (steps: number) => void;
  /** Release: final progress. The caller commits (|steps| ≥ 0.5 → the
   * nearest item) or springs back — the view always settles centered on
   * the nearest element. */
  onRelease: (steps: number) => void;
}

/** Min pointer travel before a press becomes a drag (px); below it the
 * press stays a plain click (tile select / card stage still work). */
const DRAG_THRESHOLD_PX = 6;

/** Window-level mouse drag: press-hold-move scrubs the active carousel
 * live (fractional step progress); release snaps to the nearest step. The
 * click the browser fires after a drag is swallowed once, so a drag never
 * double-fires as a click. Mouse pointers only — touch keeps its own
 * gesture path (ui/touch.ts). */
export function useMouseDrag(o: DragOptions): void {
  const ref = useRef(o);
  ref.current = o;
  useEffect(() => {
    let start: { x: number; y: number } | null = null;
    let dragging = false;
    let frac = 0;
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      if ((e.target as HTMLElement | null)?.closest("button, a, input, select, textarea, [data-no-gesture]"))
        return;
      if (!ref.current.enabled()) return;
      start = { x: e.clientX, y: e.clientY };
      dragging = false;
      frac = 0;
    };
    const move = (e: PointerEvent) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      if (!dragging && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      const { min, max } = ref.current.bounds();
      // Dragging left (dx < 0) advances the view (positive progress).
      frac = Math.min(max, Math.max(min, -dx / ref.current.pitch()));
      ref.current.onProgress(frac);
    };
    const up = () => {
      if (!start) return;
      const wasDrag = dragging;
      start = null;
      dragging = false;
      if (!wasDrag) return;
      // Swallow the click the browser fires at the end of a drag so it
      // cannot select/enter under the released pointer. Self-removes; a
      // timeout covers the case where no click follows at all.
      const swallow = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
        window.removeEventListener("click", swallow, true);
      };
      window.addEventListener("click", swallow, true);
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 350);
      ref.current.onRelease(frac);
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);
}
