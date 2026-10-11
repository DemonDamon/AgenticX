export type NearBoxMoodId =
  | "rest"
  | "curious"
  | "smug"
  | "happy"
  | "laugh"
  | "listening"
  | "excited"
  | "surprised";

export type EyeShapeId =
  | "restSoft"
  | "restLean"
  | "listenTall"
  | "listenLean"
  | "listenSoft"
  | "joyTall"
  | "joyHuge"
  | "joyWide"
  | "roundOpen"
  | "roundWide"
  | "smugSlim"
  | "curiousDot";

export type SensorKind = "oval";

export type SensorMark = {
  kind: SensorKind;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotate: number;
};

export type Gaze = { x: number; y: number };

export const FACE_LEFT = { cx: 106, cy: 104 } as const;
export const FACE_RIGHT = { cx: 128, cy: 92 } as const;

/** Conservative AABB of the right-front cube face, in viewBox units. */
export const RIGHT_FACE_BOUNDS = {
  minX: 86,
  maxX: 140,
  minY: 70,
  maxY: 140,
} as const;

export const NEAR_BOX_MOOD_CYCLE: readonly NearBoxMoodId[] = [
  "rest",
  "curious",
  "smug",
  "happy",
  "laugh",
  "listening",
  "excited",
  "surprised",
];

const GLANCE_MOODS = NEAR_BOX_MOOD_CYCLE.filter((mood) => mood !== "rest");

export const NEAR_BOX_MOOD_HOLD: Record<NearBoxMoodId, readonly [number, number]> = {
  rest: [9000, 16000],
  curious: [1800, 3200],
  smug: [3500, 6000],
  happy: [2500, 4500],
  laugh: [1200, 2400],
  listening: [2800, 5000],
  excited: [1100, 2000],
  surprised: [2500, 4000],
};

export const EYE_HOP_MS: Record<NearBoxMoodId, readonly [number, number]> = {
  rest: [4500, 7500],
  curious: [900, 1600],
  smug: [1600, 2600],
  happy: [1100, 2000],
  laugh: [500, 900],
  listening: [1400, 2400],
  excited: [450, 800],
  surprised: [1200, 2000],
};

export const GAZE_WANDER_MS: Record<NearBoxMoodId, readonly [number, number]> = {
  rest: [1200, 2400],
  curious: [700, 1400],
  smug: [1600, 2800],
  happy: [1000, 2000],
  laugh: [600, 1100],
  listening: [1400, 2400],
  excited: [500, 900],
  surprised: [1600, 2600],
};

export const EYE_SHAPES: Record<EyeShapeId, { rx: number; ry: number; rotate: number }> = {
  restSoft: { rx: 5.8, ry: 11.6, rotate: 1 },
  restLean: { rx: 5.4, ry: 11.0, rotate: 2 },
  listenTall: { rx: 3.8, ry: 12.2, rotate: 14 },
  listenLean: { rx: 3.6, ry: 12.8, rotate: 16 },
  listenSoft: { rx: 4.0, ry: 11.2, rotate: 12 },
  joyTall: { rx: 5.2, ry: 12.4, rotate: -2 },
  joyHuge: { rx: 5.4, ry: 13.2, rotate: 4 },
  joyWide: { rx: 5.6, ry: 11.2, rotate: 16 },
  roundOpen: { rx: 5.8, ry: 6.0, rotate: 8 },
  roundWide: { rx: 6.2, ry: 6.2, rotate: 0 },
  smugSlim: { rx: 3.8, ry: 8.0, rotate: 6 },
  curiousDot: { rx: 4.2, ry: 6.6, rotate: 10 },
};

export const EYE_PLAYLIST: Record<NearBoxMoodId, readonly EyeShapeId[]> = {
  rest: ["restSoft", "restLean"],
  curious: ["roundOpen", "roundWide", "restSoft", "curiousDot"],
  smug: ["curiousDot", "restLean", "joyTall"],
  happy: ["joyTall", "joyHuge", "joyWide", "listenTall"],
  laugh: ["joyTall", "joyHuge", "joyWide"],
  listening: ["listenTall", "listenLean", "listenSoft"],
  excited: ["joyTall", "joyWide", "roundWide", "roundOpen", "joyHuge"],
  surprised: ["roundOpen", "roundWide"],
};

const REST_STAY = 0.62;

function clamp(value: number, lo: number, hi: number): number {
  if (lo > hi) return (lo + hi) / 2;
  return Math.min(hi, Math.max(lo, value));
}

function mixRange(range: readonly [number, number], roll: number): number {
  const t = Math.min(1, Math.max(0, roll));
  return Math.round(range[0] + t * (range[1] - range[0]));
}

