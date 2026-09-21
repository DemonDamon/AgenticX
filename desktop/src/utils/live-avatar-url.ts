/**
 * Prefer the current registry portrait over a snapshot baked into a message.
 * Author: Damon Li
 */
import { isBundledMetaAvatarUrl } from "../constants/meta-avatar";

export function preferLiveAvatarUrl(
  liveUrl?: string | null,
  storedUrl?: string | null,
): string | undefined {
  const live = String(liveUrl ?? "").trim();
  if (live) return live;
  const stored = String(storedUrl ?? "").trim();
  return stored || undefined;
}

/** Official brand mark yields to the meta-agent cube costume. */
export function preferCostumeOverBrandMark(
  imageUrl?: string | null,
  userCostumeUrl?: string | null,
): string | undefined {
  const costume = String(userCostumeUrl ?? "").trim();
  const resolved = String(imageUrl ?? "").trim();
  if (costume && (!resolved || isBundledMetaAvatarUrl(resolved))) {
    return costume;
  }
  return resolved || undefined;
}

export function isRegistryAvatarId(avatarId?: string | null): boolean {
  const id = String(avatarId ?? "").trim();
  return Boolean(id) && id !== "meta" && id !== "__meta__";
}

export function findLiveAvatar<T extends { id: string; name: string }>(
  avatars: readonly T[],
  opts: { avatarId?: string | null; name?: string | null },
): T | undefined {
  const id = String(opts.avatarId ?? "").trim();
  if (isRegistryAvatarId(id)) {
    const byId = avatars.find((item) => item.id === id);
    if (byId) return byId;
  }
  const name = String(opts.name ?? "").trim();
  if (!name || name === "分身") return undefined;
  return avatars.find((item) => item.name === name);
}
