/**
 * 一次性探测 portal 容器能否出公网。
 * 客户内网常完全隔离，此时 deep-research 会空跑满预算并交出无引用报告。
 */

import type { DirectFetch } from "./direct-fetch";

/**
 * 探测目标要覆盖「客户实际要抓的那片网」，而不是某一家搜索引擎。
 *
 * 这个探测门控的是抓取搜索结果页正文；国内租户用豆包/博查搜出来的结果绝大多数是
 * 国内站点，所以必须有国内可达的目标，否则一台网络完全正常的国内机器会因为够不到
 * 墙外站点而被判成「无法出网」，正文抓取全部关掉，报告只剩摘要。
 *
 * direct-fetch.ts 顶部的注释早就写明了 CN 网络需要本地代理才能到 DuckDuckGo——
 * 拿它当唯一判据等于默认所有客户都挂着代理。
 */
const DEFAULT_PROBE_TARGETS = [
  "https://www.baidu.com",
  "https://www.bing.com",
  "https://www.cloudflare.com",
  "https://duckduckgo.com",
];
const PROBE_TIMEOUT_MS = 4_000;
const PROBE_TTL_MS = 60_000;
/** 只要拿到响应头就够了，别为一次连通性判断拖回整个首页。 */
const PROBE_MAX_BYTES = 64 * 1024;

let cached: { at: number; ok: boolean } | null = null;

export function resetEgressProbeForTests(): void {
  cached = null;
}

/**
 * 纯内网部署可以用 DEEP_RESEARCH_EGRESS_PROBE_TARGETS 换成自家镜像站，
 * 否则他们永远探不通，而这台机器其实能抓到内网文档。
 */
export function egressProbeTargets(): string[] {
  const configured = (process.env.DEEP_RESEARCH_EGRESS_PROBE_TARGETS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : DEFAULT_PROBE_TARGETS;
}

export async function probeEgress(
  fetchImpl: DirectFetch,
  now: () => number = () => Date.now(),
): Promise<boolean> {
  if (cached && now() - cached.at < PROBE_TTL_MS) return cached.ok;

  // 并发探，第一个通的就算通。串行的话隔离网络里每个目标都要等满超时，
  // 目标越多开跑前的死等越久——这正是之前只敢放两个目标的原因。
  const ok = await Promise.all(
    egressProbeTargets().map(async (target) => {
      try {
        const res = await fetchImpl(target, {
          method: "GET",
          timeoutMs: PROBE_TIMEOUT_MS,
          maxResponseBytes: PROBE_MAX_BYTES,
        });
        return res.status > 0;
      } catch {
        return false;
      }
    }),
  ).then((results) => results.some(Boolean));

  cached = { at: now(), ok };
  return ok;
}
