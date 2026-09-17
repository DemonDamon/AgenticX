/** Display accent orange (`#F9731A`), same swatch as Settings → 显示. */
export const NEAR_VITAL_ORANGE = [249 / 255, 115 / 255, 26 / 255] as const;
/** Shirt orange light enough to separate from the cube (`#FFC4A3`). */
export const NEAR_LIGHT_ORANGE = [1, 196 / 255, 163 / 255] as const;
/** Display accent green (`#10B981`). */
export const NEAR_SKIRT_GREEN = [16 / 255, 185 / 255, 129 / 255] as const;
/** Display accent pink (`#EC4899`). */
export const NEAR_ACCENT_PINK = [236 / 255, 72 / 255, 153 / 255] as const;
/** Shared figure skin, same as the thinking man (`#D37E3A`). */
export const NEAR_SKIN = [211 / 255, 126 / 255, 58 / 255] as const;
/** Display accent blue (`#3B82F6`). */
export const NEAR_ACCENT_BLUE = [59 / 255, 130 / 255, 246 / 255] as const;
/** Light-theme mono ink (`#0F172A`). */
export const NEAR_INK = [15 / 255, 23 / 255, 42 / 255] as const;
/** Dark-theme mono paper (`#FFFFFF`). */
export const NEAR_PAPER = [1, 1, 1] as const;

export type EmptyAccentId = "blue" | "green" | "pink" | "yellow" | "white";
export type EmptyThemeMode = "dark" | "light" | "dim";

export function accentPrimaryRgb(
  accent: EmptyAccentId = "yellow",
  theme: EmptyThemeMode = "dark",
): readonly [number, number, number] {
  if (accent === "blue") return NEAR_ACCENT_BLUE;
  if (accent === "green") return NEAR_SKIRT_GREEN;
  if (accent === "pink") return NEAR_ACCENT_PINK;
  if (accent === "white") return theme === "light" ? NEAR_INK : NEAR_PAPER;
  return NEAR_VITAL_ORANGE;
}

/** Bottoms stay green unless the shirt already is green. */
export function accentBottomRgb(accent: EmptyAccentId = "yellow"): readonly [number, number, number] {
  return accent === "green" ? NEAR_VITAL_ORANGE : NEAR_SKIRT_GREEN;
}

const YELLOW_WORK = [1, 0.7529, 0.2745] as const;
const PINK_WORK = [1, 0.2, 0.498] as const;
const WHITE_WORK = [1, 1, 1] as const;
const INK_WORK = [26 / 255, 46 / 255, 53 / 255] as const;
const YELLOW_THINK = [0.9098, 0.7529, 0.1059] as const;
const TEAL_SHORTS = [0.4627, 0.6784, 0.6353] as const;
const BUBBLE_MAUVE = [0.7451, 0.3765, 0.4784] as const;
/** Question-mark bubble inside the man precomp (`#A17296`). */
const BUBBLE_DUSTY = [0.6314, 0.4471, 0.5882] as const;
const SOCK_ROSE = [190 / 255, 96 / 255, 122 / 255] as const;
const LIME_DOODLE = [69 / 255, 195 / 255, 0] as const;
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
  primary: readonly number[],
  bottom: readonly number[],
): readonly number[] | null {
  if (layers.includes("rocket")) {
    return null;
  }
  if (layers.includes("head")) {
    if (colorMatches(k, PINK_WORK)) return NEAR_ACCENT_PINK;
    if (kind === "work" && colorMatches(k, WHITE_WORK)) return NEAR_SKIN;
    return null;
  }
  if (kind === "work") {
    if (layers.includes("l wrist") && colorMatches(k, WHITE_WORK)) {
      return NEAR_SKIN;
    }
    if (layers.includes("laptop") && layers.includes("Layer-6") && colorMatches(k, WHITE_WORK)) {
      return NEAR_SKIN;
    }
    if (colorMatches(k, YELLOW_WORK) && layers.some((name) => WORK_TOP.has(name))) {
      return primary;
    }
    if (colorMatches(k, PINK_WORK) && ty === "fl" && layers.some((name) => WORK_SKIRT.has(name))) {
      return bottom;
    }
    if (colorMatches(k, PINK_WORK)) {
      return primary;
    }
    return null;
  }
  if (layers.includes("man") && layers.includes("body") && colorMatches(k, YELLOW_THINK)) {
    return primary;
  }
  if (layers.includes("man") && layers.includes("leg") && colorMatches(k, TEAL_SHORTS)) {
    return bottom;
  }
  if (
    layers.includes("man") &&
    layers.includes("leg") &&
    (colorMatches(k, SOCK_ROSE) || colorMatches(k, BUBBLE_DUSTY))
  ) {
    return NEAR_ACCENT_PINK;
  }
  if (colorMatches(k, LIME_DOODLE)) {
    return NEAR_SKIRT_GREEN;
  }
  if (
    !layers.includes("man") &&
    layers.some((name) => THINK_BUBBLES.has(name)) &&
    colorMatches(k, BUBBLE_MAUVE)
  ) {
    return primary;
  }
  if (
    layers.includes("man") &&
    layers.includes("Capa 1") &&
    !layers.includes("leg") &&
    colorMatches(k, BUBBLE_DUSTY)
  ) {
    return primary;
  }
  return null;
}

