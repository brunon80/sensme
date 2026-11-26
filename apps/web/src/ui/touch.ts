// Touch gesture recognition (UI_SPEC §9): touch pointer sequences map onto
// PSP input semantics — tap = ◯/START, horizontal swipe = D-pad ←/→ (or
// L/R on now-playing), vertical swipe = D-pad ↑/↓ (or SELECT). Gestures are
// only classified here; the actions themselves run through App's shared
// action dispatcher, so touch and keyboard behaviour cannot drift.
import { useEffect, useRef } from "react";

export type GestureDir = "left" | "right" | "up" | "down";

export interface TapGesture {
  type: "tap";
  x: number;
  y: number;
}

export interface SwipeGesture {
  type: "swipe";
  dir: GestureDir;
}

export type Gesture = TapGesture | SwipeGesture;

export interface GestureLimits {
  /** Max pointer travel still counted as a tap (px). */
  tapMaxDist: number;
  /** Max tap duration (ms). */
  tapMaxMs: number;
  /** Min travel along the dominant axis for a swipe (px). */
  swipeMinDist: number;
}

export const DEFAULT_LIMITS: GestureLimits = { tapMaxDist: 24, tapMaxMs: 500, swipeMinDist: 40 };

/** Classify one pointer down→up sequence. `dx`/`dy` are end-minus-start
 * client coordinates; `dt` is the duration in ms. Null = no gesture. */
export function classifyGesture(
  dx: number,
  dy: number,
  dt: number,
  l: GestureLimits = DEFAULT_LIMITS,
): { type: "tap" } | SwipeGesture | null {
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx <= l.tapMaxDist && ady <= l.tapMaxDist && dt <= l.tapMaxMs) return { type: "tap" };
  if (Math.max(adx, ady) < l.swipeMinDist) return null;
  if (adx >= ady) return { type: "swipe", dir: dx < 0 ? "left" : "right" };
  return { type: "swipe", dir: dy < 0 ? "up" : "down" };
}

/** Window-level touch gesture listener. Only `pointerType === "touch"`
 * sequences are considered, and sequences that start on an interactive
 * element (buttons etc.) are ignored so caption buttons never double-fire. */
export function useTouchGestures(onGesture: (g: Gesture) => void): void {
  const cb = useRef(onGesture);
  cb.current = onGesture;
  useEffect(() => {
    let start: { x: number; y: number; t: number; id: number } | null = null;
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      if ((e.target as HTMLElement | null)?.closest("button, a, input, select, textarea, [data-no-gesture]"))
        return;
      start = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    };
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const s = start;
      start = null;
      const g = classifyGesture(e.clientX - s.x, e.clientY - s.y, performance.now() - s.t);
      if (g) cb.current(g.type === "tap" ? { ...g, x: e.clientX, y: e.clientY } : g);
    };
    const cancel = (e: PointerEvent) => {
      if (start && e.pointerId === start.id) start = null;
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, []);
}
