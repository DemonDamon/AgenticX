/**
 * Local portrait recipes for the signed-in human.
 * Five curated styles, generated in-process. Near cubes stay elsewhere.
 * Author: Damon Li
 */
import { createAvatar, type Style } from "@dicebear/core";
import * as botttsNeutral from "@dicebear/bottts-neutral";
import * as loreleiNeutral from "@dicebear/lorelei-neutral";
import * as notionistsNeutral from "@dicebear/notionists-neutral";
import * as pixelArtNeutral from "@dicebear/pixel-art-neutral";
import * as ringsStyle from "@dicebear/rings";

export const STUDIO_STYLE_IDS = [
  "notionists-neutral",
  "lorelei-neutral",
  "bottts-neutral",
  "pixel-art-neutral",
  "rings",
] as const;

export type StudioStyleId = (typeof STUDIO_STYLE_IDS)[number];

export type StudioOptionValue = string | number | boolean | string[];

export type IdentityStudioRecipe = {
  source: "studio" | "upload";
  style: StudioStyleId;
  seed: string;
  seedFrozen?: boolean;
  options: Record<string, StudioOptionValue>;
};

export type StudioTweakId =
  | "glasses"
  | "brows"
  | "freckles"
  | "tone"
  | "accessory"
  | "rings"
  | "background";

export type StudioTweak = {
  id: StudioTweakId;
  choices: readonly string[];
};

const LIGHT_BACKGROUND = ["e7e5e4"] as const;
const CLEAR_BACKGROUND = ["transparent"] as const;
const MAX_AVATAR_URI_CHARS = 180_000;
const PREVIEW_SEED = "Felix";

const BOOLEAN_TWEAKS = new Set<StudioTweakId>(["glasses", "freckles", "accessory"]);

const STYLES: Record<StudioStyleId, Style<Record<string, unknown>>> = {
  "notionists-neutral": notionistsNeutral as unknown as Style<Record<string, unknown>>,
  "lorelei-neutral": loreleiNeutral as unknown as Style<Record<string, unknown>>,
  "bottts-neutral": botttsNeutral as unknown as Style<Record<string, unknown>>,
  "pixel-art-neutral": pixelArtNeutral as unknown as Style<Record<string, unknown>>,
  rings: ringsStyle as unknown as Style<Record<string, unknown>>,
};

export const STUDIO_TWEAKS: Record<StudioStyleId, readonly StudioTweak[]> = {
  "notionists-neutral": [
    { id: "glasses", choices: ["off", "on"] },
    { id: "brows", choices: ["soft", "strong"] },
    { id: "background", choices: ["none", "light"] },
  ],
  "lorelei-neutral": [
    { id: "glasses", choices: ["off", "on"] },
    { id: "freckles", choices: ["off", "on"] },
    { id: "background", choices: ["none", "light"] },
  ],
  "bottts-neutral": [
    { id: "tone", choices: ["dark", "light"] },
    { id: "accessory", choices: ["off", "on"] },
    { id: "background", choices: ["none", "light"] },
  ],
  "pixel-art-neutral": [
    { id: "glasses", choices: ["off", "on"] },
    { id: "background", choices: ["none", "light"] },
  ],
  rings: [
    { id: "rings", choices: ["few", "many"] },
    { id: "background", choices: ["none", "light"] },
  ],
};

const previewCache = new Map<StudioStyleId, string>();
let studioSeedSerial = 0;

export function isStudioStyleId(value: unknown): value is StudioStyleId {
  return typeof value === "string" && (STUDIO_STYLE_IDS as readonly string[]).includes(value);
}

export function defaultOptionsForStyle(style: StudioStyleId): Record<string, StudioOptionValue> {
  // Light disc: black line art disappears on dark surfaces.
  switch (style) {
    case "notionists-neutral":
      return { glasses: false, brows: "soft", background: "light" };
    case "lorelei-neutral":
      return { glasses: false, freckles: false, background: "light" };
    case "bottts-neutral":
      return { tone: "light", accessory: false, background: "light" };
    case "pixel-art-neutral":
      return { glasses: false, background: "light" };
    case "rings":
      return { rings: "few", background: "light" };
    default: {
      const unreachable: never = style;
      return unreachable;
    }
  }
}

export function defaultRecipe(nickname: string): IdentityStudioRecipe {
  const seed = nickname.trim() || "me";
  return {
    source: "studio",
    style: "notionists-neutral",
    seed,
    seedFrozen: false,
    options: defaultOptionsForStyle("notionists-neutral"),
  };
}

export function randomStudioSeed(): string {
  studioSeedSerial += 1;
  return `studio-${Date.now().toString(36)}-${studioSeedSerial.toString(36)}`;
}

