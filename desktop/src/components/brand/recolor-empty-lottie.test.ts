import { describe, expect, it } from "vitest";
import thinkingQuestions from "../../assets/empty-state/thinking-questions.json";
import workingLaptop from "../../assets/empty-state/working-laptop.json";
import {
  accentBottomRgb,
  NEAR_ACCENT_BLUE,
  NEAR_ACCENT_PINK,
  NEAR_LIGHT_ORANGE,
  NEAR_SKIN,
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
  it("uses the display accent swatches for orange, green, and pink", () => {
    expect(hex([...NEAR_VITAL_ORANGE])).toBe("#f9731a");
    expect(hex([...NEAR_SKIRT_GREEN])).toBe("#10b981");
    expect(hex([...NEAR_ACCENT_PINK])).toBe("#ec4899");
    expect(hex([...NEAR_ACCENT_BLUE])).toBe("#3b82f6");
  });

  it("paints shirts the given accent when the display color is blue", () => {
    const out = recolorEmptyLottieClothes(workingLaptop, "work", NEAR_ACCENT_BLUE);
    const colors = collectColors(out);
    const body = colors.filter((c) => c.layers.includes("body"));
    expect(body.some((c) => matches(c.rgb, NEAR_ACCENT_BLUE))).toBe(true);
    expect(body.some((c) => matches(c.rgb, NEAR_VITAL_ORANGE))).toBe(false);
    expect(body.some((c) => matches(c.rgb, NEAR_SKIRT_GREEN))).toBe(true);

    const think = recolorEmptyLottieClothes(thinkingQuestions, "think", NEAR_ACCENT_BLUE);
    const shirt = collectColors(think).find(
      (c) => c.layers.includes("man") && c.layers.includes("body") && c.layers.includes("Group 3"),
    );
    expect(shirt).toBeTruthy();
    expect(matches(shirt!.rgb, NEAR_ACCENT_BLUE)).toBe(true);
  });

  it("swaps pants and skirt to orange when the display color is green", () => {
    expect(hex([...accentBottomRgb("green")])).toBe("#f9731a");
    expect(hex([...accentBottomRgb("blue")])).toBe("#10b981");

    const work = recolorEmptyLottieClothes(
      workingLaptop,
      "work",
      NEAR_SKIRT_GREEN,
      accentBottomRgb("green"),
    );
    const workBody = collectColors(work).filter((c) => c.layers.includes("body"));
    expect(workBody.some((c) => matches(c.rgb, NEAR_SKIRT_GREEN))).toBe(true);
    expect(workBody.some((c) => matches(c.rgb, NEAR_VITAL_ORANGE))).toBe(true);

    const think = recolorEmptyLottieClothes(
      thinkingQuestions,
      "think",
      NEAR_SKIRT_GREEN,
      accentBottomRgb("green"),
    );
    const shorts = collectColors(think).filter(
      (c) => c.layers.includes("man") && c.layers.includes("leg") && c.layers.includes("Group 6"),
    );
    expect(shorts.length).toBeGreaterThan(0);
    expect(shorts.every((c) => matches(c.rgb, NEAR_VITAL_ORANGE))).toBe(true);
    expect(shorts.some((c) => matches(c.rgb, NEAR_SKIRT_GREEN))).toBe(false);
  });

  it("turns the working top orange and the skirt green", () => {
    const out = recolorEmptyLottieClothes(workingLaptop, "work");
    const colors = collectColors(out);
    const body = colors.filter((c) => c.layers.includes("body"));
    expect(body.some((c) => matches(c.rgb, NEAR_VITAL_ORANGE))).toBe(true);
    expect(body.some((c) => matches(c.rgb, NEAR_SKIRT_GREEN))).toBe(true);
    expect(body.filter((c) => hex(c.rgb) === "#ff337f" || hex(c.rgb) === "#ffc046")).toHaveLength(0);

    const leftoverPink = colors.filter((c) => matches(c.rgb, NEAR_ACCENT_PINK));
    expect(leftoverPink.length).toBeGreaterThan(0);
    expect(leftoverPink.every((c) => c.layers.includes("head") || c.layers.includes("l shoe") || c.layers.includes("r leg"))).toBe(true);
    expect(leftoverPink.some((c) => c.layers.includes("Layer-8"))).toBe(false);
    expect(colors.filter((c) => hex(c.rgb) === "#ff337f")).toHaveLength(0);

    const laptopLogo = colors.filter((c) => c.layers.includes("laptop") && c.layers.includes("Group 1"));
    expect(laptopLogo.some((c) => matches(c.rgb, NEAR_VITAL_ORANGE))).toBe(true);

    const laces = colors.filter((c) => c.layers.includes("l shoe") && c.layers.includes("Group 1"));
    expect(laces.some((c) => matches(c.rgb, NEAR_VITAL_ORANGE))).toBe(true);

    const stool = colors.filter((c) => c.layers.includes("Layer 1"));
    expect(stool.some((c) => matches(c.rgb, NEAR_VITAL_ORANGE))).toBe(true);
  });

  it("paints the working face and wrists skin, and fills the white shoes pink", () => {
    expect(hex([...NEAR_SKIN])).toBe("#d37e3a");

    const work = recolorEmptyLottieClothes(workingLaptop, "work");
    const colors = collectColors(work);
    const face = colors.find((c) => c.layers.includes("head") && c.layers.includes("Layer-14"));
    expect(face).toBeTruthy();
    expect(matches(face!.rgb, NEAR_SKIN)).toBe(true);

    const wrist = colors.filter((c) => c.layers.includes("l wrist"));
    expect(wrist.some((c) => matches(c.rgb, NEAR_SKIN))).toBe(true);

    const laptopHand = colors.filter((c) => c.layers.includes("laptop") && c.layers.includes("Layer-6"));
    expect(laptopHand.some((c) => matches(c.rgb, NEAR_SKIN))).toBe(true);
    const laptopBody = colors.filter(
      (c) => c.layers.includes("laptop") && c.layers.includes("Group 2") && !c.layers.includes("Layer-6"),
    );
    expect(laptopBody.some((c) => matches(c.rgb, [1, 1, 1]))).toBe(true);

    const elbow = colors.find((c) => c.layers.includes("l hand") && c.layers.includes("Group 2"));
    expect(elbow).toBeTruthy();
    expect(matches(elbow!.rgb, NEAR_VITAL_ORANGE)).toBe(true);

    const sleeve = colors.find((c) => c.layers.includes("l hand") && c.layers.includes("Layer-9"));
    expect(sleeve).toBeTruthy();
    expect(matches(sleeve!.rgb, NEAR_VITAL_ORANGE)).toBe(true);

    const skirtBlock = colors.find((c) => c.layers.includes("r leg") && c.layers.includes("Layer-8"));
    expect(skirtBlock).toBeTruthy();
    expect(matches(skirtBlock!.rgb, NEAR_ACCENT_PINK)).toBe(false);

    const rightShoe = colors.filter((c) => c.layers.includes("r leg") && c.layers.includes("Group 3"));
    expect(rightShoe.some((c) => matches(c.rgb, NEAR_ACCENT_PINK))).toBe(true);

    const leftShoe = colors.filter((c) => c.layers.includes("l shoe") && c.layers.includes("Group 3"));
    expect(leftShoe.some((c) => matches(c.rgb, NEAR_ACCENT_PINK))).toBe(true);
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
      (c) => c.layers.includes("man") && c.layers.includes("leg") && matches(c.rgb, NEAR_ACCENT_PINK),
    );
    expect(socks.length).toBeGreaterThan(0);
    expect(colors.filter((c) => hex(c.rgb) === "#be607a" || hex(c.rgb) === "#a17296")).toHaveLength(0);
  });
});
