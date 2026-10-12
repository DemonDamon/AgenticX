import { describe, expect, it } from "vitest";
import {
  EYE_PLAYLIST,
  FACE_LEFT,
  FACE_RIGHT,
  NEAR_BOX_MOODS,
  NEAR_BOX_MOOD_CYCLE,
  RIGHT_FACE_BOUNDS,
  blinkLidAt,
  clampMark,
  gazeForMood,
  holdMs,
  hopMs,
  marksForShape,
  nextIdleMood,
  nextPlaylistIndex,
  wanderMs,
  type SensorMark,
} from "./near-box-moods";

function aspect(mark: SensorMark): number {
  return mark.ry / mark.rx;
}

describe("near-box-moods", () => {
  it("keeps only the eight idle moods", () => {
    expect([...NEAR_BOX_MOOD_CYCLE]).toEqual([
      "rest",
      "curious",
      "smug",
      "happy",
      "laugh",
      "listening",
      "excited",
      "surprised",
    ]);
  });

  it("comes home to rest after a glance, and stays on rest most of the time", () => {
    expect(nextIdleMood("curious", 0.1, 0.1)).toBe("rest");
    expect(nextIdleMood("rest", 0.1, 0.9)).toBe("rest");
    expect(NEAR_BOX_MOOD_CYCLE).toContain(nextIdleMood("rest", 0.9, 0));
    expect(nextIdleMood("rest", 0.9, 0)).not.toBe("rest");
  });

  it("holds rest much longer than a glance", () => {
    expect(holdMs("rest", 0)).toBe(9000);
    expect(holdMs("rest", 1)).toBe(16000);
    expect(holdMs("excited", 0)).toBe(1100);
    expect(holdMs("listening", 0)).toBe(2800);
  });

  it("gives each mood a shape playlist instead of one locked face", () => {
    expect([...EYE_PLAYLIST.rest]).toEqual(["restSoft", "restLean"]);
    expect([...EYE_PLAYLIST.listening]).toEqual(["listenTall", "listenLean", "listenSoft"]);
    expect([...EYE_PLAYLIST.surprised]).toEqual(["roundOpen", "roundWide"]);
    expect([...EYE_PLAYLIST.laugh]).toEqual(["joyTall", "joyHuge", "joyWide"]);
    expect(nextPlaylistIndex("listening", 0)).toBe(1);
    expect(nextPlaylistIndex("listening", 2)).toBe(0);
    expect(hopMs("rest", 0)).toBeGreaterThan(4000);
    expect(hopMs("laugh", 1)).toBeLessThan(holdMs("laugh", 1));
  });

  it("keeps playlist shapes on the face: listen tall, surprise round, laugh tall not flat", () => {
    const [restL] = marksForShape("restSoft");
    const [listenL] = marksForShape("listenTall");
    const [surpriseL] = marksForShape("roundOpen");
    const [laughL] = marksForShape("joyTall");

    expect(restL.cx).toBe(FACE_LEFT.cx);
    expect(restL.cy).toBe(FACE_LEFT.cy);
    expect(aspect(listenL)).toBeGreaterThan(aspect(restL));
    expect(aspect(listenL)).toBeGreaterThan(2.8);
    expect(aspect(surpriseL)).toBeGreaterThan(0.9);
    expect(aspect(surpriseL)).toBeLessThan(1.15);
    expect(aspect(laughL)).toBeGreaterThan(2);
    expect(laughL.ry).toBeGreaterThan(laughL.rx);
    expect(restL.rx).toBeLessThanOrEqual(6.2);
    expect(restL.ry).toBeLessThanOrEqual(12);
    expect(restL.rotate).toBeGreaterThanOrEqual(0);
    expect(restL.rotate).toBeLessThanOrEqual(3);
    expect(restL.ry / restL.rx).toBeGreaterThan(1.85);
    expect(surpriseL.rx).toBeLessThanOrEqual(6.4);
  });

  it("clamps a wild gaze back onto the right face", () => {
    const [left] = marksForShape("restSoft", { x: -80, y: 90 });
    expect(left.cx).toBeGreaterThanOrEqual(RIGHT_FACE_BOUNDS.minX);
    expect(left.cx).toBeLessThanOrEqual(RIGHT_FACE_BOUNDS.maxX);
    expect(left.cy).toBeGreaterThanOrEqual(RIGHT_FACE_BOUNDS.minY);
    expect(left.cy).toBeLessThanOrEqual(RIGHT_FACE_BOUNDS.maxY);

    const escaped = clampMark({
      kind: "oval",
      cx: 20,
      cy: 20,
      rx: 5,
      ry: 10,
      rotate: 8,
    });
    expect(escaped.cx).toBeGreaterThanOrEqual(RIGHT_FACE_BOUNDS.minX);
    expect(escaped.cy).toBeGreaterThanOrEqual(RIGHT_FACE_BOUNDS.minY);
  });

  it("blinks by squeezing lid height, not extra marks", () => {
    expect(blinkLidAt(0)).toBe(0.05);
    expect(blinkLidAt(70)).toBe(0.05);
    expect(blinkLidAt(150)).toBe(1.08);
    expect(blinkLidAt(300)).toBe(1);
    expect(blinkLidAt(400, true)).toBe(0.05);
    expect(blinkLidAt(500, true)).toBe(1);
  });

  it("lets rest look around on its own, while surprise stays home", () => {
    expect(Math.abs(gazeForMood("rest", 0.9, 0.2).x)).toBeGreaterThan(1);
    expect(Math.abs(gazeForMood("rest", 0.1, 0.8).x)).toBeGreaterThan(1);
    expect(gazeForMood("surprised", 0.2, 0.8)).toEqual({ x: 0, y: 0 });
    expect(Math.abs(gazeForMood("curious", 0.1, 0.8).x)).toBeGreaterThan(2);
    expect(wanderMs("rest", 0)).toBeGreaterThanOrEqual(1200);
    expect(wanderMs("rest", 1)).toBeLessThan(hopMs("rest", 0));
  });

  it("still exposes a home pair per mood on the same anchors", () => {
    for (const mood of NEAR_BOX_MOOD_CYCLE) {
      const [left, right] = NEAR_BOX_MOODS[mood];
      expect(left.cx).toBe(FACE_LEFT.cx);
      expect(left.cy).toBe(FACE_LEFT.cy);
      expect(right.cx).toBe(FACE_RIGHT.cx);
      expect(right.cy).toBe(FACE_RIGHT.cy);
    }
  });
});
