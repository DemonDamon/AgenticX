import { i18n } from "../i18n/i18n";

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
  if (!raw) return String(i18n.t("groups.saveFailed", { ns: "sidebar" }));
  if (extractUnknownAvatarIdFromError(raw)) {
    return String(i18n.t("groups.unknownAvatarFiltered", { ns: "sidebar" }));
  }
  return raw;
}

export function extractUnknownAvatarIdFromError(error?: string): string | undefined {
  const raw = String(error ?? "");
  const match = raw.match(/unknown avatar_id:\s*([A-Za-z0-9_-]+)/i);
  const avatarId = String(match?.[1] ?? "").trim();
  return avatarId || undefined;
}
