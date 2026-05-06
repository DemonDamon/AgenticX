export function resolveReturnToOrDefault(input: string | null): string {
  const fallback = "/workspace";
  if (!input) return fallback;
  const allowlist =
    process.env.SSO_RETURN_TO_ALLOWLIST?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? [];

  if (!input.startsWith("/") || input.startsWith("//")) return fallback;
  if (allowlist.length > 0 && !allowlist.includes(input)) return fallback;
  return input;
}