export function holdMs(mood: NearBoxMoodId, roll: number): number {
  return mixRange(NEAR_BOX_MOOD_HOLD[mood], roll);
}

export function hopMs(mood: NearBoxMoodId, roll: number): number {
  return mixRange(EYE_HOP_MS[mood], roll);
}

export function wanderMs(mood: NearBoxMoodId, roll: number): number {
  return mixRange(GAZE_WANDER_MS[mood], roll);
}

export function nextIdleMood(current: NearBoxMoodId, peekRoll: number, pickRoll: number): NearBoxMoodId {
  if (current !== "rest") return "rest";
  if (peekRoll < REST_STAY) return "rest";
  const index = Math.min(GLANCE_MOODS.length - 1, Math.floor(pickRoll * GLANCE_MOODS.length));
  return GLANCE_MOODS[index] ?? "curious";
}

export function nextPlaylistIndex(mood: NearBoxMoodId, currentIndex: number): number {
  const list = EYE_PLAYLIST[mood];
  if (list.length <= 1) return 0;
  return (currentIndex + 1) % list.length;
}

export function clampMark(mark: SensorMark): SensorMark {
  return {
    ...mark,
    cx: clamp(mark.cx, RIGHT_FACE_BOUNDS.minX + mark.rx, RIGHT_FACE_BOUNDS.maxX - mark.rx),
    cy: clamp(mark.cy, RIGHT_FACE_BOUNDS.minY + mark.ry, RIGHT_FACE_BOUNDS.maxY - mark.ry),
  };
}

export function applyLid(mark: SensorMark, lid: number): SensorMark {
  return { ...mark, ry: Math.max(mark.ry * Math.max(lid, 0.05), 1.05) };
}

export function marksForShape(id: EyeShapeId, gaze: Gaze = { x: 0, y: 0 }): [SensorMark, SensorMark] {
  const shape = EYE_SHAPES[id];
  return [
    clampMark({
      kind: "oval",
      cx: FACE_LEFT.cx + gaze.x,
      cy: FACE_LEFT.cy + gaze.y,
      rx: shape.rx,
      ry: shape.ry,
      rotate: shape.rotate,
    }),
    clampMark({
      kind: "oval",
      cx: FACE_RIGHT.cx + gaze.x,
      cy: FACE_RIGHT.cy + gaze.y,
      rx: shape.rx,
      ry: shape.ry,
      rotate: shape.rotate,
    }),
  ];
}

export function gazeForMood(mood: NearBoxMoodId, rollX: number, rollY: number): Gaze {
  const side = rollX < 0.5 ? -1 : 1;
  switch (mood) {
    case "rest":
      return { x: (rollX * 2 - 1) * 3.6, y: (rollY * 2 - 1) * 2.4 };
    case "surprised":
      return { x: 0, y: 0 };
    case "listening":
      return { x: (rollX * 2 - 1) * 2.2, y: (rollY * 2 - 1) * 1.4 };
    case "curious":
      return { x: side * (2.4 + rollY * 1.6), y: (rollY * 2 - 1) * 2.2 };
    case "smug":
      return { x: (rollX * 2 - 1) * 1.2, y: -1.4 - rollY * 1.2 };
    case "happy":
      return { x: (rollX * 2 - 1) * 1.8, y: -1.1 - rollY };
    case "laugh":
      return { x: (rollX * 2 - 1) * 1.4, y: -1.6 };
    case "excited":
      return { x: (rollX * 2 - 1) * 2.6, y: (rollY * 2 - 1) * 2 };
  }
}

export function blinkLidAt(elapsedMs: number, double = false): number {
  const keys = [
    { at: 0, v: 0.05 },
    { at: 70, v: 0.05 },
    { at: 150, v: 1.08 },
    { at: 300, v: 1 },
  ];
  if (double) {
    keys.push({ at: 370, v: 0.05 }, { at: 480, v: 1 });
  }
  let lid = 1;
  for (const key of keys) {
    if (elapsedMs >= key.at) lid = key.v;
  }
  return lid;
}

export const NEAR_BOX_MOODS: Record<NearBoxMoodId, [SensorMark, SensorMark]> = {
  rest: marksForShape("restSoft"),
  curious: marksForShape("roundOpen"),
  smug: marksForShape("curiousDot"),
  happy: marksForShape("joyTall"),
  laugh: marksForShape("joyTall"),
  listening: marksForShape("listenTall"),
  excited: marksForShape("joyTall"),
  surprised: marksForShape("roundOpen"),
};

export function blinksForMood(_mood: NearBoxMoodId): boolean {
  return true;
}
