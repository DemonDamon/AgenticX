import type { Message } from "../../store";
import type { ReactNode } from "react";
import { useState } from "react";
import { Wrench, ChevronDown, ChevronRight } from "lucide-react";

type Props = {
  message: Message;
  action?: ReactNode;
  /** 有需要用户操作的内联确认时强制展开 */
  forceExpand?: boolean;
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

export function ToolCallCard({
  message,
  action,
  forceExpand = false,
  selectable,
  selected,
  onToggleSelectMessage,
}: Props) {
  const [expanded, setExpanded] = useState(forceExpand);
  const summary = extractToolSummary(message.content);
  const hasDetail = message.content.length > 0;

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

      <div
        className={`min-w-0 flex-1 overflow-hidden rounded-lg border bg-surface-card text-xs text-text-muted transition ${
          selected ? "border-cyan-500/60" : "border-border"
        }`}
      >
        {/* 折叠头部，始终可见 */}
        <button
          type="button"
          className="flex w-full items-center gap-1.5 px-3 py-2 text-left hover:bg-surface-hover transition-colors"
          onClick={() => setExpanded((v) => !v)}
          disabled={!hasDetail}
        >
          <Wrench className="h-3.5 w-3.5 shrink-0 text-text-subtle" />
          <span className="flex-1 truncate text-[11px] font-medium text-text-subtle">{summary}</span>
          {hasDetail && (
            expanded
              ? <ChevronDown className="h-3 w-3 shrink-0 text-text-muted" />
              : <ChevronRight className="h-3 w-3 shrink-0 text-text-muted" />
          )}
        </button>

        {/* 展开内容 */}
        {expanded && (
          <div className="border-t border-border px-3 pb-2 pt-1.5 space-y-1">
            <span className="break-all whitespace-pre-wrap">{message.content}</span>
            {action}
          </div>
        )}

        {/* forceExpand 时 action 始终在外部显示（如确认按钮） */}
        {!expanded && forceExpand && action && (
          <div className="border-t border-border px-3 pb-2 pt-1.5">
            {action}
          </div>
        )}
      </div>
    </div>
  );
}
