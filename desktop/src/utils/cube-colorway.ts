/**
 * Same collectible cube recipe as expert portraits.
 * Brand default is the official orange PNG, not a generated colorway.
 * Author: Damon Li
 */
import catalog from "./cube-colorways.json";
import { NEAR_CUBE_LUMA_HREF } from "./near-cube-luma-href";

export const BRAND_CUBE_COLORWAY_ID = "brand";

export type CubeColorwayKind = "dual" | "dream" | "shade";

export type CubeColorway = {
  id: string;
  kind: CubeColorwayKind;
  body?: string;
  lid?: string;
  deep?: string;
  lite?: string;
  eye?: string;
  stops?: string[];
  angle?: number;
};

const CUSTOM_CUBE_SKINS_KEY = "agx-user-cube-skins";
const CUSTOM_CUBE_SKINS_LIMIT = 12;

export const CUBE_COLORWAYS: readonly CubeColorway[] = (catalog as CubeColorway[]).filter(
  (item) => item.kind === "dual" || item.kind === "dream" || item.kind === "shade",
);

const LUMA_BOX = { x: 13.4, y: 8, width: 133.2, height: 144 };
const DARK_EYE = "#1C1917";
const LIGHT_EYE = "#FFFFFF";

function parseHexRgb(hex: string): { r: number; g: number; b: number } | null {
  const raw = String(hex || "").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(raw)) return null;
  return {
    r: parseInt(raw.slice(1, 3), 16),
    g: parseInt(raw.slice(3, 5), 16),
    b: parseInt(raw.slice(5, 7), 16),
  };
}

export function hexLuma(hex: string): number {
  const rgb = parseHexRgb(hex);
  if (!rgb) return 0.5;
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
}

/** Eyes sit on the lower-right face; light faces need dark ink. */
export function contrastEyeHex(fillHex: string): string {
  return hexLuma(fillHex) >= 0.58 ? DARK_EYE : LIGHT_EYE;
}

/** Near-white bodies disappear on the settings sheet; keep them pale but visible. */
export function readableCubeFill(hex: string): string {
  const rgb = parseHexRgb(hex);
  if (!rgb || hexLuma(hex) <= 0.86) return String(hex || "").toUpperCase();
  const mix = 0.22;
  const r = Math.round(rgb.r * (1 - mix) + 168 * mix);
  const g = Math.round(rgb.g * (1 - mix) + 162 * mix);
  const b = Math.round(rgb.b * (1 - mix) + 158 * mix);
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function faceFillHex(way: CubeColorway): string {
  if (way.kind === "dream" && way.stops && way.stops.length > 0) {
    return readableCubeFill(way.stops[way.stops.length - 1] || way.stops[0] || "#F9731A");
  }
  return readableCubeFill(way.body || "#F9731A");
}

function hashIndex(seed: string, modulo: number): number {
  let hash = 0;
  for (const ch of seed) {
    hash = (hash * 33 + ch.charCodeAt(0)) >>> 0;
  }
  return modulo > 0 ? hash % modulo : 0;
}

function readCustomCubeColorways(): CubeColorway[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_CUBE_SKINS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CubeColorway[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && (item.kind === "dual" || item.kind === "dream") && item.id);
  } catch {
    return [];
  }
}

export function listCustomCubeColorways(): CubeColorway[] {
  return readCustomCubeColorways();
}

export function rememberCustomCubeColorway(way: CubeColorway): void {
  if (!way?.id || (way.kind !== "dual" && way.kind !== "dream")) return;
  const next = [way, ...readCustomCubeColorways().filter((item) => item.id !== way.id)].slice(
    0,
    CUSTOM_CUBE_SKINS_LIMIT,
  );
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CUSTOM_CUBE_SKINS_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
}

export function cubeColorwayById(id: string): CubeColorway | undefined {
  const key = String(id || "").trim();
  if (!key || key === BRAND_CUBE_COLORWAY_ID) return undefined;
  return (
    CUBE_COLORWAYS.find((item) => item.id === key) ||
    readCustomCubeColorways().find((item) => item.id === key)
  );
}

export function isUserCubeColorwayId(id: string): boolean {
  const key = String(id || "").trim();
  if (!key) return false;
  if (key === BRAND_CUBE_COLORWAY_ID) return true;
  return Boolean(cubeColorwayById(key));
}

