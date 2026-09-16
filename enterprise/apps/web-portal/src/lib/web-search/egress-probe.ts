/**
 * 一次性探测 portal 容器能否出公网。
 * 内网常完全隔离，此时深度研究会空跑满预算并交出无引用报告。
 */

import type { DirectFetch } from "./direct-fetch";

/**
 * 探测目标要覆盖「实际要抓的那片网」，而不是某一家搜索引擎。
 * 默认列表含国内常可达站点；纯内网可用 DEEP_RESEARCH_EGRESS_PROBE_TARGETS 换成镜像。
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
