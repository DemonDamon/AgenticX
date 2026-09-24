const MAX_BYTES = 24_000;

export function skillBundleAllowlist(): Set<string> {
  const raw = process.env.ENTERPRISE_SKILL_BUNDLE_HOST_ALLOWLIST ?? "";
  return new Set(
    raw
      .split(",")
      .map((host) => host.trim().toLowerCase().replace(/:\d+$/, ""))
      .filter(Boolean),
  );
}

export async function loadSkillBody(
  bundleUri: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!bundleUri) return null;
  let url: URL;
  try {
    url = new URL(bundleUri);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!skillBundleAllowlist().has(host)) return null;
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      redirect: "error",
      signal: AbortSignal.timeout(2500),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const text = (await response.text()).slice(0, MAX_BYTES);
  if (!text.startsWith("---")) return text;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return text;
  return text.slice(end + 4).replace(/^\n/, "");
}
