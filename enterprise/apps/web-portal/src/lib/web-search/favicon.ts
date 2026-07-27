/**
 * Server-side favicon fetch for portal UI (client cannot rely on Google s2 in CN).
 */

import { directFetch } from "./direct-fetch";

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

export function faviconFetchUrls(host: string): string[] {
  return [
    `https://icons.duckduckgo.com/ip3/${host}.ico`,
    `https://favicon.yandex.net/favicon/${host}`,
    `https://${host}/favicon.ico`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
  ];
}

export type FaviconPayload = {
  bytes: Uint8Array;
  contentType: string;
};

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

export async function fetchFaviconBytes(
  host: string,
  fetchImpl: typeof fetch = directFetch as unknown as typeof fetch,
): Promise<FaviconPayload | null> {
  const normalized = normalizeFaviconHost(host);
  if (!normalized) return null;

  for (const url of faviconFetchUrls(normalized)) {
    try {
      const res = await fetchImpl(url, {
        method: "GET",
        headers: { accept: "image/*,*/*;q=0.8" },
        signal: AbortSignal.timeout(8_000),
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
  return null;
}
