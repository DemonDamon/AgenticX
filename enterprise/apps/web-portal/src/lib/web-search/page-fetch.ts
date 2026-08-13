/**
 * Fetch and extract main text from HTML pages for deep-research evidence.
 * Pluggable backends with fallback chain; never throws — failures return null.
 */

import { directFetch, type DirectFetch } from "./direct-fetch";
import {
  normalizeWebSearchResultUrl,
  resolveSafeWebSearchResultUrl,
} from "./provider-endpoint";
import {
  DEFAULT_BACKEND_CHAIN,
  isTerminalFailure,
  isTransientFailure,
  resolveBackend,
  type PageFetchBackendName,
  type PageFetchFailure,
} from "./page-fetch-backends";
export {
  extractMainText,
  MAX_PAGE_CHARS,
  MIN_USABLE_PAGE_CHARS,
} from "./page-fetch-extract";
export {
  DEFAULT_BACKEND_CHAIN,
  isTerminalFailure,
  isTransientFailure,
  type PageFetchBackendName,
  type PageFetchFailure,
} from "./page-fetch-backends";

export const PAGE_FETCH_TIMEOUT_MS = 12_000;
export const PAGE_FETCH_CONCURRENCY = 4;
/** Same-host network/timeout failures before skipping remaining URLs in a batch. */
export const HOST_FAILURE_THRESHOLD = 3;
/** Same-backend retries per URL for transient failures. */
export const TRANSIENT_RETRIES = 1;
export const TRANSIENT_RETRY_DELAY_MS = 300;

/** Abort-aware sleep; resolves early when the run is cancelled. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type PageContent = {
  url: string;
  /** 提取后的纯文本正文，已截断到 MAX_PAGE_CHARS。 */
  text: string;
  /** 提取字符数（截断前），用于可观测性。 */
  rawChars: number;
  /** 实际产出正文的后端，用于落盘元信息与排障。 */
  backend: PageFetchBackendName;
};

export type PageFetchDeps = {
  fetchImpl?: DirectFetch;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** 依次尝试，首个成功即返回；缺省用 DEFAULT_BACKEND_CHAIN。 */
  backends?: PageFetchBackendName[];
  apiKeys?: Partial<Record<PageFetchBackendName, string>>;
  /** 瞬时失败的重试次数（按 URL 计），缺省 TRANSIENT_RETRIES；测试可置 0。 */
  transientRetries?: number;
};

/** 批量抓取的失败原因计数（供事件展示）。 */
export type FetchStats = Record<PageFetchFailure, number>;

export function emptyFetchStats(): FetchStats {
  return {
    invalid_url: 0,
    http_error: 0,
    unsupported_content_type: 0,
    too_short: 0,
    timeout: 0,
    network_error: 0,
  };
}

const FAILURE_LABELS: Record<PageFetchFailure, string> = {
  timeout: "超时",
  http_error: "请求失败",
  unsupported_content_type: "非网页内容",
  too_short: "正文过短",
  network_error: "网络错误",
  invalid_url: "链接无效",
};

/** 取计数最高的前 2 类失败原因，拼成「3 超时 · 2 非网页内容」。 */
export function summarizeFetchFailures(stats: FetchStats): string {
  const ranked = (Object.entries(stats) as Array<[PageFetchFailure, number]>)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);
  if (ranked.length === 0) return "";
  return ranked.map(([reason, n]) => `${n} ${FAILURE_LABELS[reason]}`).join(" · ");
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

type PageFetchAttempt = {
  page: PageContent | null;
  failure?: PageFetchFailure;
};

/** 抓取并提取正文；任何失败都返回 null（调用方降级到 snippet），绝不抛。 */
export async function fetchPageContent(
  url: string,
  deps?: PageFetchDeps,
): Promise<PageContent | null> {
  const attempt = await fetchPageContentWithReason(url, deps);
  return attempt.page;
}

