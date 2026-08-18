import { useMemo, useState } from "react";
import type { Message } from "../store";
import { TRAE_TODO_CHECK_CLASS } from "./work-panel/SessionTodoList";

export type TodoStatus = "pending" | "in_progress" | "completed";

export type TodoItem = {
  status: TodoStatus;
  content: string;
  activeForm?: string;
};

export type ParsedTodo = {
  items: TodoItem[];
  completed: number;
  total: number;
};

/**
 * Find the latest todo snapshot from pane messages.
 *
 * Priority:
 *   1. role=tool && toolName="todo_write" — canonical signal (live SSE or history)
 *   2. Any message whose content parses as a todo render — fallback when toolName lost
 */
export function pickLatestTodoFromMessages(
  messages: Message[],
): { parsed: ParsedTodo; index: number } | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m) continue;
    if (m.role === "tool" && (m.toolName ?? "").trim() === "todo_write") {
      const parsed = parseTodoMessage(typeof m.content === "string" ? m.content : "");
      if (parsed) return { parsed, index: i };
    }
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m) continue;
    const content = typeof m.content === "string" ? m.content : "";
    if (!content) continue;
    const parsed = parseTodoMessage(content);
    if (parsed) return { parsed, index: i };
  }
  return null;
}

export function parseTodoMessage(text: string): ParsedTodo | null {
  if (!text) return null;
  // Two valid sources:
  //   1) ChatPane.formatToolResultMessage 包过的："🗂 任务清单更新\n[x] ..."
  //   2) messages.json 历史加载的裸 todo_manager.render() 输出："[x] ..."
  // 历史路径不会经过 formatToolResultMessage，所以必须兼容裸格式，否则
  // 分身/重启后的会话里 sticky bar 永远拿不到数据。
  let body = text.trim();
  const hadPrefix = body.startsWith("🗂 任务清单更新");
  if (hadPrefix) {
    body = body.replace(/^🗂\s*任务清单更新/, "").trim();
  }
  if (!body) return null;
  const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
  const items: TodoItem[] = [];
  let completed = 0;
  let total = 0;
  let hasSummary = false;

  for (const line of lines) {
    const summary = line.match(/^\((\d+)\s*\/\s*(\d+)\s*completed\)$/i);
    if (summary) {
      completed = Number(summary[1] ?? 0);
      total = Number(summary[2] ?? 0);
      hasSummary = true;
      continue;
    }
    const done = line.match(/^(?:-\s*)?\[[xX]\]\s+(.+)$/);
    if (done) {
      items.push({ status: "completed", content: done[1] ?? "" });
      continue;
    }
    const doing = line.match(/^(?:-\s*)?\[>\]\s+(.+?)(?:\s+<-\s+(.+))?$/);
    if (doing) {
      items.push({
        status: "in_progress",
        content: (doing[1] ?? "").trim(),
        activeForm: (doing[2] ?? "").trim(),
      });
      continue;
    }
    const todo = line.match(/^(?:-\s*)?\[\s\]\s+(.+)$/);
    if (todo) {
      items.push({ status: "pending", content: todo[1] ?? "" });
    }
  }

  if (items.length === 0) return null;
  // 收紧裸格式识别：没有"🗂 任务清单更新"前缀时，必须有 (N/N completed) 摘要行
  // 或至少 2 个 todo 行，避免把用户随手写的 `[x] 买菜` 误判为 todo 列表。
  if (!hadPrefix && !hasSummary && items.length < 2) return null;
  if (!total) total = items.length;
  if (!completed) completed = items.filter((item) => item.status === "completed").length;
  return { items, completed, total };
}

export function TodoUpdateCard({ content }: { content: string }) {
  const parsed = useMemo(() => parseTodoMessage(content), [content]);
  const [expanded, setExpanded] = useState(true);

  if (!parsed) return null;

  const inProgress = parsed.items.filter((item) => item.status === "in_progress").length;
  const pending = parsed.items.filter((item) => item.status === "pending").length;
  const percent = parsed.total > 0 ? Math.round((parsed.completed / parsed.total) * 100) : 0;

  return (
    <div className="rounded-lg border border-border bg-surface-card px-2.5 py-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-text-strong">任务清单</span>
          <span className="rounded bg-[color-mix(in_srgb,var(--status-success)_15%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--status-success)]">
            {parsed.completed}/{parsed.total}
          </span>
          <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-text-muted">{percent}%</span>
          {inProgress > 0 ? (
            <span className="rounded bg-[color-mix(in_srgb,var(--status-warning)_15%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--status-warning)]">
              进行中 {inProgress}
            </span>
          ) : null}
          {pending > 0 ? (
            <span className="rounded bg-surface-card px-1.5 py-0.5 text-[10px] text-text-muted">待办 {pending}</span>
          ) : null}
        </div>
        <button
          className="rounded px-1.5 py-0.5 text-[10px] text-text-subtle hover:bg-surface-hover hover:text-text-primary"
          onClick={() => setExpanded((prev) => !prev)}
          title={expanded ? "收起任务项" : "展开任务项"}
        >
          {expanded ? "收起" : "展开"}
        </button>
      </div>
      <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-surface-hover">
        <div
          className="h-full rounded-full bg-[rgb(var(--theme-color-rgb,59,130,246))] transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      {expanded ? (
        <div className="space-y-1">
          {parsed.items.map((item, idx) => (
            <div key={`${item.content}-${idx}`} className="flex items-start gap-2 rounded px-1 py-0.5 hover:bg-surface-card">
              <span
                className={
                  item.status === "completed"
                    ? `mt-0.5 text-[11px] ${TRAE_TODO_CHECK_CLASS}`
                    : item.status === "in_progress"
                      ? "mt-0.5 text-[11px] text-[var(--status-warning)]"
                      : "mt-0.5 text-[11px] text-text-faint"
                }
              >
                {item.status === "completed" ? "✓" : item.status === "in_progress" ? "●" : "○"}
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className={
                    item.status === "completed"
                      ? "text-[11px] text-text-muted line-through"
                      : item.status === "in_progress"
                        ? "text-[11px] font-medium text-text-strong"
                        : "text-[11px] text-text-primary"
                  }
                >
                  {item.content}
                </div>
                {item.status === "in_progress" && item.activeForm && item.activeForm !== item.content ? (
                  <div className="mt-0.5 text-[10px] text-[rgba(var(--theme-color-fg-rgb,59,130,246),0.8)]">
                    当前动作：{item.activeForm}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function isTodoUpdateToolMessage(content: string): boolean {
  return parseTodoMessage(content) !== null;
}
