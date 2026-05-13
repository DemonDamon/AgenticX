export const DEFAULT_WEB_PORTAL_SCOPES = ["workspace:chat", "user:read"] as const;

export function getEffectiveUserScopes(scopes: string[] | undefined | null): string[] {
  const normalized =
    scopes?.map((scope) => scope.trim()).filter((scope) => scope.length > 0) ?? [];
  if (normalized.length > 0) {
    return normalized;
  }
  return [...DEFAULT_WEB_PORTAL_SCOPES];
}
