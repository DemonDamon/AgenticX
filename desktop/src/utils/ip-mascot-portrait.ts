/**
 * Local vector mascot portraits for the expert collection style rail.
 * Large rounded faces, two subject colors + one solid background.
 * Composed to stay readable from the 20px style trigger through 48–56px tiles.
 * Author: Damon Li
 */

export const IP_MASCOT_PORTRAIT_STYLE = "ip-mascot" as const;

const SPECIES = ["cat", "dog", "bear", "bunny", "fox", "bird", "panda", "frog"] as const;
type Species = (typeof SPECIES)[number];
type Corner = "left" | "right";

type Palette = { primary: string; secondary: string; bg: string };

const PALETTES: readonly Palette[] = [
  { primary: "#F6E7C1", secondary: "#E07A3D", bg: "#C4553A" },
  { primary: "#F7F4EF", secondary: "#F2A7BD", bg: "#3D6FBE" },
  { primary: "#F4C95D", secondary: "#F7F4EF", bg: "#1E3A5F" },
  { primary: "#8FBF7A", secondary: "#F4E6C3", bg: "#243E34" },
  { primary: "#F7F4EF", secondary: "#1F1F1F", bg: "#5C4D8A" },
  { primary: "#F2994A", secondary: "#F7F1E5", bg: "#2C3E50" },
  { primary: "#7EB6D9", secondary: "#F7F4EF", bg: "#1D3557" },
  { primary: "#F2B6C6", secondary: "#5C4033", bg: "#3A2F45" },
  { primary: "#F7F4EF", secondary: "#E15A4A", bg: "#2A6B5A" },
  { primary: "#F6C1C1", secondary: "#2B2B2B", bg: "#E7D7B8" },
];

const VIEW = 64;

function hashSeed(seed: string): number {
  // FNV-1a plus a final mix so nearby names don't share one palette.
  let hash = 2166136261;
  for (const ch of seed) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  return hash >>> 0;
}

function channel(hex: string, index: number): number {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
}

function contrastInk(surface: string): string {
  const hex = surface.startsWith("#") && surface.length === 7 ? surface : "#888888";
  return luma(hex) >= 0.62 ? "#1C1917" : "#F8FAFC";
}

function luma(hex: string): number {
  return (0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2)) / 255;
}

function eyes(cx: number, cy: number, gap: number, radius: number, ink: string): string {
  return `<circle cx="${cx - gap}" cy="${cy}" r="${radius}" fill="${ink}"/><circle cx="${cx + gap}" cy="${cy}" r="${radius}" fill="${ink}"/>`;
}

function smile(cx: number, cy: number, half: number, ink: string): string {
  const low = (cy + half * 0.72).toFixed(1);
  const mid = (cy + half * 0.16).toFixed(1);
  return `<path d="M${cx - half} ${cy} Q${cx} ${low} ${cx + half} ${cy} Q${cx} ${mid} ${cx - half} ${cy}Z" fill="${ink}"/>`;
}

