/**
 * 一次性探测 portal 容器能否出公网。
 * 客户内网常完全隔离，此时 deep-research 会空跑满预算并交出无引用报告。
 */

import type { DirectFetch } from "./direct-fetch";

const PROBE_TARGETS = ["https://www.bing.com", "https://duckduckgo.com"];
const PROBE_TIMEOUT_MS = 4_000;
const PROBE_TTL_MS = 60_000;

let cached: { at: number; ok: boolean } | null = null;

export function resetEgressProbeForTests(): void {
  cached = null;
}

export async function probeEgress(
  fetchImpl: DirectFetch,
  now: () => number = () => Date.now(),
): Promise<boolean> {
  if (cached && now() - cached.at < PROBE_TTL_MS) return cached.ok;
  let ok = false;
  for (const target of PROBE_TARGETS) {
    try {
      const res = await fetchImpl(target, { method: "GET", timeoutMs: PROBE_TIMEOUT_MS });
      if (res.status > 0) {
        ok = true;
        break;
      }
    } catch {
      // try next
    }
  }
  cached = { at: now(), ok };
  return ok;
}