function paint(
  node: unknown,
  layers: string[],
  kind: "work" | "think",
  primary: readonly number[],
  bottom: readonly number[],
): void {
  if (Array.isArray(node)) {
    for (const child of node) paint(child, layers, kind, primary, bottom);
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
      const target = targetFor(nextLayers, kind, color.k, rec.ty, primary, bottom);
      if (target) color.k = paintRgb(color.k, target);
    }
  }

  for (const value of Object.values(rec)) {
    paint(value, nextLayers, kind, primary, bottom);
  }
}

function isGroupItems(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every((item) => item && typeof item === "object");
}

function hasInkStroke(items: Record<string, unknown>[]): boolean {
  return items.some((item) => {
    if (item.ty !== "st" || !item.c || typeof item.c !== "object") return false;
    const k = (item.c as { k?: unknown }).k;
    return isRgb(k) && colorMatches(k, INK_WORK);
  });
}

function hasFill(items: Record<string, unknown>[]): boolean {
  return items.some((item) => item.ty === "fl");
}

function pinkShoeFill(): Record<string, unknown> {
  return {
    ty: "fl",
    c: { a: 0, k: [...NEAR_ACCENT_PINK, 1], ix: 4 },
    o: { a: 0, k: 100, ix: 5 },
    r: 1,
    bm: 0,
    nm: "Fill 1",
    hd: false,
  };
}

function fillWorkShoeOutlines(node: unknown, layers: string[]): void {
  if (Array.isArray(node)) {
    for (const child of node) fillWorkShoeOutlines(child, layers);
    return;
  }
  if (!node || typeof node !== "object") return;
  const rec = node as Record<string, unknown>;
  const name = typeof rec.nm === "string" ? rec.nm : null;
  const namedScope = Boolean(name && ("ty" in rec || Array.isArray(rec.layers) || Array.isArray(rec.it)));
  const nextLayers = namedScope && name ? [...layers, name] : layers;

  const onShoeOutline =
    (nextLayers.includes("l shoe") || nextLayers.includes("r leg")) &&
    !nextLayers.includes("Layer-8") &&
    nextLayers.includes("Group 3");
  if (onShoeOutline && isGroupItems(rec.it) && hasInkStroke(rec.it) && !hasFill(rec.it)) {
    const transformAt = rec.it.findIndex((item) => item.ty === "tr");
    const fill = pinkShoeFill();
    if (transformAt >= 0) rec.it.splice(transformAt, 0, fill);
    else rec.it.push(fill);
  }

  for (const value of Object.values(rec)) {
    fillWorkShoeOutlines(value, nextLayers);
  }
}

export function recolorEmptyLottieClothes(
  data: unknown,
  kind: "work" | "think",
  primary: readonly number[] = NEAR_VITAL_ORANGE,
  bottom: readonly number[] = NEAR_SKIRT_GREEN,
): unknown {
  const clone = structuredClone(data);
  paint(clone, [], kind, primary, bottom);
  if (kind === "work") fillWorkShoeOutlines(clone, []);
  return clone;
}
