/**
 * Build favicon image URLs for a web reference (Trae-style site icons).
 *
 * Author: Damon Li
 */

/** Extract hostname from a URL or bare domain string. */
export function hostnameFromUrlOrDomain(urlOrDomain: string): string {
  const raw = String(urlOrDomain || "").trim();
  if (!raw) return "";
  try {
    if (/^https?:\/\//i.test(raw)) {
      return new URL(raw).hostname.replace(/^www\./i, "").toLowerCase();
    }
  } catch {
    // fall through
  }
  // Bare domain / host:port
  const host = raw
    .replace(/^\/\//, "")
    .split("/")[0]
    ?.split("?")[0]
    ?.split("#")[0]
    ?.trim()
    .toLowerCase();
  if (!host || host.includes(" ")) return "";
  return host.replace(/^www\./i, "");
}

/** Primary favicon CDN (Google s2) — same approach as many AI IDEs. */
export function googleFaviconUrl(hostname: string, size = 32): string {
  const host = hostnameFromUrlOrDomain(hostname);
  if (!host) return "";
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`;
}

/** Fallback when Google s2 fails or returns a generic placeholder. */
export function duckDuckGoFaviconUrl(hostname: string): string {
  const host = hostnameFromUrlOrDomain(hostname);
  if (!host) return "";
  return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`;
}

export function resolveFaviconCandidates(
  url?: string,
  domain?: string,
  size = 32,
): string[] {
  const host =
    hostnameFromUrlOrDomain(domain || "") || hostnameFromUrlOrDomain(url || "");
  if (!host) return [];
  const primary = googleFaviconUrl(host, size);
  const fallback = duckDuckGoFaviconUrl(host);
  return [primary, fallback].filter(Boolean);
}
