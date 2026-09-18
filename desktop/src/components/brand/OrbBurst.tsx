import { useEffect, useRef } from "react";
import { useAppStore } from "../../store";
import { orbBurstColors } from "./orb-burst-colors";

const MAX_DPR = 2;
const TAU = Math.PI * 2;
const PERIOD = 6;
const BASE_SPREAD = 0.3;
const SPEED = 64 / 50;
const REST_YAW = -Math.PI;
const REST_PITCH = (16 * Math.PI) / 180;
const PERSPECTIVE = 3.5;
const DEPTH_SIZE = 1;
const DEPTH_FADE = 1;
const MIN_RADIUS = 0.6;
const MAX_DOTS = 1024;

type Dot = [number, number, number, number?, number?, string?];
type Params = {
  n: number;
  sp: number;
  ds: number;
  yw: number;
  sn: number;
  pc: number;
  t: number;
  dot: string;
  acc: string;
};
type Emit = (x: number, y: number, r: number, a: number, col: string) => void;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function dotsN(base: number, n: number): number {
  const v = Math.round(base * n);
  return v < 1 ? 1 : v;
}

function spin(p: Dot, yaw: number, pitch: number): Dot {
  const ca = Math.cos(yaw);
  const sa = Math.sin(yaw);
  const rx = p[0] * ca - p[2] * sa;
  let rz = p[0] * sa + p[2] * ca;
  const co = Math.cos(pitch);
  const so = Math.sin(pitch);
  const ry = p[1] * co - rz * so;
  rz = p[1] * so + rz * co;
  return [rx, ry, rz, p[3], p[4], p[5]];
}

function frame(t: number, P: Params, out: Dot[]) {
  const n = dotsN(150, P.n);
  const turns = 2 + 6 * (0.5 - 0.5 * Math.cos(TAU * t));
  for (let i = 0; i < n; i += 1) {
    const u = (i / n + t) % 1;
    const th = Math.PI * u;
    const sr = Math.sin(th);
    const az = u * TAU * turns + TAU * t;
    const f = Math.pow(Math.sin(Math.PI * u), 0.45);
    out.push(
      spin(
        [Math.cos(az) * sr, Math.cos(th), Math.sin(az) * sr, 0.6 + 0.9 * f, f, i % 15 === 0 ? P.acc : P.dot],
        0.3,
        0.36,
      ),
    );
  }
}

function project(pts: Dot[], size: number, P: Params, emit: Emit) {
  const c = size / 2;
  const R = size * BASE_SPREAD * P.sp;
  const pv = PERSPECTIVE;
  const yaw = P.yw + TAU * P.sn * P.t;
  const list: Array<[number, number, number, number, string, number]> = [];
  for (const p of pts) {
    const q = spin(p, yaw, P.pc);
    const z = q[2];
    const s = pv / (pv - z);
    const f = clamp01((z + 1.1) / 2.2);
    list.push([
      c + q[0] * R * s,
      c + q[1] * R * s,
      P.ds * (0.4 + 1.6 * DEPTH_SIZE * f) * s * (q[3] === undefined ? 1 : q[3]),
      (0.07 + 0.93 * Math.pow(f, 1.55 * DEPTH_FADE)) * (q[4] === undefined ? 1 : q[4]),
      q[5] || P.dot,
      z,
    ]);
  }
  list.sort((a, b) => a[5] - b[5]);
  for (const d of list) emit(d[0], d[1], d[2], d[3], d[4]);
}

const fitCache = new Map<string, number>();

function autoFit(size: number, P: Params, restYaw: number, restPitch: number): number {
  const key = `${size}/${P.n}/${P.sp}/${restYaw}/${restPitch}/${P.sn}`;
  const hit = fitCache.get(key);
  if (hit !== undefined) return hit;
  const half = size / 2;
  let ext = 0;
  const probe: Params = { ...P, ds: 1, dot: "#fff", acc: "#fff", t: 0, yw: restYaw, pc: restPitch };
  const emit: Emit = (x, y, r, a) => {
    if (a <= 0.05 || r <= 0.15) return;
    ext = Math.max(ext, Math.abs(x - half) + 0.5 * r, Math.abs(y - half) + 0.5 * r);
  };
  for (let k = 0; k < 20; k += 1) {
    probe.t = k / 20;
    const out: Dot[] = [];
    frame(probe.t, probe, out);
    project(out, size, probe, emit);
  }
  const fit = ext > 1 ? Math.max(0.55, Math.min(1.7, (0.415 * size) / ext)) : 1;
  fitCache.set(key, fit);
  return fit;
}

