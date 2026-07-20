/**
 * Build favicon image URLs for a web reference (Trae-style site icons).
 * Used as browser-only fallback; Electron loads via main-process IPC.
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

/** Parent / eTLD+1 variants for subdomain hits (data.eastmoney.com → eastmoney.com). */
export function hostVariants(host: string): string[] {
  const h = hostnameFromUrlOrDomain(host);
  if (!h) return [];
  const out: string[] = [];
  const add = (value: string) => {
    if (value && !out.includes(value)) out.push(value);
  };
  add(h);
  const parts = h.split(".");
  if (
    parts.length >= 3 &&
    parts[parts.length - 1] === "cn" &&
    ["com", "net", "org", "gov", "edu"].includes(parts[parts.length - 2] ?? "")
  ) {
    add(parts.slice(-3).join("."));
  } else if (parts.length >= 3) {
    add(parts.slice(-2).join("."));
  }
  return out;
}

export function googleFaviconUrl(hostname: string, size = 32): string {
  const host = hostnameFromUrlOrDomain(hostname);
  if (!host) return "";
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`;
}

export function duckDuckGoFaviconUrl(hostname: string): string {
  const host = hostnameFromUrlOrDomain(hostname);
  if (!host) return "";
  return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`;
}

export function yandexFaviconUrl(hostname: string): string {
  const host = hostnameFromUrlOrDomain(hostname);
  if (!host) return "";
  return `https://favicon.yandex.net/favicon/${encodeURIComponent(host)}`;
}

export function resolveFaviconCandidates(
  url?: string,
  domain?: string,
  size = 32,
): string[] {
  const host =
    hostnameFromUrlOrDomain(domain || "") || hostnameFromUrlOrDomain(url || "");
  if (!host) return [];
  const out: string[] = [];
  for (const variant of hostVariants(host)) {
    for (const candidate of [
      duckDuckGoFaviconUrl(variant),
      yandexFaviconUrl(variant),
      googleFaviconUrl(variant, size),
    ]) {
      if (candidate && !out.includes(candidate)) out.push(candidate);
    }
  }
  return out;
}
