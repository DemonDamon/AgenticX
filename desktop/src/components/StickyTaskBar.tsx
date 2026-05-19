import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ListChecks, Check, Circle, Loader2 } from "lucide-react";
import { parseTodoMessage, type ParsedTodo } from "./TodoUpdateCard";
import type { Message } from "../store";

/**
 * Find the latest todo snapshot from pane messages.
 *
 * Priority:
 *   1. role=tool && toolName="todo_write" — the canonical signal whether the
 *      content was wrapped by `formatToolResultMessage` (live SSE) or kept raw
 *      (history loaded from messages.json via `mapLoadedSessionMessage`).
 *   2. Any message whose content parses as a todo render — fallback for paths
 *      that lost the toolName metadata.
 */
function pickLatestTodoFromMessages(messages: Message[]): ParsedTodo | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m) continue;
    if (m.role === "tool" && (m.toolName ?? "").trim() === "todo_write") {
      const parsed = parseTodoMessage(typeof m.content === "string" ? m.content : "");
      if (parsed) return parsed;
    }
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m) continue;
    const content = typeof m.content === "string" ? m.content : "";
    if (!content) continue;
    const parsed = parseTodoMessage(content);
    if (parsed) return parsed;
  }
  return null;
}

interface StickyTaskBarProps {
  messages: Message[];
}

/**
 * Sticky task progress card shown directly above the chat composer.
 *
 * Visual reference: Manus / Cursor — a card with a header row ("任务进度  N/M"
 * + 折叠箭头) and a checklist underneath. Each item shows status:
 *   - completed → ✓ (emerald)
 *   - in_progress → spinner (theme accent)
 *   - pending → empty circle (muted)
 * Completed items render with strikethrough.
 *
 * Default: expanded when there is at least one in-progress / pending item;
 * auto-collapses once everything is done so it does not eat composer space.
 */
export function StickyTaskBar({ messages }: StickyTaskBarProps) {
  const parsed = useMemo(() => pickLatestTodoFromMessages(messages), [messages]);
  const [expanded, setExpanded] = useState(true);

  const allDone = !!parsed && parsed.total > 0 && parsed.completed === parsed.total;

  // Guard against ghost task cards: when the model called `todo_write` but
  // never actually advanced any item (all pending, 0 in_progress, 0 completed)
  // and the agent has already returned, the list is just clutter and should
  // be hidden. Typical trigger: user asked for a doc/plan and the model
  // wrongly mirrored the doc's milestone checklist into todo_write.
  const hasAnyProgress = !!parsed && parsed.items.some(
    (item) => item.status === "in_progress" || item.status === "completed",
  );

  // Auto-collapse only when the run finishes; keep expanded while user is
  // watching progress live.
  useEffect(() => {
    if (allDone) setExpanded(false);
    else setExpanded(true);
  }, [allDone, parsed?.total, parsed?.completed]);

  if (!parsed) return null;
  if (!hasAnyProgress) return null;

  return (
    <div className="mb-2 rounded-lg border border-border bg-surface-card text-text-primary shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 py-1.5 pl-4 pr-3 text-left transition hover:bg-surface-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-[rgba(var(--theme-color-rgb,59,130,246),0.4)]"
        aria-expanded={expanded}
        aria-label={expanded ? "收起任务列表" : "展开任务列表"}
      >
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
          <ListChecks className="h-4 w-4 text-[rgb(var(--theme-color-rgb,59,130,246))]" />
        </span>
        <span className="text-[12px] font-semibold text-text-strong">任务进度</span>
        <span
          className={
            allDone
              ? "rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300"
              : "rounded bg-[rgba(var(--theme-color-rgb,59,130,246),0.15)] px-1.5 py-0.5 text-[10px] font-medium text-[rgb(var(--theme-color-rgb,59,130,246))]"
          }
        >
          {parsed.completed} / {parsed.total}
        </span>
        <span className="flex-1" />
        <span className="inline-flex h-4 w-4 items-center justify-center text-text-faint" aria-hidden>
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>
      {expanded ? (
        <ul className="max-h-[40vh] space-y-0.5 overflow-y-auto px-3 pb-2">
          {parsed.items.map((item, idx) => (
            <li
              key={`${item.content}-${idx}`}
              className="flex items-start gap-2 rounded px-1 py-1"
            >
              <span
                className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center"
                aria-hidden
              >
                {item.status === "completed" ? (
                  <Check className="h-4 w-4 text-emerald-400" strokeWidth={2.5} />
                ) : item.status === "in_progress" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[rgb(var(--theme-color-rgb,59,130,246))]" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-text-faint" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className={
                    item.status === "completed"
                      ? "text-[12px] leading-snug text-text-subtle line-through"
                      : item.status === "in_progress"
                        ? "text-[12px] font-medium leading-snug text-text-strong"
                        : "text-[12px] leading-snug text-text-primary"
                  }
                >
                  {item.content}
                </div>
                {item.status === "in_progress" && item.activeForm && item.activeForm !== item.content ? (
                  <div className="mt-0.5 text-[11px] text-[rgba(var(--theme-color-rgb,59,130,246),0.8)]">{item.activeForm}</div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
