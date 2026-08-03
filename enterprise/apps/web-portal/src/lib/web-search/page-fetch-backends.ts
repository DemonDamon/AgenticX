/**
 * Pluggable page-fetch backends for deep research.
 * native = bare HTTP + regex extract; jina / firecrawl = external readers.
 */

import type { DirectFetch } from "./direct-fetch";
import {
  extractMainText,
  MAX_PAGE_CHARS,
  MIN_USABLE_PAGE_CHARS,
} from "./page-fetch-extract";

export type PageFetchBackendName = "native" | "jina" | "firecrawl";

export const DEFAULT_BACKEND_CHAIN: PageFetchBackendName[] = ["native", "jina"];

/** 抓取失败原因，用于可观测性与 UI 提示。 */
export type PageFetchFailure =
  | "invalid_url"
  | "http_error"
  | "unsupported_content_type"
  | "too_short"
  | "timeout"
  | "network_error";

export type BackendResult =
  | { ok: true; text: string; rawChars: number }
  | { ok: false; reason: PageFetchFailure };

export type BackendDeps = {
  fetchImpl: DirectFetch;
  timeoutMs: number;
  signal?: AbortSignal;
  apiKey?: string;
};

export type PageFetchBackend = (url: string, deps: BackendDeps) => Promise<BackendResult>;

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function isHtmlOrPlain(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return ct.includes("text/html") || ct.includes("text/plain");
}

function classifyFetchError(error: unknown): PageFetchFailure {
  if (error instanceof Error) {
    const name = error.name;
    if (name === "TimeoutError" || name === "AbortError") return "timeout";
    const msg = error.message.toLowerCase();
    if (msg.includes("timeout") || msg.includes("aborted")) return "timeout";
  }
  return "network_error";
}

function truncateText(extracted: string): { text: string; rawChars: number } {
  const rawChars = extracted.length;
  const text =
    rawChars > MAX_PAGE_CHARS ? `${extracted.slice(0, MAX_PAGE_CHARS).trimEnd()}…` : extracted;
  return { text, rawChars };
}

export const nativeBackend: PageFetchBackend = async (url, deps) => {
  try {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, reason: "invalid_url" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, reason: "invalid_url" };
    }

    const res = await deps.fetchImpl(parsed.toString(), {
      method: "GET",
      timeoutMs: deps.timeoutMs,
      signal: deps.signal,
      headers: {
        "user-agent": DESKTOP_UA,
        accept: "text/html,*/*",
      },
    });

    if (!res.ok) return { ok: false, reason: "http_error" };
    const contentType = res.headers.get("content-type") ?? "";
    if (!isHtmlOrPlain(contentType)) {
      return { ok: false, reason: "unsupported_content_type" };
    }

    const rawHtml = await res.text();
    const cappedHtml = rawHtml.slice(0, MAX_PAGE_CHARS * 8);
    const extracted = extractMainText(cappedHtml);
    if (extracted.length < MIN_USABLE_PAGE_CHARS) {
      return { ok: false, reason: "too_short" };
    }
    const { text, rawChars } = truncateText(extracted);
    return { ok: true, text, rawChars };
  } catch (error) {
    return { ok: false, reason: classifyFetchError(error) };
  }
};

export const jinaBackend: PageFetchBackend = async (url, deps) => {
  try {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, reason: "invalid_url" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, reason: "invalid_url" };
    }

    const jinaUrl = `https://r.jina.ai/${parsed.toString()}`;
    const headers: Record<string, string> = {
      accept: "text/plain",
    };
    const key = deps.apiKey?.trim();
    if (key) headers.authorization = `Bearer ${key}`;

    const res = await deps.fetchImpl(jinaUrl, {
      method: "GET",
      timeoutMs: deps.timeoutMs,
      signal: deps.signal,
      headers,
    });

    if (!res.ok) return { ok: false, reason: "http_error" };
    const extracted = (await res.text()).trim();
    if (extracted.length < MIN_USABLE_PAGE_CHARS) {
      return { ok: false, reason: "too_short" };
    }
    const { text, rawChars } = truncateText(extracted);
    return { ok: true, text, rawChars };
  } catch (error) {
    return { ok: false, reason: classifyFetchError(error) };
  }
};

export const firecrawlBackend: PageFetchBackend = async (url, deps) => {
  const key = deps.apiKey?.trim();
  if (!key) return { ok: false, reason: "network_error" };

  try {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, reason: "invalid_url" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, reason: "invalid_url" };
    }

    const base =
      process.env.PAGE_FETCH_FIRECRAWL_BASE_URL?.trim().replace(/\/+$/, "") ||
      "https://api.firecrawl.dev";
    const endpoint = `${base}/v1/scrape`;

    const res = await deps.fetchImpl(endpoint, {
      method: "POST",
      timeoutMs: deps.timeoutMs,
      signal: deps.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ url: parsed.toString(), formats: ["markdown"] }),
    });

    if (!res.ok) return { ok: false, reason: "http_error" };
    const payload = (await res.json()) as {
      data?: { markdown?: string };
      markdown?: string;
    };
    const extracted = (payload.data?.markdown ?? payload.markdown ?? "").trim();
    if (extracted.length < MIN_USABLE_PAGE_CHARS) {
      return { ok: false, reason: "too_short" };
    }
    const { text, rawChars } = truncateText(extracted);
    return { ok: true, text, rawChars };
  } catch (error) {
    return { ok: false, reason: classifyFetchError(error) };
  }
};

export function resolveBackend(name: PageFetchBackendName): PageFetchBackend {
  switch (name) {
    case "native":
      return nativeBackend;
    case "jina":
      return jinaBackend;
    case "firecrawl":
      return firecrawlBackend;
    default: {
      const _exhaustive: never = name;
      return _exhaustive;
    }
  }
}

/** Deterministic failures: do not try subsequent backends. */
export function isTerminalFailure(reason: PageFetchFailure): boolean {
  return reason === "invalid_url" || reason === "unsupported_content_type";
}
