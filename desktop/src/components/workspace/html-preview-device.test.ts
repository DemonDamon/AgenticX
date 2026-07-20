import { describe, expect, it } from "vitest";
import {
  applyDevicePreset,
  isFixedViewport,
  rotateViewport,
} from "./html-preview-device";

describe("html-preview-device", () => {
  it("applyDevicePreset sets iphone dimensions", () => {
    const v = applyDevicePreset("iphone-se");
    expect(v.width).toBe(375);
    expect(v.height).toBe(667);
    expect(isFixedViewport(v)).toBe(true);
  });

  it("rotateViewport swaps width and height", () => {
    const v = rotateViewport(applyDevicePreset("iphone-se"));
    expect(v.width).toBe(667);
    expect(v.height).toBe(375);
  });

  it("responsive is not fixed", () => {
    expect(isFixedViewport(applyDevicePreset("responsive"))).toBe(false);
  });
});
