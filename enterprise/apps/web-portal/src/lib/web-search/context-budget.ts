import type { WebSearchHit } from "./providers";

export const DEFAULT_CONTEXT_TOKENS = 32_000;
/** Bocha summary 较长，320 会切掉数据。 */
export const WEB_SEARCH_SNIPPET_CHARS = 480;
export const MIN_SELECTED_HITS = 5;
export const MIN_SNIPPET_CHARS = 160;

function truncateSnippet(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function bareModelName(model: string | undefined): string {
  const raw = (model ?? "").trim();
  if (!raw) return "";
  const parts = raw.split("/");
  return (parts[parts.length - 1] ?? raw).trim();
}

/** 模型名 → 上下文 token 数（启发式；route 已把 provider 前缀剥掉，防御性再取最后一段）。 */
export function resolveModelContextTokens(model: string | undefined): number {
  const name = bareModelName(model);
  if (!name) return DEFAULT_CONTEXT_TOKENS;

  const explicit = name.match(/[-_](\d+)k\b/i);
  if (explicit) {
    const n = Number(explicit[1]);
    if (Number.isFinite(n) && n > 0) return n * 1000;
  }

  const lower = name.toLowerCase();
  if (/^(gpt-5|o[34])/.test(lower) || /claude/.test(lower)) return 200_000;
  if (
    /glm-?[45]/.test(lower) ||
    /kimi|moonshot/.test(lower) ||
    /qwen/.test(lower) ||
    /doubao/.test(lower) ||
    /minimax/.test(lower)
  ) {
    return 128_000;
  }
  if (/deepseek/.test(lower)) return 64_000;
  return DEFAULT_CONTEXT_TOKENS;
}

function budgetFromContextTokens(tokens: number): number {
  if (tokens >= 200_000) return 32_000;
  if (tokens >= 128_000) return 24_000;
  if (tokens >= 64_000) return 12_000;
  if (tokens >= 32_000) return 8_000;
  return 3_200;
}

/** 上下文 token → 允许注入搜索结果的字符预算。 */
export function resolveInjectionBudgetChars(model: string | undefined): number {
  const envRaw = process.env.WEB_SEARCH_CONTEXT_BUDGET_CHARS?.trim();
  if (envRaw) {
    const n = Number(envRaw);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return budgetFromContextTokens(resolveModelContextTokens(model));
}

function hitCostChars(hit: WebSearchHit, index: number, snippetChars: number): number {
  const snippet = truncateSnippet(hit.snippet ?? "", snippetChars);
  const date = hit.publishedAt ? `\n发布时间: ${hit.publishedAt}` : "";
  const facet = hit.searchQuery ? `\n检索子问题: ${hit.searchQuery}` : "";
  const block = `[${index + 1}] ${hit.title}${facet}\nURL: ${hit.url}${date}\n${snippet}`;
  // formatHits joins with "\n\n"; charge separator for every item after the first.
  return block.length + (index > 0 ? 2 : 0);
}

function pickWithSnippetCap(
  hits: WebSearchHit[],
  budget: number,
  snippetChars: number,
): { selected: WebSearchHit[]; remainder: WebSearchHit[] } {
  const selected: WebSearchHit[] = [];
  let used = 0;
  let stopAt = hits.length;
  for (let i = 0; i < hits.length; i += 1) {
    const cost = hitCostChars(hits[i]!, selected.length, snippetChars);
    if (selected.length > 0 && used + cost > budget) {
      stopAt = i;
      break;
    }
    if (selected.length === 0 && cost > budget) {
      // Still take at least one truncated hit so the model is not empty-handed.
      selected.push({
        ...hits[i]!,
        snippet: truncateSnippet(hits[i]!.snippet ?? "", snippetChars),
      });
      stopAt = i + 1;
      break;
    }
    selected.push({
      ...hits[i]!,
      snippet: truncateSnippet(hits[i]!.snippet ?? "", snippetChars),
    });
    used += cost;
  }
  const remainder = hits.slice(stopAt);
  return { selected, remainder };
}

/** 在预算内贪心选取，返回 { selected, remainder }。 */
export function selectHitsWithinBudget(
  hits: WebSearchHit[],
  model: string | undefined,
): { selected: WebSearchHit[]; remainder: WebSearchHit[] } {
  if (hits.length === 0) return { selected: [], remainder: [] };

  const budget = resolveInjectionBudgetChars(model);
  let { selected, remainder } = pickWithSnippetCap(hits, budget, WEB_SEARCH_SNIPPET_CHARS);

  if (selected.length < MIN_SELECTED_HITS && hits.length >= MIN_SELECTED_HITS) {
    const reduced = Math.max(
      MIN_SNIPPET_CHARS,
      Math.floor(budget / MIN_SELECTED_HITS) - 120,
    );
    ({ selected, remainder } = pickWithSnippetCap(hits, budget, reduced));
  }

  return { selected, remainder };
}