async function fetchPageContentWithReason(
  url: string,
  deps?: PageFetchDeps,
): Promise<PageFetchAttempt> {
  const fetchImpl = deps?.fetchImpl ?? directFetch;
  const timeoutMs = deps?.timeoutMs ?? PAGE_FETCH_TIMEOUT_MS;
  const backends =
    deps?.backends && deps.backends.length > 0 ? deps.backends : DEFAULT_BACKEND_CHAIN;

  let lastFailure: PageFetchFailure | undefined;
  // One retry budget per URL (not per backend), so a flaky host gets a second
  // chance without letting a dead one multiply the worst-case latency.
  let transientRetriesLeft = deps?.transientRetries ?? TRANSIENT_RETRIES;

  let safeUrl: string;
  let connectAddress: string | undefined;
  try {
    safeUrl = normalizeWebSearchResultUrl(url);
    // Production native fetches pin the same public DNS answer that passed the
    // SSRF check. Injected test/custom transports remain responsible for their
    // own connection semantics but still receive the synchronous URL policy.
    if (fetchImpl === directFetch) {
      const resolved = await resolveSafeWebSearchResultUrl(safeUrl);
      safeUrl = resolved.url;
      connectAddress = resolved.address;
    }
  } catch {
    return { page: null, failure: "invalid_url" };
  }

  for (const name of backends) {
    const backend = resolveBackend(name);
    while (true) {
      const result = await backend(safeUrl, {
        fetchImpl,
        timeoutMs,
        signal: deps?.signal,
        apiKey: deps?.apiKeys?.[name],
        ...(name === "native" && connectAddress ? { connectAddress } : {}),
      });

      if (result.ok) {
        return {
          page: {
            url,
            text: result.text,
            rawChars: result.rawChars,
            backend: name,
          },
        };
      }

      lastFailure = result.reason;
      if (
        transientRetriesLeft > 0 &&
        isTransientFailure(result.reason) &&
        !deps?.signal?.aborted
      ) {
        transientRetriesLeft -= 1;
        await delay(TRANSIENT_RETRY_DELAY_MS, deps?.signal);
        continue;
      }
      break;
    }

    if (lastFailure && isTerminalFailure(lastFailure)) {
      break;
    }
  }

  if (lastFailure && process.env.AGX_PAGE_FETCH_VERBOSE === "1") {
    console.warn("[page-fetch]", url, lastFailure);
  }
  return { page: null, failure: lastFailure };
}

/** 并发批量抓取，保序返回，失败位置为 null。 */
export async function fetchPagesBatch(
  urls: string[],
  deps?: PageFetchDeps & { concurrency?: number },
): Promise<{ pages: Array<PageContent | null>; stats: FetchStats }> {
  const concurrency = Math.max(1, deps?.concurrency ?? PAGE_FETCH_CONCURRENCY);
  const pages: Array<PageContent | null> = new Array(urls.length).fill(null);
  const stats = emptyFetchStats();
  const hostFailures = new Map<string, number>();
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= urls.length) return;
      const target = urls[index];
      if (!target) {
        pages[index] = null;
        continue;
      }

      const host = safeHost(target);
      if (host && (hostFailures.get(host) ?? 0) >= HOST_FAILURE_THRESHOLD) {
        // 同一 host 已连续失败达阈值，本批次直接跳过，把预算留给还可能通的源。
        pages[index] = null;
        stats.network_error += 1;
        continue;
      }

      const attempt = await fetchPageContentWithReason(target, deps);
      pages[index] = attempt.page;
      if (!attempt.page && attempt.failure) {
        stats[attempt.failure] += 1;
        if (
          host &&
          (attempt.failure === "network_error" || attempt.failure === "timeout")
        ) {
          hostFailures.set(host, (hostFailures.get(host) ?? 0) + 1);
        }
      } else if (host) {
        hostFailures.delete(host);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, urls.length)) }, () => worker()),
  );

  const summary = summarizeFetchFailures(stats);
  if (summary) {
    console.warn(`[page-fetch] batch: ${urls.length} urls, ${summary}`);
  }
  return { pages, stats };
}
