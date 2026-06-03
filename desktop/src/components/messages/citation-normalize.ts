const CITATION_VARIANTS: Array<{ pattern: RegExp; replace: (id: string) => string }> = [
  { pattern: /【(\d+)】/g, replace: (id) => `[${id}]` },
  { pattern: /\[来源\s*(\d+)\]/gi, replace: (id) => `[${id}]` },
  { pattern: /\(来源\s*(\d+)\)/g, replace: (id) => `[${id}]` },
];

/** ①…⑳ → [1]…[20]（模型常用圈号，与 ima 式 [N] 角标对齐） */
const CIRCLED_NUMERAL_RE =
  /[\u2460\u2461\u2462\u2463\u2464\u2465\u2466\u2467\u2468\u2469\u2470\u2471\u2472\u2473\u2474\u2475\u2476\u2477\u2478\u2479\u247A\u247B\u247C\u247D\u247E\u247F\u3251\u3252\u3253\u3254\u3255\u3256\u3257\u3258\u3259\u325A\u325B\u325C\u325D\u325E\u325F]/g;

function circledNumeralToBracket(ch: string): string {
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 0x2460 && code <= 0x2473) return `[${code - 0x245f}]`;
  if (code >= 0x3251 && code <= 0x325f) return `[${code - 0x3250}]`;
  return ch;
}

export function normalizeCitationMarkers(text: string, enabled: boolean): string {
  if (!enabled || !text) return text;
  let next = text;
  for (const rule of CITATION_VARIANTS) {
    next = next.replace(rule.pattern, (_m, id: string) => rule.replace(String(id)));
  }
  next = next.replace(CIRCLED_NUMERAL_RE, (ch) => circledNumeralToBracket(ch));
  return next;
}

export const CITATION_MARKER_RE = /\[(\d+)\]/g;

// 当本轮没有任何 references（模型未真正调用 knowledge_search/web_search 却凭记忆
// 编造了 [1][2][3]），把这些游离角标从最终文本里剥掉，避免展示「无法溯源的假角标」。
// 负向先行 `(?!\()` 保护 markdown 链接 `[1](url)` 不被误伤；同时清理角标残留导致的
// 重复空格与句末空格。
const ORPHAN_CITATION_RE = new RegExp(
  `(?:\\[\\d+\\](?!\\()|【\\d+】|\\[来源\\s*\\d+\\]|\\(来源\\s*\\d+\\)|${CIRCLED_NUMERAL_RE.source})`,
  "g",
);

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

const CITATION_TOKEN_RE = /\[\d+\](?!\()/;

/** Leading numeric citations not part of a markdown link (`[1](url)`). */
const LEADING_CITATION_LINE_RE = new RegExp(
  `^(\\s*)((?:${CITATION_TOKEN_RE.source})+)\\s*([\\s\\S]+)$`,
);
const CITATION_ONLY_LINE_RE = new RegExp(`^(\\s*)((?:${CITATION_TOKEN_RE.source})+)\\s*$`);

function lastNonEmptyLineIndex(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i]?.trim()) return i;
  }
  return -1;
}

/**
 * Move line-leading [N] to the end of the previous non-empty line (ima-style: pill at
 * end of title/sentence). Same-line leading [N]text becomes text[N].
 */
export function relocateCitationMarkersForDisplay(text: string): string {
  if (!text) return text;
  const lines = text.split("\n");
  const out: string[] = [];

  for (const rawLine of lines) {
    let line = rawLine;

    const onlyCites = line.match(CITATION_ONLY_LINE_RE);
    if (onlyCites) {
      const prevIdx = lastNonEmptyLineIndex(out);
      if (prevIdx >= 0) {
        out[prevIdx] = `${out[prevIdx].trimEnd()}${onlyCites[2]}`;
        continue;
      }
      out.push(line);
      continue;
    }

    const lead = line.match(LEADING_CITATION_LINE_RE);
    if (lead) {
      const cites = lead[2];
      const body = lead[3];
      const prevIdx = lastNonEmptyLineIndex(out);
      if (prevIdx >= 0 && body.trim()) {
        out[prevIdx] = `${out[prevIdx].trimEnd()}${cites}`;
        line = `${lead[1]}${body}`;
      } else if (body.trim()) {
        line = `${lead[1]}${body.trimEnd()}${cites}`;
      }
    }

    out.push(line);
  }

  return out.join("\n");
}

/** Split assistant text into paragraph blocks; citations stay inside the same block as adjacent prose. */
export function splitCitationParagraphBlocks(text: string): string[] {
  if (!text) return [];
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
