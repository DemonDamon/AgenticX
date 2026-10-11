import {
  CUBE_PORTRAIT_STYLE,
  buildCollectionPortraitDataUri,
  isCustomExpertPortrait,
  portraitSeed,
  writeCollectionPortraitStyle,
  type CollectionStyleId,
} from "./expert-portrait";

export type ExpertPortraitTarget = {
  id: string;
  name: string;
  portraitStyle?: string;
  avatarUrl?: string;
};

export async function applyCollectionStyleToExperts(opts: {
  style: CollectionStyleId;
  avatars: ExpertPortraitTarget[];
  updateAvatar: (payload: {
    id: string;
    avatar_url: string;
    portrait_style: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  onUpdated?: (row: { id: string; avatarUrl: string; portraitStyle: string }) => void;
}): Promise<{ updated: number; skipped: number; error?: string }> {
  writeCollectionPortraitStyle(opts.style);
  let updated = 0;
  let skipped = 0;
  for (const avatar of opts.avatars) {
    if (isCustomExpertPortrait(avatar)) {
      skipped += 1;
      continue;
    }
    const payload =
      opts.style === CUBE_PORTRAIT_STYLE
        ? { id: avatar.id, avatar_url: "", portrait_style: CUBE_PORTRAIT_STYLE }
        : {
            id: avatar.id,
            avatar_url: buildCollectionPortraitDataUri(
              opts.style,
              portraitSeed(avatar.name, avatar.id),
            ),
            portrait_style: opts.style,
          };
    const result = await opts.updateAvatar(payload);
    if (!result.ok) {
      return { updated, skipped, error: result.error || "update failed" };
    }
    updated += 1;
    if (payload.avatar_url) {
      opts.onUpdated?.({
        id: avatar.id,
        avatarUrl: payload.avatar_url,
        portraitStyle: payload.portrait_style,
      });
    }
  }
  return { updated, skipped };
}
