// Full-screen animated scene: static backdrop + water reflection (UI_SPEC §0).
import { useEffect, useRef } from "react";
import { drawScene, renderBackdrop } from "./scene";

interface Props {
  /** Backdrop identity key (channel id); changing it regenerates the scene. */
  sceneKey: string;
  hues: readonly string[];
}

export function Scene({ sceneKey, hues }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backdropRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      backdropRef.current = renderBackdrop(
        sceneKey,
        hues,
        canvas.width,
        canvas.height,
      );
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    const t0 = performance.now();
    const frame = () => {
      if (backdropRef.current) {
        drawScene(ctx, backdropRef.current, canvas.width, canvas.height, (performance.now() - t0) / 1000);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [sceneKey, hues]);

  return <canvas ref={canvasRef} className="scene" aria-hidden="true" />;
}
