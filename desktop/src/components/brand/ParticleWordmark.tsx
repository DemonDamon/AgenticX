import { useEffect, useRef } from "react";
import { useAppStore } from "../../store";
import { APP_DISPLAY_NAME, APP_TAGLINE } from "../../constants/branding";

type DriftOpts = {
  text: string;
  fontSize: number;
  particleSize: number;
  particleCount: number;
  maxParticles: number;
  letterSpacing?: string;
  formDelay?: number;
};

function startDrift(
  container: HTMLElement,
  canvas: HTMLCanvasElement,
  opts: DriftOpts,
  palette: string[],
): () => void {
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return () => {};

  const reduceMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const particleSize = opts.particleSize;
  const particleCount = opts.particleCount;
  const maxParticles = opts.maxParticles;
  const fontSize = opts.fontSize;
  const letterSpacing = opts.letterSpacing || "0";
  const formDelay = reduceMotion ? 0 : opts.formDelay ?? 0;
  const formMs = reduceMotion ? 0 : 900;

  let formVal = 0;
  let lastFrame: number | null = null;
  let hidden = true;
  let rafLoop = 0;
  let idleTimer = 0;
  let sampleStride = 3;
  let count = 0;
  let ox = new Float32Array(0);
  let oy = new Float32Array(0);
  let sx = new Float32Array(0);
  let sy = new Float32Array(0);
  let px = new Float32Array(0);
  let py = new Float32Array(0);
  let repX = new Float32Array(0);
  let repY = new Float32Array(0);
  let cIdx = new Uint8Array(0);
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  const buckets = palette.map(() => [] as number[]);
  const mcEnabled = !reduceMotion;
  const pointer = { x: -99999, y: -99999, active: false };
  let prevMx = -99999;
  let prevMy = -99999;
  let mouseSpeed = 0;
  let smoothX = -99999;
  let smoothY = -99999;

  const sampleText = () => {
    const W = cssW;
    const H = cssH;
    if (W <= 0 || H <= 0) return;
    const off = document.createElement("canvas");
    off.width = Math.max(1, Math.floor(W * dpr));
    off.height = Math.max(1, Math.floor(H * dpr));
    const offCtx = off.getContext("2d", { willReadFrequently: true });
    if (!offCtx) return;
    offCtx.scale(dpr, dpr);
    const family =
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif';
    offCtx.font = `700 ${fontSize}px ${family}`;
    if (offCtx.letterSpacing !== undefined) offCtx.letterSpacing = letterSpacing;
    offCtx.textAlign = "center";
    offCtx.textBaseline = "middle";
    offCtx.clearRect(0, 0, W, H);
    offCtx.fillStyle = "#fff";
    offCtx.fillText(opts.text, W / 2, H / 2);

    const img = offCtx.getImageData(0, 0, Math.floor(W * dpr), Math.floor(H * dpr));
    const data = img.data;
    const stride = Math.max(2, Math.round(150 / Math.max(1, Math.min(80, particleCount))));
    sampleStride = stride;

    const pts: Array<[number, number]> = [];
    for (let y = 0; y < H; y += stride) {
      for (let x = 0; x < W; x += stride) {
        const idx = (Math.floor(y * dpr) * img.width + Math.floor(x * dpr)) * 4 + 3;
        if (data[idx] > 128) pts.push([x, y]);
      }
    }
    const downsample = pts.length > maxParticles ? Math.ceil(pts.length / maxParticles) : 1;
    const picked = pts.filter((_, i) => i % downsample === 0).slice(0, maxParticles);
    count = picked.length;
    ox = new Float32Array(count);
    oy = new Float32Array(count);
    sx = new Float32Array(count);
    sy = new Float32Array(count);
    px = new Float32Array(count);
    py = new Float32Array(count);
    repX = new Float32Array(count);
    repY = new Float32Array(count);
    cIdx = new Uint8Array(count);
    picked.forEach(([x, y], i) => {
      ox[i] = x;
      oy[i] = y;
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.max(W, H) * (0.55 + Math.random() * 0.45);
      sx[i] = W / 2 + Math.cos(ang) * rad;
      sy[i] = H / 2 + Math.sin(ang) * rad;
      px[i] = sx[i];
      py[i] = sy[i];
      cIdx[i] = Math.floor(Math.random() * palette.length);
    });
    formVal = 0;
    lastFrame = null;
  };

  const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

  const drawFrame = () => {
    if (hidden) return;
    ctx.clearRect(0, 0, cssW, cssH);
    const drawSize = Math.max(1.3, particleSize / 4, sampleStride * 0.85);
    const half = drawSize / 2;
    const now = performance.now();
    const dt = lastFrame == null ? 16 : Math.min(64, Math.max(0, now - lastFrame));
    lastFrame = now;
    if (formMs <= 0) formVal = 1;
    else formVal = Math.min(1, formVal + dt / formMs);
    const factor = easeOut(formVal);
    const forming = formVal < 1;
    const hitSpeed = mouseSpeed;
    mouseSpeed *= 0.88;
    const mcRadius = Math.max(40, Math.min(72, Math.min(cssW, cssH) * 0.62));
    const mcForce = 30;
    const active = !forming && mcEnabled && pointer.active;
    if (active) {
      const lerpFactor = Math.max(0.08, 0.3 - hitSpeed * 0.006);
      if (smoothX < -9000) {
        smoothX = pointer.x;
        smoothY = pointer.y;
      } else {
        smoothX += (pointer.x - smoothX) * lerpFactor;
        smoothY += (pointer.y - smoothY) * lerpFactor;
      }
    } else {
      smoothX = -99999;
      smoothY = -99999;
    }
    const mx = smoothX;
    const my = smoothY;
    const repCutoffSq = mcRadius * mcRadius;
    const wave = now * 0.00115;
    for (const bucket of buckets) bucket.length = 0;
    for (let i = 0; i < count; i++) {
      const oxi = ox[i]!;
      const oyi = oy[i]!;
      if (forming) {
        px[i] = sx[i]! + (oxi - sx[i]!) * factor;
        py[i] = sy[i]! + (oyi - sy[i]!) * factor;
        buckets[cIdx[i]!]?.push(i);
        continue;
      }
      let inZone = false;
      if (active) {
        const dx = oxi - mx;
        const dy = oyi - my;
        const distSq = dx * dx + dy * dy;
        if (distSq > 0 && distSq < repCutoffSq) {
          const dist = Math.sqrt(distSq);
          const nx = dx / dist;
          const ny = dy / dist;
          const falloff = 1 - dist / mcRadius;
          const push = falloff * hitSpeed * mcForce * 0.05;
          repX[i] = (repX[i] ?? 0) + nx * push;
          repY[i] = (repY[i] ?? 0) + ny * push;
          const targetRepX = nx * (mcRadius - dist);
          const targetRepY = ny * (mcRadius - dist);
          repX[i] = (repX[i] ?? 0) + (targetRepX - (repX[i] ?? 0)) * 0.06;
          repY[i] = (repY[i] ?? 0) + (targetRepY - (repY[i] ?? 0)) * 0.06;
          inZone = true;
        }
      }
      if (!inZone) {
        repX[i] = (repX[i] ?? 0) * 0.97;
        repY[i] = (repY[i] ?? 0) * 0.97;
      }
      px[i] = oxi + (repX[i] ?? 0) + Math.sin(wave + i * 0.41) * 0.65;
      py[i] = oyi + (repY[i] ?? 0) + Math.cos(wave * 0.85 + i * 0.27) * 0.4;
      buckets[cIdx[i]!]?.push(i);
    }
    ctx.globalAlpha = forming ? Math.min(1, factor) : 1;
    buckets.forEach((bucket, b) => {
      if (!bucket.length) return;
      ctx.fillStyle = palette[b] ?? palette[0]!;
      for (const i of bucket) {
        ctx.fillRect(px[i]! - half, py[i]! - half, drawSize, drawSize);
      }
    });
    ctx.globalAlpha = 1;
  };

  const clearSched = () => {
    if (rafLoop) cancelAnimationFrame(rafLoop);
    if (idleTimer) window.clearTimeout(idleTimer);
    rafLoop = 0;
    idleTimer = 0;
  };

  const wakeLoop = () => {
    if (idleTimer) {
      window.clearTimeout(idleTimer);
      idleTimer = 0;
    }
    resumeLoop();
  };

  const resumeLoop = () => {
    if (rafLoop || idleTimer) return;
    rafLoop = requestAnimationFrame(() => {
      rafLoop = 0;
      drawFrame();
      if (hidden) return;
      const idle =
        formVal >= 1 && !pointer.active && mouseSpeed < 0.2;
      if (idle) {
        idleTimer = window.setTimeout(() => {
          idleTimer = 0;
          resumeLoop();
        }, 48);
      } else {
        resumeLoop();
      }
    });
  };

  const resize = () => {
    const rect = container.getBoundingClientRect();
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);
    if (w <= 1 || h <= 1) return;
    const nextDpr = Math.max(1, Math.min(1.5, window.devicePixelRatio || 1));
    if (w === cssW && h === cssH && nextDpr === dpr) return;
    dpr = nextDpr;
    cssW = w;
    cssH = h;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sampleText();
    resumeLoop();
  };

  const hitPad = 16;
  const onMove = (e: PointerEvent) => {
    if (!mcEnabled) return;
    const rect = canvas.getBoundingClientRect();
    const inside =
      e.clientX >= rect.left - hitPad &&
      e.clientX <= rect.right + hitPad &&
      e.clientY >= rect.top - hitPad &&
      e.clientY <= rect.bottom + hitPad;
    if (!inside) {
      if (pointer.active) onLeave();
      return;
    }
    const scaleX = rect.width > 0 ? cssW / rect.width : 1;
    const scaleY = rect.height > 0 ? cssH / rect.height : 1;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    if (prevMx > -9000) {
      const ddx = mx - prevMx;
      const ddy = my - prevMy;
      mouseSpeed = Math.sqrt(ddx * ddx + ddy * ddy);
    }
    prevMx = mx;
    prevMy = my;
    pointer.x = mx;
    pointer.y = my;
    pointer.active = true;
    wakeLoop();
  };

  const onLeave = () => {
    pointer.x = -99999;
    pointer.y = -99999;
    pointer.active = false;
    prevMx = -99999;
    prevMy = -99999;
    wakeLoop();
  };

  const enterTimers = [
    window.setTimeout(() => {
      hidden = false;
      resumeLoop();
    }, 40 + formDelay),
  ];
  hidden = true;
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  // Flex shrink-wrap can report 0×H on the first paint; retry after layout.
  [32, 120, 360].forEach((ms) => {
    enterTimers.push(window.setTimeout(resize, ms));
  });

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerleave", onLeave);
  document.addEventListener("pointercancel", onLeave);
  document.addEventListener("pointerdown", onMove);

  return () => {
    clearSched();
    enterTimers.forEach((id) => window.clearTimeout(id));
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerleave", onLeave);
    document.removeEventListener("pointercancel", onLeave);
    document.removeEventListener("pointerdown", onMove);
    ro.disconnect();
  };
}

