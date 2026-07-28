/**
 * Server-side favicon fetch for portal UI (client cannot rely on Google s2 in CN).
 */

import { directFetch, type DirectFetch } from "./direct-fetch";

export type FaviconPayload = {
  bytes: Uint8Array;
  contentType: string;
};

/** Per upstream candidate — keep short so Clash/proxy hangs cannot pin Next.js. */
const PER_URL_MS = 1_200;
/** Hard budget for the whole host (all variants × candidates). */
const OVERALL_MS = 2_500;
const POSITIVE_TTL_MS = 5 * 60_000;
const NEGATIVE_TTL_MS = 60_000;

type CacheEntry =
  | { ok: true; payload: FaviconPayload; expiresAt: number }
  | { ok: false; expiresAt: number };

const faviconCache = new Map<string, CacheEntry>();
const faviconInflight = new Map<string, Promise<FaviconPayload | null>>();

/** Test-only: clear process-local favicon cache / in-flight map. */
export function resetFaviconCacheForTests(): void {
  faviconCache.clear();
  faviconInflight.clear();
}

const HOST_RE = /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
]);

export function normalizeFaviconHost(raw: string): string | null {
  const host = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
  if (!host || BLOCKED_HOSTS.has(host)) return null;
  if (HOST_RE.test(host) === false) return null;
  // Block obvious private / link-local style hostnames
  if (
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    return null;
  }
  return host;
}

/** Parent domain variants — aligned with Near Desktop / portal chat favicon-url. */
export function hostVariants(host: string): string[] {
  const h = normalizeFaviconHost(host);
  if (!h) return [];
  const out: string[] = [h];
  const parts = h.split(".");
  if (
    parts.length >= 3 &&
    parts[parts.length - 1] === "cn" &&
    ["com", "net", "org", "gov", "edu"].includes(parts[parts.length - 2] ?? "")
  ) {
    const parent = parts.slice(-3).join(".");
    if (!out.includes(parent)) out.push(parent);
  } else if (parts.length >= 3) {
    const parent = parts.slice(-2).join(".");
    if (!out.includes(parent)) out.push(parent);
  }
  return out;
}

export function faviconFetchUrls(host: string): string[] {
  return [
    `https://icons.duckduckgo.com/ip3/${host}.ico`,
    `https://favicon.yandex.net/favicon/${host}`,
    `https://${host}/favicon.ico`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
  ];
}

function sniffContentType(bytes: Uint8Array, fallback: string): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 4 &&
    ((bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) ||
      (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x02 && bytes[3] === 0x00))
  ) {
    return "image/x-icon";
  }
  if (
    bytes.length >= 4 &&
    String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) === "RIFF"
  ) {
    return "image/webp";
  }
  // SVG / HTML error pages — reject
  const head = new TextDecoder().decode(bytes.slice(0, 64)).trim().toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<svg")) {
    if (head.includes("<svg")) return "image/svg+xml";
    return "";
  }
  return fallback.includes("image/") ? fallback : "image/x-icon";
}

async function fetchFaviconBytesUncached(
  host: string,
  fetchImpl: DirectFetch,
): Promise<FaviconPayload | null> {
  const variants = hostVariants(host);
  if (variants.length === 0) return null;

  const started = Date.now();
  for (const variant of variants) {
    for (const url of faviconFetchUrls(variant)) {
      const elapsed = Date.now() - started;
      if (elapsed >= OVERALL_MS) return null;
      const perTry = Math.min(PER_URL_MS, Math.max(200, OVERALL_MS - elapsed));
      try {
        const res = await fetchImpl(url, {
          method: "GET",
          headers: { accept: "image/*,*/*;q=0.8" },
          signal: AbortSignal.timeout(perTry),
          timeoutMs: perTry,
          redirect: "follow",
        });
        if (!res.ok) continue;
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength < 16 || buf.byteLength > 512_000) continue;
        const contentType = sniffContentType(
          buf,
          res.headers.get("content-type")?.split(";")[0]?.trim() || "image/x-icon",
        );
        if (!contentType.startsWith("image/")) continue;
        return { bytes: buf, contentType };
      } catch {
        // try next candidate
      }
    }
  }
  return null;
}

export async function fetchFaviconBytes(
  host: string,
  fetchImpl: DirectFetch = directFetch,
): Promise<FaviconPayload | null> {
  const cacheKey = normalizeFaviconHost(host);
  if (!cacheKey) return null;

  const cached = faviconCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.ok ? cached.payload : null;
  }

  const existing = faviconInflight.get(cacheKey);
  if (existing) return existing;

  const run = (async () => {
    const payload = await fetchFaviconBytesUncached(cacheKey, fetchImpl);
    if (payload) {
      faviconCache.set(cacheKey, {
        ok: true,
        payload,
        expiresAt: Date.now() + POSITIVE_TTL_MS,
      });
    } else {
      faviconCache.set(cacheKey, {
        ok: false,
        expiresAt: Date.now() + NEGATIVE_TTL_MS,
      });
    }
    return payload;
  })();

  faviconInflight.set(cacheKey, run);
  try {
    return await run;
  } finally {
    faviconInflight.delete(cacheKey);
  }
}
