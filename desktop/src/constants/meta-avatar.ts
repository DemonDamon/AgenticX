/** Bundled default Near meta-agent avatar: official brand-orange 3D mark. */
export const DEFAULT_META_AVATAR_URL: string = new URL(
  "../../assets/export_embedded.png",
  import.meta.url,
).href;

/**
 * The official PNG cube only fills ~65% of the canvas. Small avatar slots
 * (28px chat, 20px identity pill) zoom the mark so it matches filled discs.
 */
export const BUNDLED_META_AVATAR_IM_ZOOM_CLASS = "scale-[1.48]";

/** Collectible user / expert cubes fill the SVG frame; keep them uncropped. */
export const NEAR_CUBE_AVATAR_FIT_CLASS = "origin-center object-contain scale-[1.2]";

const BUNDLED_META_AVATAR_FILE =
  /(?:^|[\\/])(?:export_embedded|near-cube-mark)(?:-[^\\/]+)?\.(?:png|svg)(?:\?|#|$)/i;

export function isBundledMetaAvatarUrl(url?: string | null): boolean {
  const value = String(url ?? "").trim();
  if (!value) return false;
  if (value === DEFAULT_META_AVATAR_URL) return true;
  return BUNDLED_META_AVATAR_FILE.test(value);
}

/** Legacy dual-orange SVG / hashed Vite URL → official brand PNG. */
export function resolveBundledMetaAvatarUrl(url?: string | null): string {
  const value = String(url ?? "").trim();
  if (!value || isBundledMetaAvatarUrl(value)) return DEFAULT_META_AVATAR_URL;
  return value;
}
