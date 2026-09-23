/**
 * Collection portrait styles for digital experts.
 * Cube stays the default and is generated on the backend.
 * Author: Damon Li
 */
import { Avatar, Style, type StyleDefinition } from "@dicebear/core";
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

export function buildCollectionPortraitDataUri(style: CollectionStyleId, seed: string): string {
  if (style === CUBE_PORTRAIT_STYLE) return "";
  const svg = new Avatar(STYLE_LIBRARY[style], {
    seed: seed.trim() || "avatar",
    size: 128,
  }).toString();
  const marked = svg.replace(/<svg\b/, `<svg data-portrait="dicebear-${style}"`);
  return `data:image/svg+xml;utf8,${encodeURIComponent(marked)}`;
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
