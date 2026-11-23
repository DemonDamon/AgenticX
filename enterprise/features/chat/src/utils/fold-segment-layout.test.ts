import { describe, expect, it } from "vitest";
import { placeMenuAboveTrigger, resolveUsableViewport, type ViewportRect } from "./usable-viewport";

const rect = (left: number, top: number, width: number, height: number): ViewportRect => ({ left, top, width, height });

describe("usable viewport geometry", () => {
  it("uses the layout viewport when visual and segment APIs are missing", () => {
    expect(resolveUsableViewport({ width: 800, height: 600 })).toEqual(rect(0, 0, 800, 600));
  });

  it("keeps a wide keyboard viewport inside its visible offset rectangle", () => {
    expect(resolveUsableViewport({ width: 1366, height: 1024, visual: { ...rect(15, 90, 1340, 500), scale: 1 } }))
      .toEqual(rect(15, 90, 1340, 500));
  });

  it("chooses one side of a vertical fold without crossing its gap", () => {
    const segments = [rect(0, 0, 580, 800), rect(620, 0, 580, 800)];
    expect(resolveUsableViewport({ width: 1200, height: 800, segments })).toEqual(segments[0]);
    expect(resolveUsableViewport({ width: 1200, height: 800, segments, focusedRect: rect(800, 650, 200, 50) })).toEqual(segments[1]);
  });

  it("selects the editing half of a horizontal fold", () => {
    const segments = [rect(0, 0, 900, 480), rect(0, 520, 900, 480)];
    expect(resolveUsableViewport({ width: 900, height: 1000, segments, focusedRect: rect(100, 850, 600, 50) })).toEqual(segments[1]);
  });

  it("intersects segments with the visible keyboard area before choosing", () => {
    const segments = [rect(0, 0, 900, 480), rect(0, 520, 900, 480)];
    expect(resolveUsableViewport({ width: 900, height: 1000, segments, visual: { ...rect(0, 40, 900, 570), scale: 1 }, previous: segments[1], focusedRect: rect(100, 550, 600, 40) }))
      .toEqual(rect(0, 40, 900, 440));
  });

  it("supports three segments and preserves a usable previously selected region", () => {
    const segments = [rect(0, 0, 400, 800), rect(420, 0, 400, 800), rect(840, 0, 400, 800)];
    expect(resolveUsableViewport({ width: 1240, height: 800, segments, previous: segments[2] })).toEqual(segments[2]);
    expect(resolveUsableViewport({ width: 1240, height: 800, segments, previous: segments[2], focusedRect: rect(450, 600, 200, 50) })).toEqual(segments[1]);
  });

  it("ignores focus outside the visible page and invalid/empty segment data", () => {
    const visible = { ...rect(0, 0, 800, 400), scale: 1 };
    expect(resolveUsableViewport({ width: 800, height: 900, visual: visible, segments: [rect(NaN, 0, 800, 900), rect(0, 0, 0, 900), rect(0, 700, 800, 200)], focusedRect: rect(0, 800, 300, 50) }))
      .toEqual(rect(0, 0, 800, 400));
  });

  it.each([0, NaN, 2, 0.8])("does not reflow from a non-unit zoom snapshot (%s)", (scale) => {
    expect(resolveUsableViewport({ width: 1200, height: 800, visual: { ...rect(0, 0, 600, 400), scale } })).toBeNull();
  });

  it("ignores invalid rotation snapshots and accepts a restored orientation", () => {
    expect(resolveUsableViewport({ width: 0, height: 800 })).toBeNull();
    expect(resolveUsableViewport({ width: 800, height: 1200, visual: { ...rect(0, 0, 0, 0), scale: 1 } })).toBeNull();
    expect(resolveUsableViewport({ width: 800, height: 1200, visual: { ...rect(0, 0, 800, 1200), scale: 1 } })).toEqual(rect(0, 0, 800, 1200));
  });
});

describe("composer popup geometry", () => {
  it("does not widen a narrow segment to the old minimum menu width", () => {
    const menu = placeMenuAboveTrigger(rect(80, 500, 120, 32), rect(0, 0, 240, 600))!;
    expect(menu.width).toBe(224); expect(menu.left).toBe(8);
    expect(menu.left + menu.width).toBeLessThanOrEqual(232);
  });

  it("keeps an upward popup below a horizontal fold and above the trigger", () => {
    const menu = placeMenuAboveTrigger(rect(650, 930, 160, 32), rect(0, 520, 900, 480))!;
    expect(menu.top).toBe(922);
    expect(menu.top - menu.maxHeight).toBe(528);
    expect(menu.left + menu.width).toBeLessThanOrEqual(892);
  });

  it("does not invent a minimum height outside a short visible region", () => {
    const menu = placeMenuAboveTrigger(rect(420, 140, 100, 32), rect(400, 100, 240, 100))!;
    expect(menu.maxHeight).toBe(24);
    expect(menu.left).toBeGreaterThanOrEqual(408);
    expect(placeMenuAboveTrigger(rect(0, 0, 0, 32), rect(0, 0, 240, 100))).toBeNull();
  });
});