function speciesShapes(species: Species, primary: string, secondary: string): string {
  const ink = contrastInk(primary);
  const inkOnSecondary = contrastInk(secondary);
  switch (species) {
    case "cat":
      return [
        `<ellipse cx="31" cy="58" rx="24" ry="12" fill="${primary}"/>`,
        `<circle cx="31" cy="38" r="21" fill="${primary}"/>`,
        `<path d="M14 28 Q10 10 20 5 Q28 10 26 28 Z" fill="${primary}"/>`,
        `<path d="M36 28 Q34 10 44 5 Q52 10 48 28 Z" fill="${primary}"/>`,
        `<ellipse cx="19" cy="16" rx="4" ry="5" fill="${secondary}"/>`,
        `<ellipse cx="45" cy="16" rx="4" ry="5" fill="${secondary}"/>`,
        `<ellipse cx="31" cy="47" rx="7" ry="5" fill="${secondary}"/>`,
        eyes(31, 36, 8, 4.4, ink),
        `<ellipse cx="31" cy="45" rx="2" ry="1.4" fill="${inkOnSecondary}"/>`,
        smile(31, 50, 4, ink),
      ].join("");
    case "dog":
      return [
        `<ellipse cx="30" cy="60" rx="22" ry="12" fill="${primary}"/>`,
        `<circle cx="32" cy="34" r="18" fill="${primary}"/>`,
        `<ellipse cx="12" cy="42" rx="8" ry="14" fill="${secondary}"/>`,
        `<ellipse cx="52" cy="40" rx="8" ry="14" fill="${secondary}"/>`,
        `<ellipse cx="34" cy="44" rx="11" ry="8" fill="${secondary}"/>`,
        eyes(30, 31, 7, 4.1, ink),
        `<ellipse cx="34" cy="43" rx="2.8" ry="2" fill="${inkOnSecondary}"/>`,
        smile(34, 49, 5, inkOnSecondary),
      ].join("");
    case "bear":
      return [
        `<ellipse cx="32" cy="60" rx="26" ry="12" fill="${primary}"/>`,
        `<circle cx="15" cy="14" r="9" fill="${primary}"/>`,
        `<circle cx="49" cy="13" r="9" fill="${primary}"/>`,
        `<circle cx="32" cy="36" r="24" fill="${primary}"/>`,
        `<circle cx="15" cy="11" r="4" fill="${secondary}"/>`,
        `<circle cx="49" cy="10" r="4" fill="${secondary}"/>`,
        `<ellipse cx="32" cy="48" rx="13" ry="10" fill="${secondary}"/>`,
        eyes(32, 33, 8, 4.3, ink),
        `<ellipse cx="32" cy="46" rx="3.4" ry="2.4" fill="${inkOnSecondary}"/>`,
        smile(32, 53, 5, inkOnSecondary),
      ].join("");
    case "bunny":
      return [
        `<ellipse cx="32" cy="62" rx="18" ry="10" fill="${primary}"/>`,
        `<ellipse cx="24" cy="22" rx="5" ry="20" fill="${primary}"/>`,
        `<ellipse cx="42" cy="20" rx="5" ry="20" fill="${primary}"/>`,
        `<circle cx="33" cy="46" r="16" fill="${primary}"/>`,
        `<ellipse cx="24" cy="16" rx="2.4" ry="12" fill="${secondary}"/>`,
        `<ellipse cx="42" cy="14" rx="2.4" ry="12" fill="${secondary}"/>`,
        eyes(33, 44, 6, 3.6, ink),
        `<ellipse cx="33" cy="51" rx="2.4" ry="1.8" fill="${secondary}"/>`,
      ].join("");
    case "fox":
      return [
        `<ellipse cx="18" cy="16" rx="9" ry="10" fill="${primary}"/>`,
        `<ellipse cx="46" cy="15" rx="9" ry="10" fill="${primary}"/>`,
        `<ellipse cx="32" cy="60" rx="22" ry="12" fill="${primary}"/>`,
        `<circle cx="32" cy="36" r="20" fill="${primary}"/>`,
        `<ellipse cx="40" cy="52" rx="15" ry="12" fill="${secondary}"/>`,
        eyes(30, 32, 7.5, 4.2, ink),
        `<ellipse cx="42" cy="48" rx="3.2" ry="2.2" fill="${inkOnSecondary}"/>`,
      ].join("");
    case "bird":
      return [
        `<circle cx="28" cy="34" r="24" fill="${primary}"/>`,
        `<ellipse cx="54" cy="38" rx="11" ry="7" fill="${secondary}"/>`,
        eyes(26, 32, 7.5, 4.6, ink),
      ].join("");
    case "panda":
      return [
        `<circle cx="14" cy="14" r="10" fill="${secondary}"/>`,
        `<circle cx="50" cy="13" r="10" fill="${secondary}"/>`,
        `<ellipse cx="32" cy="60" rx="24" ry="12" fill="${primary}"/>`,
        `<circle cx="32" cy="36" r="22" fill="${primary}"/>`,
        `<ellipse cx="21" cy="34" rx="8" ry="9" fill="${secondary}"/>`,
        `<ellipse cx="43" cy="34" rx="8" ry="9" fill="${secondary}"/>`,
        `<circle cx="21" cy="34" r="4.4" fill="${inkOnSecondary}"/>`,
        `<circle cx="43" cy="34" r="4.4" fill="${inkOnSecondary}"/>`,
        `<ellipse cx="32" cy="46" rx="3.6" ry="2.4" fill="${secondary}"/>`,
        smile(32, 51, 4, ink),
      ].join("");
    case "frog":
      return [
        `<ellipse cx="32" cy="44" rx="26" ry="18" fill="${primary}"/>`,
        `<circle cx="18" cy="22" r="11" fill="${secondary}"/>`,
        `<circle cx="46" cy="20" r="11" fill="${secondary}"/>`,
        `<circle cx="18" cy="22" r="5" fill="${inkOnSecondary}"/>`,
        `<circle cx="46" cy="20" r="5" fill="${inkOnSecondary}"/>`,
        smile(32, 48, 9, ink),
      ].join("");
    default: {
      const _exhaustive: never = species;
      return _exhaustive;
    }
  }
}

/**
 * Build a square SVG mascot for the given seed.
 * Same seed always yields the same species, corner, palette, and markup.
 */
export function buildIpMascotPortraitSvg(seed: string): string {
  const h = hashSeed(seed.trim() || "avatar");
  const species = SPECIES[h % SPECIES.length]!;
  const corner: Corner = (h >>> 8) & 1 ? "right" : "left";
  const palette = PALETTES[(h >>> 16) % PALETTES.length]!;
  const body = speciesShapes(species, palette.primary, palette.secondary);
  const transform = corner === "left" ? "translate(-3 2)" : "translate(67 2) scale(-1 1)";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW} ${VIEW}" width="${VIEW}" height="${VIEW}"`,
    ` data-portrait="ip-mascot" data-species="${species}" data-corner="${corner}">`,
    `<rect width="${VIEW}" height="${VIEW}" fill="${palette.bg}"/>`,
    `<g transform="${transform}">${body}</g>`,
    `</svg>`,
  ].join("");
}

export function buildIpMascotPortraitDataUri(seed: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(buildIpMascotPortraitSvg(seed))}`;
}
