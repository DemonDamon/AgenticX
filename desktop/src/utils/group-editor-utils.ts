type SanitizeGroupAvatarIdsInput = {
  requestedIds: Iterable<string>;
  validAvatarIds: Iterable<string>;
};

type SanitizeGroupAvatarIdsOutput = {
  avatarIds: string[];
  removedIds: string[];
};

export function sanitizeGroupAvatarIds(
  input: SanitizeGroupAvatarIdsInput,
): SanitizeGroupAvatarIdsOutput {
  const validSet = new Set<string>();
  for (const id of input.validAvatarIds) {
    const normalized = String(id ?? "").trim();
    if (normalized) validSet.add(normalized);
  }

  const avatarIds: string[] = [];
  const removedIds: string[] = [];
  const dedup = new Set<string>();
  for (const raw of input.requestedIds) {
    const id = String(raw ?? "").trim();
    if (!id || dedup.has(id)) continue;
    dedup.add(id);
    if (validSet.has(id)) avatarIds.push(id);
    else removedIds.push(id);
  }

  return { avatarIds, removedIds };
}

export function getGroupSaveErrorMessage(error?: string): string {
  const raw = String(error ?? "").trim();
  if (!raw) return "保存失败，请稍后重试。";
  if (extractUnknownAvatarIdFromError(raw)) {
    return "检测到群成员里包含已失效分身，已自动过滤。请确认成员后再次保存。";
  }
  return raw;
}

export function extractUnknownAvatarIdFromError(error?: string): string | undefined {
  const raw = String(error ?? "");
  const match = raw.match(/unknown avatar_id:\s*([A-Za-z0-9_-]+)/i);
  const avatarId = String(match?.[1] ?? "").trim();
  return avatarId || undefined;
}
