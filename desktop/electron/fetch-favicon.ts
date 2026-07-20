/**
 * Fetch site favicons in the Electron main process via proxyAwareFetch.
 *
 * Renderer <img> does not honor HTTPS_PROXY / HTTP_PROXY; with Clash/env-only
 * proxy, google.com / duckduckgo.com favicon CDNs fail and WorkPanel falls
 * back to Globe for every row. Main-process fetch mirrors validate-key etc.
 *
 * Author: Damon Li
 */

import { proxyAwareFetch } from "./proxy-fetch";

export type FetchFaviconResult =
  | { ok: true; dataUrl: string; host: string }
  | { ok: false; error: string };

const cache = new Map<string, FetchFaviconResult>();
const inflight = new Map<string, Promise<FetchFaviconResult>>();

function hostnameFromUrlOrDomain(urlOrDomain: string): string {
  const raw = String(urlOrDomain || "").trim();
  if (!raw) return "";
  try {
    if (/^https?:\/\//i.test(raw)) {
      return new URL(raw).hostname.replace(/^www\./i, "").toLowerCase();
    }
  } catch {
    // fall through
  }
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

/** Full host + parent domain (sohu.com from www.sohu.com / m.sohu.com). */
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

function candidateUrls(host: string, size: number): string[] {
  return [
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`,
    `https://favicon.yandex.net/favicon/${encodeURIComponent(host)}`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`,
  ];
}

function mimeFromContentType(ct: string | null, url: string): string {
  const raw = String(ct || "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  if (raw?.startsWith("image/")) return raw;
  if (url.endsWith(".ico")) return "image/x-icon";
  if (url.endsWith(".png")) return "image/png";
  if (url.endsWith(".svg")) return "image/svg+xml";
  return "image/png";
}

/** DDG returns a ~1.4KB default PNG on HTTP 404 — reject non-OK / tiny junk. */
const MIN_BYTES = 64;

async function tryFetchOne(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await proxyAwareFetch(url, {
      signal: controller.signal,
      headers: { Accept: "image/*,*/*;q=0.8" },
    });
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < MIN_BYTES) return null;
    const mime = mimeFromContentType(resp.headers.get("content-type"), url);
    if (mime.includes("text/html") || mime.includes("application/json")) return null;
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFaviconUncached(
  url?: string,
  domain?: string,
  size = 32,
): Promise<FetchFaviconResult> {
  const root =
    hostnameFromUrlOrDomain(domain || "") || hostnameFromUrlOrDomain(url || "");
  if (!root) return { ok: false, error: "missing host" };

  for (const host of hostVariants(root)) {
    for (const candidate of candidateUrls(host, size)) {
      const dataUrl = await tryFetchOne(candidate);
      if (dataUrl) return { ok: true, dataUrl, host };
    }
  }
  return { ok: false, error: `no favicon for ${root}` };
}

export async function fetchFaviconDataUrl(payload: {
  url?: string;
  domain?: string;
  size?: number;
}): Promise<FetchFaviconResult> {
  const root =
    hostnameFromUrlOrDomain(payload.domain || "") ||
    hostnameFromUrlOrDomain(payload.url || "");
  if (!root) return { ok: false, error: "missing host" };

  const cacheKey = `${root}|${payload.size ?? 32}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const pending = inflight.get(cacheKey);
  if (pending) return pending;

  const job = fetchFaviconUncached(payload.url, payload.domain, payload.size ?? 32)
    .then((result) => {
      cache.set(cacheKey, result);
      inflight.delete(cacheKey);
      return result;
    })
    .catch((err) => {
      const result: FetchFaviconResult = { ok: false, error: String(err) };
      cache.set(cacheKey, result);
      inflight.delete(cacheKey);
      return result;
    });

  inflight.set(cacheKey, job);
  return job;
}