export function normalizeOptions(
  style: StudioStyleId,
  options: Record<string, unknown>,
): Record<string, unknown> {
  const backgroundColor = options.background === "light" ? [...LIGHT_BACKGROUND] : [...CLEAR_BACKGROUND];
  switch (style) {
    case "notionists-neutral":
      return {
        glassesProbability: flagOn(options.glasses) ? 100 : 0,
        brows: options.brows === "strong"
          ? ["variant10", "variant11", "variant12", "variant13"]
          : ["variant01", "variant02", "variant03", "variant04"],
        backgroundColor,
      };
    case "lorelei-neutral":
      return {
        glassesProbability: flagOn(options.glasses) ? 100 : 0,
        frecklesProbability: flagOn(options.freckles) ? 100 : 0,
        backgroundColor,
      };
    case "bottts-neutral":
      return {
        eyes: options.tone === "dark"
          ? ["shade01", "robocop", "frame1", "frame2"]
          : ["glow", "happy", "round", "eva"],
        mouth: flagOn(options.accessory)
          ? ["grill01", "grill02", "grill03", "bite", "diagram"]
          : ["smile01", "smile02"],
        backgroundColor,
      };
    case "pixel-art-neutral":
      return {
        glassesProbability: flagOn(options.glasses) ? 100 : 0,
        backgroundColor,
      };
    case "rings":
      return options.rings === "many"
        ? {
            ringOne: ["full"],
            ringTwo: ["full"],
            ringThree: ["full"],
            ringFour: ["full"],
            ringFive: ["full"],
            backgroundColor,
          }
        : {
            ringFour: [],
            ringFive: [],
            backgroundColor,
          };
    default: {
      const unreachable: never = style;
      return unreachable;
    }
  }
}

export function buildStudioSvgDataUri(recipe: IdentityStudioRecipe): string {
  const at128 = renderStudioSvg(recipe, 128);
  if (at128.length <= MAX_AVATAR_URI_CHARS) return at128;
  return renderStudioSvg(recipe, 96);
}

export function stylePreviewDataUri(style: StudioStyleId): string {
  const cached = previewCache.get(style);
  if (cached) return cached;
  const uri = buildStudioSvgDataUri({
    source: "studio",
    style,
    seed: PREVIEW_SEED,
    seedFrozen: true,
    options: defaultOptionsForStyle(style),
  });
  previewCache.set(style, uri);
  return uri;
}

export function parseIdentityStudioRecipe(raw: unknown): IdentityStudioRecipe | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value.source !== "studio" && value.source !== "upload") return null;
  if (!isStudioStyleId(value.style)) return null;
  return {
    source: value.source,
    style: value.style,
    seed: typeof value.seed === "string" ? value.seed : "",
    seedFrozen: value.seedFrozen === true,
    options: sanitizeOptions(value.options),
  };
}

export function tweakValue(recipe: IdentityStudioRecipe, id: StudioTweakId): string {
  const raw = recipe.options[id];
  if (raw === true || raw === "on") return "on";
  if (raw === false || raw === "off") return "off";
  if (typeof raw === "string" && raw) return raw;
  const fallback = defaultOptionsForStyle(recipe.style)[id];
  if (fallback === true) return "on";
  if (fallback === false) return "off";
  if (typeof fallback === "string") return fallback;
  return "";
}

export function recipeWithStyle(recipe: IdentityStudioRecipe, style: StudioStyleId): IdentityStudioRecipe {
  return {
    ...recipe,
    style,
    options: defaultOptionsForStyle(style),
  };
}

export function recipeWithShuffle(recipe: IdentityStudioRecipe): IdentityStudioRecipe {
  return {
    ...recipe,
    seed: randomStudioSeed(),
    seedFrozen: true,
  };
}

export function recipeWithTweak(
  recipe: IdentityStudioRecipe,
  id: StudioTweakId,
  choice: string,
): IdentityStudioRecipe {
  const value: StudioOptionValue = BOOLEAN_TWEAKS.has(id) ? choice === "on" : choice;
  return {
    ...recipe,
    options: { ...recipe.options, [id]: value },
  };
}

function flagOn(value: unknown): boolean {
  return value === true || value === "on";
}

function renderStudioSvg(recipe: IdentityStudioRecipe, size: number): string {
  const style = STYLES[recipe.style];
  const avatar = createAvatar(style, {
    seed: recipe.seed.trim() || "me",
    size,
    ...normalizeOptions(recipe.style, recipe.options),
  });
  const marked = avatar.toString().replace("<svg ", '<svg data-portrait="identity-studio" ');
  return `data:image/svg+xml;utf8,${encodeURIComponent(marked)}`;
}

function sanitizeOptions(raw: unknown): Record<string, StudioOptionValue> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, StudioOptionValue> = {};
  for (const [key, item] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      out[key] = item;
      continue;
    }
    if (Array.isArray(item) && item.every((part) => typeof part === "string")) {
      out[key] = item;
    }
  }
  return out;
}
