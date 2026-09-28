/**
 * Local vector mascot portraits for the expert collection style rail.
 * Rounded silhouettes, two subject colors + one solid background, lower-corner emerge.
 * Author: Damon Li
 */

export const IP_MASCOT_PORTRAIT_STYLE = "ip-mascot" as const;

const SPECIES = ["cat", "dog", "bear", "bunny", "fox", "bird"] as const;
type Species = (typeof SPECIES)[number];
type Corner = "left" | "right";

type Palette = { primary: string; secondary: string; bg: string };

const PALETTES: readonly Palette[] = [
  { primary: "#F4A261", secondary: "#E76F51", bg: "#2A3A4A" },
  { primary: "#E9C46A", secondary: "#F4A261", bg: "#3D4F5F" },
  { primary: "#90BE6D", secondary: "#577590", bg: "#2F3E4E" },
  { primary: "#F28482", secondary: "#84A59D", bg: "#3A2F45" },
  { primary: "#A8DADC", secondary: "#457B9D", bg: "#1D3557" },
  { primary: "#FFB703", secondary: "#FB8500", bg: "#023047" },
  { primary: "#BDE0FE", secondary: "#FFAFCC", bg: "#415A77" },
  { primary: "#CDB4DB", secondary: "#FFC8DD", bg: "#2B2D42" },
  { primary: "#80ED99", secondary: "#57CC99", bg: "#22577A" },
  { primary: "#FFD6A5", secondary: "#FDFFB6", bg: "#3D405B" },
];

function hashSeed(seed: string): number {
  let hash = 0;
  for (const ch of seed) {
    hash = (hash * 33 + ch.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function eyeFill(primary: string): string {
  // Dark ink on light bodies, light ink on dark bodies — simple luminance gate.
  const hex = primary.replace("#", "");
  if (hex.length !== 6) return "#1C1917";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luma >= 0.55 ? "#1C1917" : "#F8FAFC";
}

function speciesShapes(species: Species, primary: string, secondary: string, ink: string): string {
  // All paths drawn in a 160x160 canvas with body mass centered lower; caller flips for right corner.
  switch (species) {
    case "cat":
      return [
        `<ellipse cx="78" cy="118" rx="52" ry="38" fill="${primary}"/>`,
        `<circle cx="78" cy="72" r="46" fill="${primary}"/>`,
        `<ellipse cx="48" cy="38" rx="16" ry="20" fill="${primary}"/>`,
        `<ellipse cx="108" cy="38" rx="16" ry="20" fill="${primary}"/>`,
        `<circle cx="62" cy="74" r="7" fill="${ink}"/>`,
        `<circle cx="94" cy="74" r="7" fill="${ink}"/>`,
        `<ellipse cx="78" cy="88" rx="5" ry="3.5" fill="${secondary}"/>`,
      ].join("");
    case "dog":
      return [
        `<ellipse cx="80" cy="120" rx="54" ry="36" fill="${primary}"/>`,
        `<circle cx="80" cy="74" r="44" fill="${primary}"/>`,
        `<ellipse cx="42" cy="78" rx="18" ry="28" fill="${secondary}"/>`,
        `<ellipse cx="118" cy="78" rx="18" ry="28" fill="${secondary}"/>`,
        `<ellipse cx="80" cy="92" rx="14" ry="10" fill="${secondary}"/>`,
        `<circle cx="64" cy="72" r="7" fill="${ink}"/>`,
        `<circle cx="96" cy="72" r="7" fill="${ink}"/>`,
      ].join("");
    case "bear":
      return [
        `<ellipse cx="80" cy="122" rx="56" ry="34" fill="${primary}"/>`,
        `<circle cx="80" cy="70" r="50" fill="${primary}"/>`,
        `<circle cx="42" cy="36" r="16" fill="${primary}"/>`,
        `<circle cx="118" cy="36" r="16" fill="${primary}"/>`,
        `<ellipse cx="80" cy="86" rx="16" ry="12" fill="${secondary}"/>`,
        `<circle cx="62" cy="68" r="8" fill="${ink}"/>`,
        `<circle cx="98" cy="68" r="8" fill="${ink}"/>`,
      ].join("");
    case "bunny":
      return [
        `<ellipse cx="80" cy="124" rx="50" ry="32" fill="${primary}"/>`,
        `<circle cx="80" cy="80" r="42" fill="${primary}"/>`,
        `<ellipse cx="52" cy="28" rx="14" ry="36" fill="${primary}"/>`,
        `<ellipse cx="108" cy="28" rx="14" ry="36" fill="${primary}"/>`,
        `<ellipse cx="52" cy="30" rx="7" ry="22" fill="${secondary}"/>`,
        `<ellipse cx="108" cy="30" rx="7" ry="22" fill="${secondary}"/>`,
        `<circle cx="66" cy="82" r="7" fill="${ink}"/>`,
        `<circle cx="94" cy="82" r="7" fill="${ink}"/>`,
      ].join("");
    case "fox":
      return [
        `<ellipse cx="80" cy="122" rx="50" ry="34" fill="${primary}"/>`,
        `<circle cx="80" cy="76" r="44" fill="${primary}"/>`,
        `<path d="M48 28 C48 28 40 58 56 62 C64 50 60 34 48 28Z" fill="${primary}"/>`,
        `<path d="M112 28 C112 28 120 58 104 62 C96 50 100 34 112 28Z" fill="${primary}"/>`,
        `<ellipse cx="80" cy="94" rx="18" ry="12" fill="${secondary}"/>`,
        `<circle cx="64" cy="74" r="7" fill="${ink}"/>`,
        `<circle cx="96" cy="74" r="7" fill="${ink}"/>`,
      ].join("");
    case "bird":
      return [
        `<ellipse cx="78" cy="118" rx="48" ry="36" fill="${primary}"/>`,
        `<circle cx="78" cy="72" r="40" fill="${primary}"/>`,
        `<ellipse cx="118" cy="78" rx="18" ry="12" fill="${secondary}"/>`,
        `<ellipse cx="54" cy="108" rx="22" ry="14" fill="${secondary}"/>`,
        `<circle cx="66" cy="70" r="7" fill="${ink}"/>`,
        `<circle cx="90" cy="70" r="7" fill="${ink}"/>`,
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
  const ink = eyeFill(palette.primary);
  const body = speciesShapes(species, palette.primary, palette.secondary, ink);
  // Flip horizontally for right-corner emergence while keeping the mass in the lower corner.
  const transform =
    corner === "left"
      ? "translate(-8, 8) scale(1.05)"
      : "translate(168, 8) scale(-1.05, 1.05)";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160"`,
    ` data-portrait="ip-mascot" data-species="${species}" data-corner="${corner}">`,
    `<rect width="160" height="160" fill="${palette.bg}"/>`,
    `<g transform="${transform}">${body}</g>`,
    `</svg>`,
  ].join("");
}

export function buildIpMascotPortraitDataUri(seed: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(buildIpMascotPortraitSvg(seed))}`;
}
