import { describe, expect, it } from "vitest";
import thinkingQuestions from "../../assets/empty-state/thinking-questions.json";
import workingLaptop from "../../assets/empty-state/working-laptop.json";
import {
  NEAR_LIGHT_ORANGE,
  NEAR_SKIRT_GREEN,
  NEAR_VITAL_ORANGE,
  recolorEmptyLottieClothes,
} from "./recolor-empty-lottie";

type ColorHit = { layers: string[]; rgb: number[] };

function collectColors(node: unknown, layers: string[] = [], out: ColorHit[] = []): ColorHit[] {
  if (Array.isArray(node)) {
    for (const child of node) collectColors(child, layers, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  const rec = node as Record<string, unknown>;
  const name = typeof rec.nm === "string" ? rec.nm : null;
  const next = name && ("ty" in rec || Array.isArray(rec.layers)) ? [...layers, name] : layers;
  if ((rec.ty === "fl" || rec.ty === "st") && rec.c && typeof rec.c === "object") {
    const k = (rec.c as { k?: unknown }).k;
    if (Array.isArray(k) && typeof k[0] === "number") {
      out.push({ layers: next, rgb: k.slice(0, 3) as number[] });
    }
  }
  for (const value of Object.values(rec)) collectColors(value, next, out);
  return out;
}

function hex(rgb: number[]): string {
  return (
    "#" +
    rgb
      .slice(0, 3)
      .map((n) => Math.min(255, Math.round(n * 255)).toString(16).padStart(2, "0"))
      .join("")
  );
}

function matches(rgb: number[], target: readonly number[]): boolean {
  return (
    Math.abs(rgb[0] - target[0]) < 0.02 &&
    Math.abs(rgb[1] - target[1]) < 0.02 &&
    Math.abs(rgb[2] - target[2]) < 0.02
  );
}

describe("recolorEmptyLottieClothes", () => {
  it("turns the working top orange and the skirt green", () => {
    const out = recolorEmptyLottieClothes(workingLaptop, "work");
    const colors = collectColors(out);
    const body = colors.filter((c) => c.layers.includes("body"));
    expect(body.some((c) => matches(c.rgb, NEAR_VITAL_ORANGE))).toBe(true);
    expect(body.some((c) => matches(c.rgb, NEAR_SKIRT_GREEN))).toBe(true);
    expect(body.filter((c) => hex(c.rgb) === "#ff337f" || hex(c.rgb) === "#ffc046")).toHaveLength(0);

    const leftoverPink = colors.filter((c) => hex(c.rgb) === "#ff337f");
    expect(leftoverPink.length).toBeGreaterThan(0);
    expect(leftoverPink.every((c) => c.layers.includes("head"))).toBe(true);

    const laptopLogo = colors.filter((c) => c.layers.includes("laptop") && c.layers.includes("Group 1"));
    expect(laptopLogo.some((c) => matches(c.rgb, NEAR_VITAL_ORANGE))).toBe(true);

    const laces = colors.filter((c) => c.layers.includes("l shoe"));
    expect(laces.some((c) => matches(c.rgb, NEAR_VITAL_ORANGE))).toBe(true);

    const stool = colors.filter((c) => c.layers.includes("Layer 1"));
    expect(stool.some((c) => matches(c.rgb, NEAR_VITAL_ORANGE))).toBe(true);
  });

  it("paints the thinking shirt the same vital orange as the question bubbles", () => {
    const out = recolorEmptyLottieClothes(thinkingQuestions, "think");
    const colors = collectColors(out);
    const shirt = colors.find(
      (c) => c.layers.includes("man") && c.layers.includes("body") && c.layers.includes("Group 3"),
    );
    expect(shirt).toBeTruthy();
    expect(matches(shirt!.rgb, NEAR_VITAL_ORANGE)).toBe(true);
    expect(matches(shirt!.rgb, NEAR_LIGHT_ORANGE)).toBe(false);

    const shorts = colors.filter(
      (c) => c.layers.includes("man") && c.layers.includes("leg") && c.layers.includes("Group 6"),
    );
    expect(shorts.length).toBeGreaterThan(0);
    expect(shorts.every((c) => matches(c.rgb, NEAR_SKIRT_GREEN))).toBe(true);
    expect(colors.filter((c) => hex(c.rgb) === "#76ada2")).toHaveLength(0);

    const skin = colors.filter((c) => c.layers.includes("man") && hex(c.rgb) === "#d37e3a");
    expect(skin.length).toBeGreaterThan(0);
  });

  it("paints the thinking speech bubbles orange and leaves the socks", () => {
    const out = recolorEmptyLottieClothes(thinkingQuestions, "think");
    const colors = collectColors(out);
    const bubbles = colors.filter(
      (c) =>
        !c.layers.includes("man") &&
        (c.layers.includes("Capa 6") || c.layers.includes("Capa 7")) &&
        c.layers.includes("Group 3"),
    );
    expect(bubbles.length).toBeGreaterThan(0);
    expect(bubbles.every((c) => matches(c.rgb, NEAR_VITAL_ORANGE))).toBe(true);

    const questions = colors.filter(
      (c) =>
        c.layers.includes("man") &&
        c.layers.includes("Capa 1") &&
        c.layers.includes("Group 3") &&
        !c.layers.includes("leg"),
    );
    expect(questions.length).toBeGreaterThan(0);
    expect(questions.every((c) => matches(c.rgb, NEAR_VITAL_ORANGE))).toBe(true);

    const socks = colors.filter(
      (c) => c.layers.includes("man") && c.layers.includes("leg") && hex(c.rgb) === "#be607a",
    );
    expect(socks.length).toBeGreaterThan(0);

    const dustySocks = colors.filter(
      (c) => c.layers.includes("man") && c.layers.includes("leg") && hex(c.rgb) === "#a17296",
    );
    expect(dustySocks.length).toBeGreaterThan(0);
  });
});
