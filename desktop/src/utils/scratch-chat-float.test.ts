import { describe, expect, it } from "vitest";
import {
  SCRATCH_FLOAT_HEIGHT,
  SCRATCH_FLOAT_MARGIN,
  SCRATCH_FLOAT_WIDTH,
  clampScratchFloatPosition,
  defaultScratchFloatPosition,
} from "./scratch-chat-float";

describe("clampScratchFloatPosition", () => {
  const size = { width: 360, height: 480 };
  const viewport = { width: 1200, height: 800 };

  it("keeps an in-bounds position", () => {
    expect(clampScratchFloatPosition({ left: 100, top: 80 }, size, viewport)).toEqual({
      left: 100,
      top: 80,
    });
  });

  it("clamps overflow to the viewport margin", () => {
    expect(clampScratchFloatPosition({ left: 2000, top: 2000 }, size, viewport)).toEqual({
      left: 1200 - 360 - SCRATCH_FLOAT_MARGIN,
      top: 800 - 480 - SCRATCH_FLOAT_MARGIN,
    });
    expect(clampScratchFloatPosition({ left: -40, top: -10 }, size, viewport)).toEqual({
      left: SCRATCH_FLOAT_MARGIN,
      top: SCRATCH_FLOAT_MARGIN,
    });
  });
});

describe("defaultScratchFloatPosition", () => {
  it("anchors to the top-right and stays on screen", () => {
    const pos = defaultScratchFloatPosition({ width: 1280, height: 720 });
    expect(pos.left).toBe(1280 - SCRATCH_FLOAT_WIDTH - 24);
    expect(pos.top).toBe(72);
    const tiny = defaultScratchFloatPosition({ width: 300, height: 200 });
    expect(tiny.left).toBe(SCRATCH_FLOAT_MARGIN);
    expect(tiny.top).toBe(SCRATCH_FLOAT_MARGIN);
    expect(tiny.left + SCRATCH_FLOAT_WIDTH).toBeGreaterThan(tiny.left);
    expect(SCRATCH_FLOAT_HEIGHT).toBeGreaterThan(0);
  });
});
