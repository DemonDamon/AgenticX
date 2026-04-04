import type { Message } from "../../store";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Wrench, ChevronDown, ChevronRight } from "lucide-react";

type Props = {
  message: Message;
  action?: ReactNode;
  /** 有需要用户操作的内联确认时强制展开 */
  forceExpand?: boolean;
  /** 历史搜索关键词高亮（命中时自动展开） */
  highlightTerms?: string[];
  /** 多选模式 */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelectMessage?: (message: Message) => void;
};

/** 从工具消息内容中提取工具名摘要，用于折叠状态显示 */
function extractToolSummary(content: string): string {
  // 格式：🔧 tool_name: {...}
  const toolMatch = content.match(/^🔧\s+([^:]+)/);
  if (toolMatch) return toolMatch[1].trim();
  // 格式：⚠️ / ❌ / 🗣 前缀消息
  const emojiMatch = content.match(/^([⚠️❌🗣✅])\s+(.{0,60})/u);
  if (emojiMatch) return emojiMatch[2].trim();
  // 纯内容截断
  return content.slice(0, 60).replace(/\n/g, " ").trim();
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeHighlightTerms(terms?: string[]): string[] {
  if (!terms || terms.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const t = String(raw || "").trim();
    if (t.length < 2) continue;
    const key = t.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  out.sort((a, b) => b.length - a.length);
  return out;
}

function renderHighlightedText(content: string, terms: string[]): ReactNode {
  if (!content) return null;
  if (terms.length === 0) return content;
  const regex = new RegExp(`(${terms.map((t) => escapeRegExp(t)).join("|")})`, "giu");
  const parts = content.split(regex);
  return parts.map((part, idx) => {
    if (!part) return null;
    regex.lastIndex = 0;
    const matched = regex.test(part);
    if (!matched) return <span key={`tool-part-${idx}`}>{part}</span>;
    return (
      <mark key={`tool-part-${idx}`} data-agx-highlight="1" className="agx-keyword-highlight rounded px-[1px]">
        {part}
      </mark>
    );
  });
}

export function ToolCallCard({
  message,
  action,
  forceExpand = false,
  highlightTerms,
  selectable,
  selected,
  onToggleSelectMessage,
}: Props) {
  const normalizedTerms = useMemo(() => normalizeHighlightTerms(highlightTerms), [highlightTerms]);
  const matchedByHighlight = useMemo(() => {
    if (!message.content || normalizedTerms.length === 0) return false;
    const hay = message.content.toLocaleLowerCase();
    return normalizedTerms.some((t) => hay.includes(t.toLocaleLowerCase()));
  }, [message.content, normalizedTerms]);
  const shouldForceExpand = forceExpand || matchedByHighlight;
  const [expanded, setExpanded] = useState(shouldForceExpand);
  const summary = extractToolSummary(message.content);
  const hasDetail = message.content.length > 0;

  useEffect(() => {
    if (shouldForceExpand) setExpanded(true);
  }, [shouldForceExpand]);

  return (
    <div className="flex min-w-0 items-start gap-2">
      {/* 多选勾选框，与 ImBubble 对齐 */}
      {selectable && (
        <button
          type="button"
          className={`mt-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition ${
            selected
              ? "border-cyan-500 bg-cyan-500 text-white"
              : "border-text-faint bg-transparent text-transparent"
          }`}
          onClick={() => onToggleSelectMessage?.(message)}
          aria-label={selected ? "取消选择" : "选择此工具消息"}
        >
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3.5 8.5L6.5 11.5L12.5 4.5" />
          </svg>
        </button>
      )}

      {/* 与 ImBubble 保持一致的对齐骨架 */}
      <div className="flex min-w-0 flex-1 justify-start gap-2">
        <div className="flex min-w-0 flex-1 flex-row gap-2">
          <div className="flex h-8 w-8 shrink-0" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col items-start" style={{ maxWidth: "min(92%, 960px)" }}>
            <div
              className={`w-full min-w-0 overflow-hidden rounded-lg border bg-surface-card text-xs text-text-muted transition ${
                selected ? "border-cyan-500/60" : "border-border"
              }`}
            >
              {/* 折叠头部，始终可见 */}
              <button
                type="button"
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-surface-hover"
                onClick={() => setExpanded((v) => !v)}
                disabled={!hasDetail}
              >
                <Wrench className="h-3.5 w-3.5 shrink-0 text-text-subtle" />
                <span className="flex-1 truncate text-[11px] font-medium text-text-subtle">{summary}</span>
                {hasDetail &&
                  (expanded ? (
                    <ChevronDown className="h-3 w-3 shrink-0 text-text-muted" />
                  ) : (
                    <ChevronRight className="h-3 w-3 shrink-0 text-text-muted" />
                  ))}
              </button>

              {/* 展开内容 */}
              {expanded && (
                <div className="space-y-1 border-t border-border px-3 pb-2 pt-1.5">
                  <span className="break-all whitespace-pre-wrap">
                    {renderHighlightedText(message.content, normalizedTerms)}
                  </span>
                  {action}
                </div>
              )}

              {/* forceExpand 时 action 始终在外部显示（如确认按钮） */}
              {!expanded && shouldForceExpand && action && (
                <div className="border-t border-border px-3 pb-2 pt-1.5">
                  {action}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
