/**
 * Deep research stage 0: knowledge cold-start recon.
 *
 * The clarifier and planner otherwise reason purely from parametric knowledge,
 * which produces stale premises for anything released after the model cutoff.
 * A single cheap search plus today's date grounds both stages in reality.
 */

import { executeWebSearch, type WebSearchHit, type WebSearchRuntimeConfig } from "../web-search/providers";

export const RECON_RESULTS = 5;
export const RECON_SNIPPET_CHARS = 220;
export const RECON_BRIEF_MAX_CHARS = 900;
export const RECON_DEFAULT_TIMEOUT_MS = 15_000;

export type ReconResult = {
  /** Grounding block injected into clarifier / planner; empty when recon yielded nothing. */
  brief: string;
  /** Raw hits, reused by the orchestrator so recon does not burn search quota for free. */
  hits: WebSearchHit[];
};

export type ReconDeps = {
  query: string;
  searchCfg: Pick<WebSearchRuntimeConfig, "provider" | "apiKey" | "maxResults">;
  searchFn?: typeof executeWebSearch;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export function formatTodayLine(now: () => number = Date.now): string {
  const today = new Date(now()).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  return `今天是 ${today}（UTC+8）。你的训练知识可能已过期，遇到时间敏感的问题必须以下方检索到的现状为准。`;
}

function formatDay(iso: string | undefined): string {
  if (!iso) return "";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "";
  return new Date(ts).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

function condense(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > RECON_SNIPPET_CHARS ? `${flat.slice(0, RECON_SNIPPET_CHARS)}…` : flat;
}

export function buildReconBrief(hits: WebSearchHit[]): string {
  const header = "【检索到的现状（用于校准前提，非最终证据）】";
  const lines: string[] = [];
  let used = header.length;

  for (const hit of hits) {
    const title = hit.title.replace(/\s+/g, " ").trim();
    if (!title) continue;
    const day = formatDay(hit.publishedAt);
    const parts = [title, day, condense(hit.snippet ?? "")].filter(Boolean);
    const line = `- ${parts.join(" ｜ ")}`;
    // Drop whole trailing entries rather than truncating one mid-sentence.
    if (used + line.length + 1 > RECON_BRIEF_MAX_CHARS) break;
    lines.push(line);
    used += line.length + 1;
  }

  if (lines.length === 0) return "";
  return [header, ...lines].join("\n");
}

export async function runRecon(deps: ReconDeps): Promise<ReconResult> {
  const empty: ReconResult = { brief: "", hits: [] };
  const query = deps.query.trim();
  if (!query || deps.signal?.aborted) return empty;

  const searchFn = deps.searchFn ?? executeWebSearch;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(deps.signal?.reason);
  if (deps.signal) {
    if (deps.signal.aborted) controller.abort(deps.signal.reason);
    else deps.signal.addEventListener("abort", onParentAbort, { once: true });
  }

  try {
    // Keep the race for injected search functions, while production providers
    // also receive the signal and stop their actual network request.
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        controller.abort(new DOMException("recon search timed out", "TimeoutError"));
        resolve(null);
      }, deps.timeoutMs ?? RECON_DEFAULT_TIMEOUT_MS);
    });
    const hits = await Promise.race([
      searchFn(query, RECON_RESULTS, deps.searchCfg, deps.fetchImpl, {
        signal: controller.signal,
      }),
      timeout,
    ]);
    if (!Array.isArray(hits)) return empty;
    const capped = hits.slice(0, RECON_RESULTS);
    return { brief: buildReconBrief(capped), hits: capped };
  } catch {
    // Recon is an enhancement: never fail the run because cold-start search broke.
    return empty;
  } finally {
    if (timer) clearTimeout(timer);
    deps.signal?.removeEventListener("abort", onParentAbort);
  }
}
