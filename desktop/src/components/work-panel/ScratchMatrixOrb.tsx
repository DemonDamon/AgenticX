/**
 * Compact matrix mark shown beside a live scratch-chat status line.
 *
 * Author: Damon Li
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const TAU = Math.PI * 2;
const ORBITERS = [
  { radius: 0.62, speed: 2.2, phase: 0, spread: 0.42 },
  { radius: 0.4, speed: -1.7, phase: 2.1, spread: 0.36 },
  { radius: 0.8, speed: 1.15, phase: 4, spread: 0.34 },
];

function subscribeZoom(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function useDevicePixelRatio() {
  return useSyncExternalStore(
    subscribeZoom,
    () => Math.min(window.devicePixelRatio || 1, 4),
    () => 1,
  );
}

export function ScratchMatrixOrb({ size = 20, dots = 7 }: { size?: number; dots?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLSpanElement>(null);
  const dpr = useDevicePixelRatio();
  const [color, setColor] = useState("");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const sync = () => {
      const next = getComputedStyle(host).color;
      if (next) setColor(next);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !color) return;

    const buffer = Math.round(size * dpr);
    canvas.width = canvas.height = buffer;
    ctx.setTransform(buffer / size, 0, 0, buffer / size, 0, 0);
    ctx.fillStyle = color;

    const grid = Math.max(3, Math.round(dots));
    const half = (grid - 1) / 2;
    const spacing = (size * 0.82) / (grid - 1);
    const maxRadius = spacing * 0.42;
    const center = size / 2;

    const draw = (t: number) => {
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = color;
      for (let iy = 0; iy < grid; iy += 1) {
        for (let ix = 0; ix < grid; ix += 1) {
          const nx = half === 0 ? 0 : (ix - half) / half;
          const ny = half === 0 ? 0 : (iy - half) / half;
          let heat = 0;
          for (const orbiter of ORBITERS) {
            const angle = t * orbiter.speed + orbiter.phase;
            const dx = nx - Math.cos(angle) * orbiter.radius;
            const dy = ny - Math.sin(angle) * orbiter.radius;
            heat += Math.exp(-(dx * dx + dy * dy) / (orbiter.spread * orbiter.spread));
          }
          const glow = Math.min(1, heat);
          const alpha = 0.42 + 0.58 * glow;
          const radius = maxRadius * (0.72 + 0.28 * glow);
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.arc(center + (ix - half) * spacing, center + (iy - half) * spacing, radius, 0, TAU);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      draw(0.8);
      return;
    }

    let raf = 0;
    const started = performance.now();
    const frame = (now: number) => {
      draw((now - started) / 1000);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [color, dots, dpr, size]);

  return (
    <span
      ref={hostRef}
      data-slot="scratch-matrix-orb"
      className="inline-flex shrink-0 text-text-strong"
      aria-hidden
    >
      <canvas ref={canvasRef} className="block" style={{ width: size, height: size }} />
    </span>
  );
}

export function ScratchWaveText({ text }: { text: string }) {
  const glyphs = Array.from(text);
  return (
    <span className="scratch-wave-text" aria-label={text}>
      {glyphs.map((glyph, index) => (
        <span key={`${glyph}-${index}`} style={{ animationDelay: `${index * 0.12}s` }} aria-hidden>
          {glyph === " " ? "\u00a0" : glyph}
        </span>
      ))}
    </span>
  );
}
