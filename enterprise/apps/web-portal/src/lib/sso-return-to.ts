function isAllowlistedReturnTo(input: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  for (const item of allowlist) {
    if (input === item) return true;
    // Allow query/hash suffixes for pages like /auth/desktop?device=...
    if (input.startsWith(`${item}?`) || input.startsWith(`${item}#`)) return true;
  }
  return false;
}

export function resolveReturnToOrDefault(input: string | null): string {
  const fallback = "/workspace";
  if (!input) return fallback;
  const allowlist =
    process.env.SSO_RETURN_TO_ALLOWLIST?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? [];

  if (!input.startsWith("/") || input.startsWith("//")) return fallback;
  if (!isAllowlistedReturnTo(input, allowlist)) return fallback;
  return input;
}
