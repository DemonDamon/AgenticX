import { DEFAULT_META_AVATAR_URL } from "../constants/meta-avatar";
import { useAppStore } from "../store";
import { displayedMetaAvatarUrl } from "../utils/expert-portrait";
import { listNearPickedLooks } from "../utils/near-picked-looks";

/** Near's face in chat: cube costume, or the shared gallery style. */
export function useDisplayedMetaAvatarUrl(): string {
  const cubeUrl = useAppStore((s) => s.metaAvatarUrl);
  const style = useAppStore((s) => s.collectionPortraitStyle);
  const nearSeed = useAppStore((s) => s.nearSeedsByStyle[style] ?? "");
  const options = listNearPickedLooks(style).find((item) => item.key === nearSeed)?.options ?? {};
  return displayedMetaAvatarUrl(style, cubeUrl, nearSeed, options).trim() || DEFAULT_META_AVATAR_URL;
}