export function pickRandomCubeColorwayId(except?: string): string {
  const pool = CUBE_COLORWAYS.filter((item) => item.kind !== "shade" && item.id !== except);
  const list = pool.length > 0 ? pool : CUBE_COLORWAYS;
  return list[Math.floor(Math.random() * list.length)]?.id ?? BRAND_CUBE_COLORWAY_ID;
}

export function buildCubePortraitSvgFromWay(way: CubeColorway): string {
  if (!way) return "";
  const seed = way.id;
  const uid = `u${hashIndex(`cube:${seed}`, 16_777_619).toString(16)}`;
  const body = readableCubeFill(way.body || "#F9731A");
  const stops = (way.stops || []).map((stop, index) =>
    index === (way.stops?.length || 0) - 1 ? readableCubeFill(stop) : stop,
  );
  const eye = contrastEyeHex(faceFillHex({ ...way, body, stops }));
  const lumaImg =
    `<image href="${NEAR_CUBE_LUMA_HREF}" x="${LUMA_BOX.x}" y="${LUMA_BOX.y}" ` +
    `width="${LUMA_BOX.width}" height="${LUMA_BOX.height}" preserveAspectRatio="xMidYMid meet"/>`;
  const defs: string[] = [
    `<mask id="${uid}-cut" maskUnits="userSpaceOnUse" mask-type="alpha">${lumaImg}</mask>`,
  ];
  let paint = `<rect x="8" y="4" width="144" height="152" fill="${body}"/>`;
  if (way.kind === "dream" && stops.length >= 3) {
    const angle = way.angle ?? 32;
    defs.push(
      `<linearGradient id="${uid}-fill" x1="0%" y1="0%" x2="100%" y2="100%" ` +
        `gradientTransform="rotate(${angle} 0.5 0.5)">` +
        `<stop offset="0%" stop-color="${stops[0]}"/>` +
        `<stop offset="52%" stop-color="${stops[1]}"/>` +
        `<stop offset="100%" stop-color="${stops[2]}"/>` +
        `</linearGradient>`,
    );
    paint = `<rect x="8" y="4" width="144" height="152" fill="url(#${uid}-fill)"/>`;
  } else if (way.kind === "dual" && way.lid) {
    defs.push(
      `<linearGradient id="${uid}-fill" x1="48%" y1="2%" x2="72%" y2="78%">` +
        `<stop offset="0%" stop-color="${way.lid}"/>` +
        `<stop offset="28%" stop-color="${way.lid}"/>` +
        `<stop offset="58%" stop-color="${body}"/>` +
        `<stop offset="100%" stop-color="${body}"/>` +
        `</linearGradient>`,
    );
    paint = `<rect x="8" y="4" width="144" height="152" fill="url(#${uid}-fill)"/>`;
  }
  const lean = hashIndex(`eye:${seed}`, 2);
  const rx = lean ? 5.4 : 5.8;
  const ry = lean ? 11.0 : 11.6;
  const rot = lean ? 2 : 1;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" ` +
    `data-portrait="near-cube-v3" data-colorway="${way.id}">` +
    `<defs>${defs.join("")}</defs>` +
    `<g mask="url(#${uid}-cut)">${paint}</g>` +
    `<g style="mix-blend-mode:soft-light" opacity="0.92">${lumaImg}</g>` +
    `<ellipse cx="106" cy="104" rx="${rx}" ry="${ry}" fill="${eye}" transform="rotate(${rot} 106 104)"/>` +
    `<ellipse cx="128" cy="92" rx="${rx}" ry="${ry}" fill="${eye}" transform="rotate(${rot} 128 92)"/>` +
    `</svg>`
  );
}

export function buildCubePortraitSvg(colorwayId: string): string {
  const way = cubeColorwayById(colorwayId);
  if (!way) return "";
  return buildCubePortraitSvgFromWay(way);
}

export function buildCubePortraitDataUrlFromWay(way: CubeColorway): string {
  const svg = buildCubePortraitSvgFromWay(way);
  if (!svg) return "";
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export function buildCubePortraitDataUrl(colorwayId: string): string {
  const way = cubeColorwayById(colorwayId);
  if (!way) return "";
  return buildCubePortraitDataUrlFromWay(way);
}

export function avatarUrlForCubeColorway(colorwayId: string): string {
  const key = String(colorwayId || "").trim() || BRAND_CUBE_COLORWAY_ID;
  if (key === BRAND_CUBE_COLORWAY_ID) return "";
  return buildCubePortraitDataUrl(key);
}
