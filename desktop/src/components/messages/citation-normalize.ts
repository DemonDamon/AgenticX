const CITATION_VARIANTS: Array<{ pattern: RegExp; replace: (id: string) => string }> = [
  { pattern: /【(\d+)】/g, replace: (id) => `[${id}]` },
  { pattern: /\[来源\s*(\d+)\]/gi, replace: (id) => `[${id}]` },
  { pattern: /\(来源\s*(\d+)\)/g, replace: (id) => `[${id}]` },
];

export function normalizeCitationMarkers(text: string, enabled: boolean): string {
  if (!enabled || !text) return text;
  let next = text;
  for (const rule of CITATION_VARIANTS) {
    next = next.replace(rule.pattern, (_m, id: string) => rule.replace(String(id)));
  }
  return next;
}

export const CITATION_MARKER_RE = /\[(\d+)\]/g;

// 当本轮没有任何 references（模型未真正调用 knowledge_search/web_search 却凭记忆
// 编造了 [1][2][3]），把这些游离角标从最终文本里剥掉，避免展示「无法溯源的假角标」。
// 负向先行 `(?!\()` 保护 markdown 链接 `[1](url)` 不被误伤；同时清理角标残留导致的
// 重复空格与句末空格。
const ORPHAN_CITATION_RE = /(?:\[\d+\](?!\()|【\d+】|\[来源\s*\d+\]|\(来源\s*\d+\))/g;

export function stripOrphanCitationMarkers(text: string): string {
  if (!text) return text;
  return text
    .replace(ORPHAN_CITATION_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([，。、；：！？,.;:!?])/g, "$1");
}

export function splitCitationSegments(text: string): Array<{ kind: "text" | "citation"; value: string }> {
  const parts = text.split(/(\[\d+\])/g).filter((part) => part.length > 0);
  return parts.map((part) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (match) return { kind: "citation" as const, value: match[1] };
    return { kind: "text" as const, value: part };
  });
}
