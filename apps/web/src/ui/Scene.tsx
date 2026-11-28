// Full-screen animated scene: static backdrop + water reflection (UI_SPEC §0).
// On channel change the backdrop crossfades over `motion.channelSwitchMs`
// (UI_SPEC §1: "channel switch crossfades backdrop").
import { useEffect, useRef } from "react";
import { tokens } from "../../../../contracts/design-tokens/tokens";
import { crossfade, DEFAULT_PHOTO, drawScene, loadPhoto, PHOTO_MAP, photoUrlFor, renderBackdrop, renderBackdropPhoto, renderCardLayer } from "./scene";
import { WaterRenderer } from "./water";

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
  const photosRef = useRef<Map<string, HTMLImageElement>>(new Map());
  // Album-card layer mirrored by the water (see renderCardLayer) + its
  // change signature, so the texture is only re-uploaded when cards move.
  const cardsRef = useRef<HTMLCanvasElement | null>(null);
  const cardSigRef = useRef({ v: "" });
  const keyRef = useRef({ sceneKey, hues });
  keyRef.current = { sceneKey, hues };

  const make = () => {
    const { w, h } = dimsRef.current;
    if (w === 0 || h === 0) return;
    const photo = photosRef.current.get(photoUrlFor(keyRef.current.sceneKey));
    curRef.current = photo
      ? renderBackdropPhoto(photo, w, h)
      : renderBackdrop(keyRef.current.sceneKey, keyRef.current.hues, w, h);
  };

  // Load all test photos once; when ready, rebuild the current backdrop.
  useEffect(() => {
    let alive = true;
    const urls = [...new Set(Object.values(PHOTO_MAP).concat(DEFAULT_PHOTO))];
    void Promise.allSettled(urls.map((u) => loadPhoto(u))).then((res) => {
      if (!alive) return;
      urls.forEach((u, i) => {
        const r = res[i]!;
        if (r.status === "fulfilled") photosRef.current.set(u, r.value);
      });
      const { w, h } = dimsRef.current;
      if (w && h) make();
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One stable rAF loop + resize handling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // WebGL water (per-pixel 3D ripple distortion); Canvas-2D fallback
    // when WebGL is unavailable.
    const water = WaterRenderer.create(canvas);
    const ctx = water ? null : canvas.getContext("2d")!;

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
      cardsRef.current = document.createElement("canvas");
      cardsRef.current.width = w;
      cardsRef.current.height = h;
      cardSigRef.current.v = "";
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
        let fading = false;
        if (prev && fadeStartRef.current >= 0) {
          const p = Math.min(1, (performance.now() - fadeStartRef.current) / tokens.motion.channelSwitchMs);
          const mix = mixRef.current!;
          crossfade(mix, prev, cur, p);
          backdrop = mix;
          fading = p < 1;
          if (p >= 1) {
            prevRef.current = null;
            fadeStartRef.current = -1;
          }
        }
        const t = (performance.now() - t0) / 1000;
        const cards = cardsRef.current;
        const cardsDirty = cards ? renderCardLayer(cards, canvas.width, canvas.height, cardSigRef.current) : false;
        if (water) water.draw(backdrop, cards, canvas.width, canvas.height, t, fading, cardsDirty);
        else if (ctx) drawScene(ctx, backdrop, cards, canvas.width, canvas.height, t);
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