function dotScaleFor(size: number): number {
  if (size <= 46) return 0.4;
  if (size <= 190) return 0.4 + ((size - 46) / 144) * 0.6;
  if (size <= 340) return 1 + ((size - 190) / 150) * 0.55;
  return 1.55;
}

type RGBA = [number, number, number, number];

function parseColor(input: string | undefined, fb: RGBA): RGBA {
  if (!input) return fb;
  const str = String(input).trim();
  if (str.charAt(0) === "#") {
    let hex = str.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2] + (hex.length === 4 ? hex[3] + hex[3] : "");
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) return [r, g, b, a];
    }
    return fb;
  }
  const m = str.match(/[\d.]+/g);
  if (m && m.length >= 3) {
    return [
      Math.min(255, parseFloat(m[0])),
      Math.min(255, parseFloat(m[1])),
      Math.min(255, parseFloat(m[2])),
      m.length >= 4 ? Math.min(1, parseFloat(m[3])) : 1,
    ];
  }
  return fb;
}

function css(c: RGBA): string {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${c[3]})`;
}

export function OrbBurst({
  width = 32,
  height = 32,
  className = "",
}: {
  width?: number;
  height?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const themeColor = useAppStore((s) => s.themeColor);
  const theme = useAppStore((s) => s.theme);
  const colors = orbBurstColors(themeColor, theme);
  const colorRef = useRef(colors);
  colorRef.current = colors;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    let phase = 0;
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const render = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const cw = width;
      const ch = height;
      const bw = Math.max(1, Math.round(cw * dpr));
      const bh = Math.max(1, Math.round(ch * dpr));
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);

      if (!reduce) {
        phase = (phase + (dt * SPEED) / PERIOD) % 1;
        if (phase < 0) phase += 1;
      }

      const size = Math.max(4, Math.min(cw, ch));
      const bx = (cw - size) / 2;
      const by = (ch - size) / 2;
      const live = colorRef.current;
      const dotCol = css(parseColor(live.dot, [249, 115, 26, 1]));
      const accCol = css(parseColor(live.accent, [251, 174, 122, 1]));
      const P: Params = {
        n: 3,
        sp: 1.8,
        ds: dotScaleFor(size) * 0.6,
        yw: REST_YAW,
        sn: 3,
        pc: REST_PITCH,
        t: phase,
        dot: dotCol,
        acc: accCol,
      };
      const fit = autoFit(size, P, REST_YAW, REST_PITCH);
      const half = size / 2;
      const out: Dot[] = [];
      frame(phase, P, out);
      let drawn = 0;
      project(out, size, P, (x, y, r, a, col) => {
        if (drawn >= MAX_DOTS) return;
        const rr = r * (0.55 + 0.45 * fit);
        if (rr <= 0.05 || a <= 0.004) return;
        const cx = bx + half + (x - half) * fit;
        const cy = by + half + (y - half) * fit;
        let dr = rr;
        let da = Math.min(1, a);
        if (dr < MIN_RADIUS) {
          da *= (dr / MIN_RADIUS) * (dr / MIN_RADIUS);
          dr = MIN_RADIUS;
        }
        ctx.globalAlpha = da;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(cx, cy, dr, 0, TAU);
        ctx.fill();
        drawn += 1;
      });
      ctx.globalAlpha = 1;
      if (!reduce) raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [width, height]);

  return (
    <div
      data-part="orb-burst"
      data-orb="winding"
      data-optical-x="-3"
      data-accent={themeColor}
      data-dot-color={colors.dot}
      data-accent-color={colors.accent}
      className={`agx-orb-burst ${className}`.trim()}
      style={{
        position: "relative",
        overflow: "hidden",
        width,
        height,
        flexShrink: 0,
        transform: "translateX(-3px)",
      }}
      aria-hidden
    >
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      />
    </div>
  );
}
