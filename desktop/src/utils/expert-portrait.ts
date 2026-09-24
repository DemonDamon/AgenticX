/**
 * Collection portrait styles for digital experts.
 * Cube stays the default and is generated on the backend.
 * Author: Damon Li
 */
import { Avatar, OptionsDescriptor, Style, type StyleDefinition } from "@dicebear/core";
import adventurerJson from "@dicebear/styles/adventurer.json";
import adventurerNeutralJson from "@dicebear/styles/adventurer-neutral.json";
import avataaarsJson from "@dicebear/styles/avataaars.json";
import blobsJson from "@dicebear/styles/blobs.json";
import botttsJson from "@dicebear/styles/bottts.json";
import botttsNeutralJson from "@dicebear/styles/bottts-neutral.json";
import clayJson from "@dicebear/styles/clay.json";
import crittersJson from "@dicebear/styles/critters.json";
import croodlesNeutralJson from "@dicebear/styles/croodles-neutral.json";
import cutoutsJson from "@dicebear/styles/cutouts.json";
import discoJson from "@dicebear/styles/disco.json";
import funEmojiJson from "@dicebear/styles/fun-emoji.json";
import gazeJson from "@dicebear/styles/gaze.json";
import identiconJson from "@dicebear/styles/identicon.json";
import landscapeJson from "@dicebear/styles/landscape.json";
import loreleiJson from "@dicebear/styles/lorelei.json";
import micahJson from "@dicebear/styles/micah.json";
import planetsJson from "@dicebear/styles/planets.json";
import squirclesJson from "@dicebear/styles/squircles.json";
import thumbsJson from "@dicebear/styles/thumbs.json";
import voxelArtJson from "@dicebear/styles/voxel-art.json";
import voxelBotJson from "@dicebear/styles/voxel-bot.json";
import wavesJson from "@dicebear/styles/waves.json";

export const CUBE_PORTRAIT_STYLE = "near-cube-v3";
export const COLLECTION_PORTRAIT_STORAGE_KEY = "agx-expert-collection-portrait";

const MINIMAL_STYLES = ["blobs", "disco", "identicon", "squircles", "waves"] as const;
const CHARACTER_STYLES = [
  "adventurer",
  "adventurer-neutral",
  "avataaars",
  "bottts",
  "bottts-neutral",
  "clay",
  "critters",
  "croodles-neutral",
  "cutouts",
  "fun-emoji",
  "gaze",
  "lorelei",
  "micah",
  "thumbs",
  "voxel-art",
  "voxel-bot",
] as const;
const SCENE_STYLES = ["landscape", "planets"] as const;

export const COLLECTION_STYLE_IDS = [
  CUBE_PORTRAIT_STYLE,
  ...MINIMAL_STYLES,
  ...CHARACTER_STYLES,
  ...SCENE_STYLES,
] as const;

export type CollectionStyleId = (typeof COLLECTION_STYLE_IDS)[number];
export type CharacterStyleId = Exclude<CollectionStyleId, typeof CUBE_PORTRAIT_STYLE>;

export const PORTRAIT_GROUPS: ReadonlyArray<{
  id: "minimalist" | "characters" | "scenes";
  labelKey: "gallery.styleGroupMinimal" | "gallery.styleGroupCharacters" | "gallery.styleGroupScenes";
  styles: readonly CharacterStyleId[];
}> = [
  { id: "minimalist", labelKey: "gallery.styleGroupMinimal", styles: MINIMAL_STYLES },
  { id: "characters", labelKey: "gallery.styleGroupCharacters", styles: CHARACTER_STYLES },
  { id: "scenes", labelKey: "gallery.styleGroupScenes", styles: SCENE_STYLES },
];

function asStyle(definition: object): Style<StyleDefinition> {
  return new Style(definition as StyleDefinition);
}

const STYLE_LIBRARY: Record<CharacterStyleId, Style<StyleDefinition>> = {
  blobs: asStyle(blobsJson),
  disco: asStyle(discoJson),
  identicon: asStyle(identiconJson),
  squircles: asStyle(squirclesJson),
  waves: asStyle(wavesJson),
  adventurer: asStyle(adventurerJson),
  "adventurer-neutral": asStyle(adventurerNeutralJson),
  avataaars: asStyle(avataaarsJson),
  bottts: asStyle(botttsJson),
  "bottts-neutral": asStyle(botttsNeutralJson),
  clay: asStyle(clayJson),
  critters: asStyle(crittersJson),
  "croodles-neutral": asStyle(croodlesNeutralJson),
  cutouts: asStyle(cutoutsJson),
  "fun-emoji": asStyle(funEmojiJson),
  gaze: asStyle(gazeJson),
  lorelei: asStyle(loreleiJson),
  micah: asStyle(micahJson),
  thumbs: asStyle(thumbsJson),
  "voxel-art": asStyle(voxelArtJson),
  "voxel-bot": asStyle(voxelBotJson),
  landscape: asStyle(landscapeJson),
  planets: asStyle(planetsJson),
};

