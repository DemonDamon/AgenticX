/** Bundled default Near meta-agent avatar (`desktop/assets/export_embedded.png`, aligned with app branding). */
export const DEFAULT_META_AVATAR_URL: string = new URL(
  "../../assets/export_embedded.png",
  import.meta.url,
).href;

/**
 * The cube only fills ~65% of the PNG. Small avatar slots (28px chat, 20px
 * identity pill) zoom the mark so it matches filled portrait discs.
 */
export const BUNDLED_META_AVATAR_IM_ZOOM_CLASS = "scale-[1.48]";

const BUNDLED_META_AVATAR_FILE = /(?:^|[\\/])export_embedded(?:-[^\\/]+)?\.png(?:\?|#|$)/i;

export function isBundledMetaAvatarUrl(url?: string | null): boolean {
  const value = String(url ?? "").trim();
  if (!value) return false;
  if (value === DEFAULT_META_AVATAR_URL) return true;
  return BUNDLED_META_AVATAR_FILE.test(value);
}
