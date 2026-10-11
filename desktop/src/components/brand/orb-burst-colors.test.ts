import { describe, expect, it } from "vitest";
import { orbBurstColors } from "./orb-burst-colors";

describe("orbBurstColors", () => {
  it("paints both particle colors from the display accent, not the sample cream/cyan", () => {
    const blue = orbBurstColors("blue", "dark");
    expect(blue.dot).toBe("#3b82f6");
    expect(blue.accent).not.toBe("#00ffe5");
    expect(blue.accent).not.toBe("#f4f1ea");
    expect(blue.accent.startsWith("#")).toBe(true);

    const yellow = orbBurstColors("yellow", "dark");
    expect(yellow.dot).toBe("#f9731a");
    expect(yellow.dot).not.toBe("#f4f1ea");
    expect(yellow.accent).not.toBe("#00ffe5");
  });

  it("follows the mono swatch in light and dark", () => {
    expect(orbBurstColors("white", "dark").dot).toBe("#ffffff");
    expect(orbBurstColors("white", "light").dot).toBe("#0f172a");
  });
});
