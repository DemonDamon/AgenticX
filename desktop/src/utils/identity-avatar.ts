/**
 * Keep the human user's photo distinct from Near's cube costume.
 * Author: Damon Li
 */
import { avatarUrlForCubeColorway } from "./cube-colorway";
import { isNearCubePortraitUrl } from "./theme-portrait";

/** Uploaded user photos only. Generated cube skins belong to Meta. */
export function isPersistedUserAvatarUrl(url: string | null | undefined): boolean {
  const value = String(url ?? "").trim();
  if (!value) return false;
  if (isNearCubePortraitUrl(value)) return false;
  return true;
}

export function resolveMetaAvatarFromColorway(colorwayId: string): string {
  return avatarUrlForCubeColorway(colorwayId);
}