export function isCollectionStyleId(value: unknown): value is CollectionStyleId {
  return typeof value === "string" && (COLLECTION_STYLE_IDS as readonly string[]).includes(value);
}

export function portraitSeed(name: string, avatarId: string): string {
  const namePart = name.trim() || "avatar";
  const idPart = avatarId.trim();
  return idPart ? `${namePart}:${idPart}` : namePart;
}

export function loadCollectionPortraitStyle(): CollectionStyleId {
  try {
    if (typeof window === "undefined") return CUBE_PORTRAIT_STYLE;
    const saved = window.localStorage.getItem(COLLECTION_PORTRAIT_STORAGE_KEY);
    return isCollectionStyleId(saved) ? saved : CUBE_PORTRAIT_STYLE;
  } catch {
    return CUBE_PORTRAIT_STYLE;
  }
}

export function writeCollectionPortraitStyle(style: CollectionStyleId): void {
  try {
    if (typeof window === "undefined") return;
    if (style === CUBE_PORTRAIT_STYLE) {
      window.localStorage.removeItem(COLLECTION_PORTRAIT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(COLLECTION_PORTRAIT_STORAGE_KEY, style);
  } catch {
    // ignore storage errors
  }
}

function decodeSvgDataUrl(url: string): string {
  const raw = url.trim();
  if (!raw.startsWith("data:image/svg+xml")) return "";
  const comma = raw.indexOf(",");
  if (comma < 0) return "";
  const meta = raw.slice(0, comma);
  const payload = raw.slice(comma + 1);
  try {
    if (/;base64/i.test(meta)) return atob(payload);
    return decodeURIComponent(payload);
  } catch {
    return "";
  }
}

/** Generated cube / collection faces stay replaceable, even if an older save marked them custom. */
export function isGeneratedExpertPortraitUrl(url: string): boolean {
  const svg = decodeSvgDataUrl(url);
  if (!svg) return false;
  return svg.includes('data-portrait="dicebear-') || svg.includes('data-portrait="near-cube');
}

export function isCustomExpertPortrait(opts: {
  portraitStyle?: string;
  avatarUrl?: string;
}): boolean {
  const url = (opts.avatarUrl || "").trim();
  if (isGeneratedExpertPortraitUrl(url)) return false;
  if ((opts.portraitStyle || "").trim() === "custom") return true;
  if (!url) return false;
  if (url.startsWith("data:image/svg+xml")) return false;
  return /^(data:image\/(png|jpeg|jpg|webp|gif)|https?:)/i.test(url);
}

export function describeStyleOptions(style: CollectionStyleId): string {
  if (style === CUBE_PORTRAIT_STYLE) return "";
  const descriptor = new OptionsDescriptor(STYLE_LIBRARY[style]).toJSON();
  const ranked = Object.entries(descriptor).sort(([a], [b]) => {
    const score = (name: string) =>
      /hair|glass|outfit|jacket|shirt|pant|suit|top|beard/i.test(name) ? 0 : 1;
    return score(a) - score(b);
  });
  const lines: string[] = [];
  for (const [name, field] of ranked) {
    if (name === "seed" || name === "size" || name === "scale" || name === "rotate" || name === "flip") continue;
    if (field.type === "enum") lines.push(`${name}: ${field.values.slice(0, 16).join("|")}`);
    else if (field.type === "color") lines.push(`${name}: #RRGGBB`);
    else if (field.type === "boolean") lines.push(`${name}: true|false`);
    else if (field.type === "number") lines.push(`${name}: 0-100`);
    if (lines.length >= 36) break;
  }
  return lines.join("\n");
}

export function promptToStyleOptions(
  style: CollectionStyleId,
  prompt: string,
): Record<string, string | string[] | boolean | number> {
  if (style === CUBE_PORTRAIT_STYLE) return {};
  const descriptor = new OptionsDescriptor(STYLE_LIBRARY[style]).toJSON();
  const text = prompt.trim();
  const next: Record<string, string | string[] | boolean | number> = {};
  const setColor = (name: string, hex: string) => {
    if (descriptor[name]?.type !== "color") return;
    next[name] = [hex];
    const order = `${name}Order`;
    if (descriptor[order]?.type === "enum") next[order] = "fixed";
  };
  const setEnum = (name: string, value: string) => {
    const field = descriptor[name];
    if (field?.type === "enum" && field.values.includes(value)) next[name] = value;
  };
  const setProb = (name: string, value: number) => {
    if (descriptor[name]?.type === "number") next[name] = value;
  };
  if (/金发|金色发|金色头发|头发是金色|头发金色|黄发|黄色头发/.test(text)) setColor("hairColor", "#E6B325");
  else if (/粉红发|粉色发|粉红色头发|粉色头发|头发是粉/.test(text)) setColor("hairColor", "#F9A8D4");
  else if (/黑发|黑色头发|头发是黑|头发黑/.test(text)) setColor("hairColor", "#1C1917");
  else if (/白发|白色头发|银发|头发是白|头发是银/.test(text)) setColor("hairColor", "#E7E5E4");
  else if (/红发|红色头发|头发是红|头发红/.test(text)) setColor("hairColor", "#E11D48");
  else if (/棕发|棕色头发|头发是棕|头发棕/.test(text)) setColor("hairColor", "#9A3412");
  if (/不戴眼镜|不带眼镜|没戴眼镜|不要眼镜|无眼镜/.test(text)) setProb("glassesProbability", 0);
  else if (/戴眼镜|带眼镜|装眼镜/.test(text)) {
    setProb("glassesProbability", 100);
    setEnum("glassesVariant", "square");
  }
  if (/领带/.test(text)) setEnum("outfitVariant", "tie");
  else if (/西装|西服/.test(text)) setEnum("outfitVariant", "suit");
  if (/西装|西服|领带/.test(text)) setProb("outfitProbability", 100);
  if (/黑西装|黑色西装|黑西服|黑色西服/.test(text)) {
    setColor("jacketColor", "#1C1917");
    setColor("shirtColor", "#1C1917");
    setColor("pantsColor", "#1C1917");
  } else if (/白西装|白色西装|白西服/.test(text)) {
    setColor("jacketColor", "#F5F5F4");
    setColor("shirtColor", "#F5F5F4");
    setColor("pantsColor", "#F5F5F4");
  }
  if (/女生|女孩|女性|女的/.test(text)) {
    setProb("beardProbability", 0);
    setEnum("topVariant", "longStraight");
    setProb("topProbability", 100);
  } else if (/男生|男孩|男性|男的/.test(text)) {
    setEnum("topVariant", "bowl");
    setProb("topProbability", 100);
  }
  return next;
}

export function sanitizeStyleOptions(
  style: CollectionStyleId,
  raw: Record<string, unknown>,
): Record<string, string | string[] | boolean | number> {
  if (style === CUBE_PORTRAIT_STYLE) return {};
  const descriptor = new OptionsDescriptor(STYLE_LIBRARY[style]).toJSON();
  const next: Record<string, string | string[] | boolean | number> = {};
  for (const [name, value] of Object.entries(raw)) {
    const field = descriptor[name];
    if (!field) continue;
    if (field.type === "boolean" && typeof value === "boolean") next[name] = value;
    if (field.type === "number" && typeof value === "number") next[name] = value;
    if (field.type === "enum" && typeof value === "string" && field.values.includes(value)) next[name] = value;
    if (field.type === "color" && typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) {
      next[name] = [value];
      const order = `${name}Order`;
      if (descriptor[order]?.type === "enum") next[order] = "fixed";
    }
  }
  return next;
}

export function buildCollectionPortraitDataUri(
  style: CollectionStyleId,
  seed: string,
  options: Record<string, string | string[] | boolean | number> = {},
): string {
  if (style === CUBE_PORTRAIT_STYLE) return "";
  const svg = new Avatar(STYLE_LIBRARY[style], {
    seed: seed.trim() || "avatar",
    size: 128,
    ...options,
  }).toString();
  const marked = svg.replace(/<svg\b/, `<svg data-portrait="dicebear-${style}"`);
  return `data:image/svg+xml;utf8,${encodeURIComponent(marked)}`;
}

export function displayedMetaAvatarUrl(
  style: CollectionStyleId,
  cubeUrl: string,
  nearSeed = "",
  options: Record<string, string | string[] | boolean | number> = {},
): string {
  const cube = cubeUrl.trim();
  if (style === CUBE_PORTRAIT_STYLE) return cube;
  const seed = nearSeed.trim() || portraitSeed("Near", "meta");
  return buildCollectionPortraitDataUri(style, seed, options);
}

export function collectionPortraitCreateFields(name: string): {
  avatar_url?: string;
  portrait_style?: string;
} {
  const style = loadCollectionPortraitStyle();
  if (style === CUBE_PORTRAIT_STYLE) return {};
  return {
    avatar_url: buildCollectionPortraitDataUri(style, portraitSeed(name, "")),
    portrait_style: style,
  };
}
