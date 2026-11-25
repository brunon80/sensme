// Full-screen animated scene: static backdrop + water reflection (UI_SPEC §0).
// On channel change the backdrop crossfades over `motion.channelSwitchMs`
// (UI_SPEC §1: "channel switch crossfades backdrop").
import { useEffect, useRef } from "react";
import { tokens } from "../../../../contracts/design-tokens/tokens";
import { crossfade, drawScene, renderBackdrop } from "./scene";

interface Props {
  /** Backdrop identity key (channel id); changing it crossfades the scene. */
  sceneKey: string;
  hues: readonly string[];
}

export function Scene({ sceneKey, hues }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Current + previous backdrop during a crossfade; blend into `mix`.
  const curRef = useRef<HTMLCanvasElement | null>(null);
  const prevRef = useRef<HTMLCanvasElement | null>(null);
  const mixRef = useRef<HTMLCanvasElement | null>(null);
  const fadeStartRef = useRef<number>(-1);
  const dimsRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const keyRef = useRef({ sceneKey, hues });
  keyRef.current = { sceneKey, hues };

  const make = () => {
    const { w, h } = dimsRef.current;
    if (w === 0 || h === 0) return;
    curRef.current = renderBackdrop(keyRef.current.sceneKey, keyRef.current.hues, w, h);
  };

  // One stable rAF loop + resize handling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(window.innerWidth * dpr);
      const h = Math.round(window.innerHeight * dpr);
      canvas.width = w;
      canvas.height = h;
      dimsRef.current = { w, h };
      mixRef.current = document.createElement("canvas");
      mixRef.current.width = w;
      mixRef.current.height = h;
      prevRef.current = null;
      fadeStartRef.current = -1;
      make();
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    const t0 = performance.now();
    const frame = () => {
      const cur = curRef.current;
      if (cur) {
        let backdrop = cur;
        const prev = prevRef.current;
        if (prev && fadeStartRef.current >= 0) {
          const p = Math.min(1, (performance.now() - fadeStartRef.current) / tokens.motion.channelSwitchMs);
          const mix = mixRef.current!;
          crossfade(mix, prev, cur, p);
          backdrop = mix;
          if (p >= 1) {
            prevRef.current = null;
            fadeStartRef.current = -1;
          }
        }
        drawScene(ctx, backdrop, canvas.width, canvas.height, (performance.now() - t0) / 1000);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On channel change: keep the old backdrop, build the new one, start crossfade.
  useEffect(() => {
    if (!curRef.current) {
      make();
      return;
    }
    prevRef.current = curRef.current;
    make();
    fadeStartRef.current = performance.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey, hues]);

  return <canvas ref={canvasRef} className="scene" aria-hidden="true" />;
}