export function ParticleWordmark({
  title = APP_DISPLAY_NAME.toUpperCase(),
  tagline = APP_TAGLINE,
}: {
  title?: string;
  tagline?: string;
}) {
  const theme = useAppStore((s) => s.theme);
  const titleWrap = useRef<HTMLDivElement>(null);
  const tagWrap = useRef<HTMLDivElement>(null);
  const titleCanvas = useRef<HTMLCanvasElement>(null);
  const tagCanvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const palette =
      theme === "light"
        ? ["#1C1C1E", "#F9731A", "#1C1C1E"]
        : ["#FFFFFF", "#F9731A", "#FFFFFF"];
    const stops: Array<() => void> = [];
    if (titleWrap.current && titleCanvas.current) {
      stops.push(
        startDrift(titleWrap.current, titleCanvas.current, {
          text: title,
          fontSize: 112,
          particleSize: 9,
          particleCount: 50,
          maxParticles: 2200,
        }, palette),
      );
    }
    if (tagWrap.current && tagCanvas.current) {
      stops.push(
        startDrift(tagWrap.current, tagCanvas.current, {
          text: tagline.toUpperCase(),
          fontSize: 26,
          particleSize: 6,
          particleCount: 70,
          maxParticles: 1300,
          letterSpacing: "0.08em",
          formDelay: 140,
        }, palette),
      );
    }
    return () => stops.forEach((stop) => stop());
  }, [theme, title, tagline]);

  return (
    <div className="pointer-events-auto mx-auto flex w-[min(36rem,100%)] min-w-[20rem] cursor-default flex-col items-center gap-2 select-none">
      <div ref={titleWrap} className="relative h-[118px] w-full">
        <canvas ref={titleCanvas} className="absolute inset-0 h-full w-full" />
      </div>
      <div ref={tagWrap} className="relative h-[44px] w-[min(28rem,100%)]">
        <canvas ref={tagCanvas} className="absolute inset-0 h-full w-full" />
      </div>
    </div>
  );
}
