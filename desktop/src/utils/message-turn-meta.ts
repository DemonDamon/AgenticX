import type { MessageUsage, ModelSelection } from "../store";
import { formatHitPercent } from "./cache-hit";
import { normalizeBareModelId } from "./model-display";

export function parseMessageUsage(raw: unknown): MessageUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const n = (value: unknown) => {
    const x = Number(value);
    return Number.isFinite(x) && x > 0 ? Math.trunc(x) : 0;
  };
  const inputTokens = n(o.input_tokens ?? o.inputTokens);
  const outputTokens = n(o.output_tokens ?? o.outputTokens);
  const cachedTokens = n(o.cached_tokens ?? o.cachedTokens);
  const reasoningTokens = n(o.reasoning_tokens ?? o.reasoningTokens);
  let totalTokens = n(o.total_tokens ?? o.totalTokens);
  if (totalTokens <= 0) totalTokens = inputTokens + outputTokens;
  if (inputTokens <= 0 && outputTokens <= 0 && totalTokens <= 0 && cachedTokens <= 0) {
    return undefined;
  }
  const turnInputTokens = n(o.turn_input_tokens ?? o.turnInputTokens);
  const turnOutputTokens = n(o.turn_output_tokens ?? o.turnOutputTokens);
  const turnCachedTokens = n(o.turn_cached_tokens ?? o.turnCachedTokens);
  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    reasoningTokens,
    totalTokens,
    ...(turnInputTokens > 0 || turnOutputTokens > 0 || turnCachedTokens > 0
      ? { turnInputTokens, turnOutputTokens, turnCachedTokens }
      : {}),
  };
}

export function formatTurnUsageCount(usage: MessageUsage): string {
  const n = usage.totalTokens > 0 ? usage.totalTokens : usage.inputTokens + usage.outputTokens;
  if (n <= 0) return "";
  return n.toLocaleString("en-US");
}

export function formatTurnUsageLabel(usage: MessageUsage): string {
  const count = formatTurnUsageCount(usage);
  return count ? `本轮消耗 ${count}` : "";
}

/** Compact token count matching the context popup's `formatK` (1234 -> "1.2K"). */
export function formatCompactTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.trunc(n));
}

/**
 * Input and output shown separately: a turn's input carries the whole re-sent
 * context, so a single summed number reads as if one turn outgrew the session.
 */
export function formatTurnUsageSplit(
  usage: MessageUsage,
): { input: string; output: string } | undefined {
  if (usage.inputTokens <= 0 && usage.outputTokens <= 0) return undefined;
  return {
    input: formatCompactTokens(usage.inputTokens),
    output: formatCompactTokens(usage.outputTokens),
  };
}

/** Turn-level prefix-cache hit, same ratio as the session usage card. */
export function formatTurnCacheHit(
  usage: MessageUsage,
): { percent: number; cached: string; input: string } | undefined {
  const percent = formatHitPercent(usage.cachedTokens, usage.inputTokens);
  if (percent === null) return undefined;
  return {
    percent,
    cached: formatCompactTokens(usage.cachedTokens),
    input: formatCompactTokens(usage.inputTokens),
  };
}

export function formatTurnCacheHitLabel(hit: { percent: number }): string {
  return `缓存 ${hit.percent.toFixed(1)}%`;
}

export function formatTurnCacheHitTip(hit: {
  percent: number;
  cached: string;
  input: string;
}): string {
  return `本轮缓存命中 ${hit.percent.toFixed(1)}%（${hit.cached} / ${hit.input}）。越高说明重复上下文越多，不是窗口占用。`;
}

/**
 * A finished turn that carries a model but no usage means the provider never
 * sent the trailing usage chunk — typically an aborted stream. The prompt was
 * still billed upstream, so say so rather than rendering nothing.
 */
export const TURN_USAGE_MISSING_LABEL = "用量未返回";

export const TURN_USAGE_MISSING_TITLE =
  "本轮用量未返回：模型未回传用量（多为响应中断），厂商侧仍会计费";

export function formatTurnUsageTitle(usage: MessageUsage): string {
  const parts = [
    `本次请求输入 ${usage.inputTokens.toLocaleString("en-US")}`,
    `输出 ${usage.outputTokens.toLocaleString("en-US")}`,
  ];
  if (usage.cachedTokens > 0) {
    parts.push(`缓存 ${usage.cachedTokens.toLocaleString("en-US")}`);
  }
  const hit = formatTurnCacheHit(usage);
  if (hit) {
    parts.push(`命中 ${hit.percent.toFixed(1)}%（${hit.cached} / ${hit.input}）`);
  }
  return parts.join(" · ");
}

/** Pane session chip still bills the whole tool loop; footer uses last request. */
export function sessionAccumulateFromUsageEvent(
  raw: unknown,
  parsed: MessageUsage,
): { input: number; output: number; cached: number } {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const turnIn = Number(row.turn_input_tokens ?? 0);
  const turnOut = Number(row.turn_output_tokens ?? 0);
  const turnCached = Number(row.turn_cached_tokens ?? 0);
  if (turnIn > 0 || turnOut > 0 || turnCached > 0) {
    return {
      input: Number.isFinite(turnIn) ? Math.max(0, Math.trunc(turnIn)) : 0,
      output: Number.isFinite(turnOut) ? Math.max(0, Math.trunc(turnOut)) : 0,
      cached: Number.isFinite(turnCached) ? Math.max(0, Math.trunc(turnCached)) : 0,
    };
  }
  return {
    input: parsed.inputTokens,
    output: parsed.outputTokens,
    cached: parsed.cachedTokens,
  };
}

export function formatTurnModelLabel(
  model: string | undefined,
  selection?: ModelSelection,
): string {
  const bare = normalizeBareModelId(model ?? "");
  if (!bare) return "";
  return selection === "auto" ? `auto(${bare})` : bare;
}

export function parseModelSelection(raw: unknown): ModelSelection | undefined {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "auto" || s === "manual") return s;
  return undefined;
}
