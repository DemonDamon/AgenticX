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

export type ChatTranslate = (key: string, options?: Record<string, unknown>) => string;

export function formatTurnUsageLabel(usage: MessageUsage, t: ChatTranslate): string {
  const count = formatTurnUsageCount(usage);
  return count ? t("usage.turnCost", { count }) : "";
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

export function formatTurnCacheHitLabel(hit: { percent: number }, t: ChatTranslate): string {
  return t("usage.cachePercent", { percent: hit.percent.toFixed(1) });
}

export function formatTurnCacheHitTip(
  hit: {
    percent: number;
    cached: string;
    input: string;
  },
  t: ChatTranslate,
): string {
  return t("usage.cacheHitTip", {
    percent: hit.percent.toFixed(1),
    cached: hit.cached,
    input: hit.input,
  });
}

export function formatTurnUsageTitle(usage: MessageUsage, t: ChatTranslate): string {
  const parts = [
    t("usage.titleInput", { count: usage.inputTokens.toLocaleString("en-US") }),
    t("usage.titleOutput", { count: usage.outputTokens.toLocaleString("en-US") }),
  ];
  if (usage.cachedTokens > 0) {
    parts.push(t("usage.titleCache", { count: usage.cachedTokens.toLocaleString("en-US") }));
  }
  const hit = formatTurnCacheHit(usage);
  if (hit) {
    parts.push(
      t("usage.titleHit", {
        percent: hit.percent.toFixed(1),
        cached: hit.cached,
        input: hit.input,
      }),
    );
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
