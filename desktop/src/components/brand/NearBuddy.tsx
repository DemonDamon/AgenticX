import { useEffect, useState } from "react";
import { STREAMING_FACE_CYCLE, type NearBuddyMood } from "./near-buddy-mood";

const BODY = "#F9731A";
const EYE = "#F9F9F9";

type EyeDraw =
  | { t: "pill"; x: number; y: number; w: number; h: number; rot?: number }
  | { t: "dot"; cx: number; cy: number; r: number }
  | { t: "ring"; cx: number; cy: number; r: number }
  | { t: "vee"; x: number; y: number; flip?: boolean };

const FACES: Record<Exclude<NearBuddyMood, "working">, [EyeDraw, EyeDraw]> = {
  rest: [
    { t: "pill", x: 18, y: 28, w: 11, h: 8 },
    { t: "pill", x: 35, y: 28, w: 11, h: 8 },
  ],
  listening: [
    { t: "pill", x: 20, y: 20, w: 8, h: 22, rot: -12 },
    { t: "pill", x: 36, y: 20, w: 8, h: 22, rot: 12 },
  ],
  excited: [
    { t: "pill", x: 21, y: 18, w: 7, h: 26 },
    { t: "pill", x: 36, y: 18, w: 7, h: 26 },
  ],
  surprised: [
    { t: "dot", cx: 24, cy: 32, r: 5.4 },
    { t: "dot", cx: 40, cy: 32, r: 5.4 },
  ],
  doubtful: [
    { t: "pill", x: 16, y: 30, w: 16, h: 5 },
    { t: "dot", cx: 44, cy: 32, r: 4.2 },
  ],
  angry: [
    { t: "vee", x: 18, y: 26 },
    { t: "vee", x: 36, y: 26, flip: true },
  ],
  sleepy: [
    { t: "pill", x: 16, y: 31, w: 14, h: 4 },
    { t: "pill", x: 34, y: 31, w: 14, h: 4 },
  ],
  happy: [
    { t: "pill", x: 20, y: 22, w: 8, h: 18, rot: -18 },
    { t: "pill", x: 36, y: 22, w: 8, h: 18, rot: 18 },
  ],
  curious: [
    { t: "dot", cx: 24, cy: 32, r: 4.6 },
    { t: "dot", cx: 40, cy: 32, r: 4.6 },
  ],
  confused: [
    { t: "pill", x: 16, y: 30, w: 15, h: 5 },
    { t: "pill", x: 38, y: 30, w: 10, h: 5 },
  ],
  bored: [
    { t: "pill", x: 15, y: 31, w: 16, h: 4 },
    { t: "pill", x: 33, y: 31, w: 16, h: 4 },
  ],
  smug: [
    { t: "pill", x: 20, y: 22, w: 8, h: 18 },
    { t: "dot", cx: 42, cy: 33, r: 3.4 },
  ],
  shy: [
    { t: "dot", cx: 24, cy: 34, r: 3.2 },
    { t: "dot", cx: 40, cy: 34, r: 3.2 },
  ],
  sad: [
    { t: "pill", x: 18, y: 30, w: 12, h: 5, rot: 16 },
    { t: "pill", x: 34, y: 30, w: 12, h: 5, rot: -16 },
  ],
  laugh: [
    { t: "pill", x: 19, y: 30, w: 10, h: 6 },
    { t: "pill", x: 35, y: 30, w: 10, h: 6 },
  ],
  scared: [
    { t: "ring", cx: 24, cy: 32, r: 6 },
    { t: "ring", cx: 40, cy: 32, r: 6 },
  ],
  playful: [
    { t: "pill", x: 20, y: 20, w: 8, h: 22 },
    { t: "pill", x: 36, y: 20, w: 8, h: 22 },
  ],
};

function EyeMark({ eye }: { eye: EyeDraw }) {
  if (eye.t === "dot") {
    return <circle cx={eye.cx} cy={eye.cy} r={eye.r} fill={EYE} />;
  }
  if (eye.t === "ring") {
    return <circle cx={eye.cx} cy={eye.cy} r={eye.r} fill="none" stroke={EYE} strokeWidth="3.4" />;
  }
  if (eye.t === "vee") {
    const d = eye.flip ? "M14 8 L7 2 L0 8" : "M0 8 L7 2 L14 8";
    return (
      <g transform={`translate(${eye.x} ${eye.y})`}>
        <path d={d} fill="none" stroke={EYE} strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    );
  }
  const rot = eye.rot ?? 0;
  const cx = eye.x + eye.w / 2;
  const cy = eye.y + eye.h / 2;
  return (
    <rect
      x={eye.x}
      y={eye.y}
      width={eye.w}
      height={eye.h}
      rx={Math.min(eye.w, eye.h) / 2}
      fill={EYE}
      transform={rot ? `rotate(${rot} ${cx} ${cy})` : undefined}
    />
  );
}

function Face({ mood }: { mood: Exclude<NearBuddyMood, "working"> }) {
  const [left, right] = FACES[mood];
  return (
    <>
      <EyeMark eye={left} />
      <EyeMark eye={right} />
    </>
  );
}

export function NearBuddy({
  mood = "rest",
  size = 44,
  className = "",
  title,
  cycleMs = 1600,
}: {
  mood?: NearBuddyMood;
  size?: number;
  className?: string;
  title?: string;
  cycleMs?: number;
}) {
  const cycling = mood === "working";
  const [cycleIndex, setCycleIndex] = useState(0);

  useEffect(() => {
    if (!cycling) {
      setCycleIndex(0);
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const timer = window.setInterval(() => {
      setCycleIndex((n) => n + 1);
    }, cycleMs);
    return () => window.clearInterval(timer);
  }, [cycling, cycleMs]);

  const shown = cycling
    ? STREAMING_FACE_CYCLE[cycleIndex % STREAMING_FACE_CYCLE.length]
    : mood === "working"
      ? "listening"
      : mood;

  return (
    <div
      className={`agx-near-buddy ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden={title ? undefined : true}
      title={title}
    >
      <svg viewBox="0 0 64 64" width={size} height={size} fill="none">
        <rect x="4" y="4" width="56" height="56" rx="18" fill={BODY} />
        <Face mood={shown} />
      </svg>
    </div>
  );
}
