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

/**
 * Short site label for citation chips (portal parity).
 * venturebeat.com → Venturebeat; toast.com.cn → Toast.
 */
export function siteLabelFromHost(host: string): string {
  const raw = hostnameFromUrlOrDomain(host);
  if (!raw) return "";
  const parts = raw.split(".").filter(Boolean);
  let label = raw;
  if (
    parts.length >= 3 &&
    ["com", "net", "org", "gov", "edu"].includes(parts[parts.length - 2] ?? "") &&
    (parts[parts.length - 1] ?? "").length <= 3
  ) {
    label = parts[parts.length - 3] ?? raw;
  } else if (parts.length >= 2) {
    const tld = parts[parts.length - 1] ?? "";
    const sld = parts[parts.length - 2] ?? "";
    if (tld.length <= 3 && sld.length > 1) {
      label = sld;
    } else {
      label = parts[0] ?? raw;
    }
  }
  if (label.length > 18) return `${label.slice(0, 16)}…`;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function siteLabelFromUrl(
  url?: string,
  domain?: string,
  index1Based?: number,
): string {
  const host =
    hostnameFromUrlOrDomain(domain || "") || hostnameFromUrlOrDomain(url || "");
  if (!host) return index1Based ? `[${index1Based}]` : "";
  return siteLabelFromHost(host);
}

export type FaviconTone = "empty" | "light" | "normal";

/**
 * Classify favicon raster pixels so white marks do not vanish on a light plate.
 * - empty: no ink, or a solid white fill that would cover the badge
 * - light: bright mark (often on transparency) → needs a dark plate
 * - normal: dark / colorful mark → keep on a light plate
 */
export function classifyFaviconPixels(data: ArrayLike<number>): FaviconTone {
  const pixelCount = Math.floor(data.length / 4);
  if (pixelCount === 0) return "empty";

  let opaque = 0;
  let bright = 0;
  for (let i = 0; i < pixelCount; i += 1) {
    const offset = i * 4;
    const alpha = data[offset + 3] ?? 0;
    if (alpha < 24) continue;
    opaque += 1;
    const r = data[offset] ?? 0;
    const g = data[offset + 1] ?? 0;
    const b = data[offset + 2] ?? 0;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (luminance > 228) bright += 1;
  }

  if (opaque < 12) return "empty";
  const brightRatio = bright / opaque;
  const opaqueRatio = opaque / pixelCount;
  if (brightRatio >= 0.85 && opaqueRatio >= 0.75) return "empty";
  if (brightRatio >= 0.55) return "light";
  return "normal";
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
