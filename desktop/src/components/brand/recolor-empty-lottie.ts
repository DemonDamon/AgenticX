/** Brand orange matching the empty-state box (`#FF7A45`). */
export const NEAR_VITAL_ORANGE = [1, 122 / 255, 69 / 255] as const;
/** Shirt orange light enough to separate from the cube (`#FFC4A3`). */
export const NEAR_LIGHT_ORANGE = [1, 196 / 255, 163 / 255] as const;
/** Skirt green paired with the brand orange. */
export const NEAR_SKIRT_GREEN = [42 / 255, 138 / 255, 98 / 255] as const;

const YELLOW_WORK = [1, 0.7529, 0.2745] as const;
const PINK_WORK = [1, 0.2, 0.498] as const;
const YELLOW_THINK = [0.9098, 0.7529, 0.1059] as const;
const TEAL_SHORTS = [0.4627, 0.6784, 0.6353] as const;
const BUBBLE_MAUVE = [0.7451, 0.3765, 0.4784] as const;
/** Question-mark bubble inside the man precomp (`#A17296`). */
const BUBBLE_DUSTY = [0.6314, 0.4471, 0.5882] as const;
const THINK_BUBBLES = new Set(["Capa 6", "Capa 7"]);

const WORK_TOP = new Set(["body", "l arm", "l hand"]);
const WORK_SKIRT = new Set(["body", "l leg", "r leg"]);

function isRgb(k: unknown): k is number[] {
  return Array.isArray(k) && k.length >= 3 && k.every((n) => typeof n === "number");
}

function colorMatches(k: number[], target: readonly number[], eps = 0.03): boolean {
  return (
    Math.abs(k[0] - target[0]) < eps &&
    Math.abs(k[1] - target[1]) < eps &&
    Math.abs(k[2] - target[2]) < eps
  );
}

function paintRgb(k: number[], rgb: readonly number[]): number[] {
  const next = k.slice();
  next[0] = rgb[0];
  next[1] = rgb[1];
  next[2] = rgb[2];
  return next;
}

function targetFor(
  layers: string[],
  kind: "work" | "think",
  k: number[],
  ty: string,
): readonly number[] | null {
  if (layers.includes("head") || layers.includes("rocket")) {
    return null;
  }
  if (kind === "work") {
    if (colorMatches(k, YELLOW_WORK) && layers.some((name) => WORK_TOP.has(name))) {
      return NEAR_VITAL_ORANGE;
    }
    if (colorMatches(k, PINK_WORK) && ty === "fl" && layers.some((name) => WORK_SKIRT.has(name))) {
      return NEAR_SKIRT_GREEN;
    }
    if (colorMatches(k, PINK_WORK)) {
      return NEAR_VITAL_ORANGE;
    }
    return null;
  }
  if (layers.includes("man") && layers.includes("body") && colorMatches(k, YELLOW_THINK)) {
    return NEAR_VITAL_ORANGE;
  }
  if (layers.includes("man") && layers.includes("leg") && colorMatches(k, TEAL_SHORTS)) {
    return NEAR_SKIRT_GREEN;
  }
  if (
    !layers.includes("man") &&
    layers.some((name) => THINK_BUBBLES.has(name)) &&
    colorMatches(k, BUBBLE_MAUVE)
  ) {
    return NEAR_VITAL_ORANGE;
  }
  if (
    layers.includes("man") &&
    layers.includes("Capa 1") &&
    !layers.includes("leg") &&
    colorMatches(k, BUBBLE_DUSTY)
  ) {
    return NEAR_VITAL_ORANGE;
  }
  return null;
}

function paint(node: unknown, layers: string[], kind: "work" | "think"): void {
  if (Array.isArray(node)) {
    for (const child of node) paint(child, layers, kind);
    return;
  }
  if (!node || typeof node !== "object") return;
  const rec = node as Record<string, unknown>;
  const name = typeof rec.nm === "string" ? rec.nm : null;
  const namedScope = Boolean(name && ("ty" in rec || Array.isArray(rec.layers)));
  const nextLayers = namedScope && name ? [...layers, name] : layers;

  if ((rec.ty === "fl" || rec.ty === "st") && rec.c && typeof rec.c === "object") {
    const color = rec.c as { k?: unknown };
    if (isRgb(color.k)) {
      const target = targetFor(nextLayers, kind, color.k, rec.ty);
      if (target) color.k = paintRgb(color.k, target);
    }
  }

  for (const value of Object.values(rec)) {
    paint(value, nextLayers, kind);
  }
}

export function recolorEmptyLottieClothes(data: unknown, kind: "work" | "think"): unknown {
  const clone = structuredClone(data);
  paint(clone, [], kind);
  return clone;
}
