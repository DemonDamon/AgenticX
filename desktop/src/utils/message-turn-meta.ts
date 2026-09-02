import type { MessageUsage, ModelSelection } from "../store";
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
  return { inputTokens, outputTokens, cachedTokens, reasoningTokens, totalTokens };
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
    `本轮输入 ${usage.inputTokens.toLocaleString("en-US")}（含重发的上下文）`,
    `输出 ${usage.outputTokens.toLocaleString("en-US")}`,
  ];
  if (usage.cachedTokens > 0) {
    parts.push(`缓存 ${usage.cachedTokens.toLocaleString("en-US")}`);
  }
  return parts.join(" · ");
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
