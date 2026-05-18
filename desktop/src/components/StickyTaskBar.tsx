import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, LayoutList } from "lucide-react";
import { parseTodoMessage, type ParsedTodo } from "./TodoUpdateCard";
import type { Message } from "../store";

const COLLAPSED_TEXT_MAX = 50;

function pickLatestTodoFromMessages(messages: Message[]): ParsedTodo | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || m.role !== "assistant") continue;
    const content = typeof m.content === "string" ? m.content : "";
    if (!content.startsWith("🗂 任务清单更新")) continue;
    const parsed = parseTodoMessage(content);
    if (parsed) return parsed;
  }
  return null;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

interface StickyTaskBarProps {
  messages: Message[];
}

export function StickyTaskBar({ messages }: StickyTaskBarProps) {
  const parsed = useMemo(() => pickLatestTodoFromMessages(messages), [messages]);
  const [expanded, setExpanded] = useState(false);

  // 任务全部完成时自动收起，避免占位
  useEffect(() => {
    if (parsed && parsed.total > 0 && parsed.completed === parsed.total) {
      setExpanded(false);
    }
  }, [parsed?.completed, parsed?.total]);

  if (!parsed) return null;

  const inProgressItem = parsed.items.find((it) => it.status === "in_progress");
  const allDone = parsed.total > 0 && parsed.completed === parsed.total;
  const percent = parsed.total > 0 ? Math.round((parsed.completed / parsed.total) * 100) : 0;
  const headlineText = allDone
    ? "所有任务已完成"
    : inProgressItem
      ? clip(inProgressItem.activeForm || inProgressItem.content, COLLAPSED_TEXT_MAX)
      : clip(
          parsed.items.find((it) => it.status === "pending")?.content || "(暂无进行中任务)",
          COLLAPSED_TEXT_MAX,
        );

  return (
    <div className="mb-1 rounded-lg border border-border bg-surface-card text-text-primary shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition hover:bg-surface-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/40"
        aria-expanded={expanded}
        aria-label={expanded ? "收起任务清单" : "展开任务清单"}
      >
        <LayoutList className="h-3.5 w-3.5 shrink-0 text-cyan-300" aria-hidden />
        <span className="text-[11px] font-medium text-cyan-300">任务</span>
        <span
          className={
            allDone
              ? "rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300"
              : "rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300"
          }
        >
          {parsed.completed}/{parsed.total}
        </span>
        <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-text-muted">{percent}%</span>
        <span
          className={
            allDone
              ? "min-w-0 flex-1 truncate text-[11px] text-text-subtle line-through"
              : "min-w-0 flex-1 truncate text-[11px] text-text-primary"
          }
          title={headlineText}
        >
          {headlineText}
        </span>
        <span className="ml-1 inline-flex h-4 w-4 items-center justify-center text-text-faint" aria-hidden>
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>
      {/* 进度条永远显示，便于与折叠/展开两态都能感知整体进度 */}
      <div className="mx-2.5 mb-1.5 h-1 overflow-hidden rounded-full bg-surface-hover">
        <div
          className={
            allDone
              ? "h-full rounded-full bg-emerald-400/80 transition-all"
              : "h-full rounded-full bg-cyan-400/80 transition-all"
          }
          style={{ width: `${percent}%` }}
        />
      </div>
      {expanded ? (
        <div className="max-h-[40vh] space-y-1 overflow-y-auto px-2.5 pb-2">
          {parsed.items.map((item, idx) => (
            <div
              key={`${item.content}-${idx}`}
              className="flex items-start gap-2 rounded px-1 py-0.5 hover:bg-surface-hover"
            >
              <span
                className={
                  item.status === "completed"
                    ? "mt-0.5 text-[11px] text-emerald-300"
                    : item.status === "in_progress"
                      ? "mt-0.5 text-[11px] text-amber-300"
                      : "mt-0.5 text-[11px] text-text-subtle"
                }
                aria-hidden
              >
                {item.status === "completed" ? "✓" : item.status === "in_progress" ? "●" : "○"}
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className={
                    item.status === "completed"
                      ? "text-[11px] text-text-subtle line-through"
                      : item.status === "in_progress"
                        ? "text-[11px] font-medium text-amber-100"
                        : "text-[11px] text-text-primary"
                  }
                >
                  {item.content}
                </div>
                {item.status === "in_progress" && item.activeForm && item.activeForm !== item.content ? (
                  <div className="mt-0.5 text-[10px] text-amber-300/80">当前动作：{item.activeForm}</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
