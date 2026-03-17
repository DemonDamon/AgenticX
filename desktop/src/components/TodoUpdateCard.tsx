import { useMemo, useState } from "react";

type TodoStatus = "pending" | "in_progress" | "completed";

type TodoItem = {
  status: TodoStatus;
  content: string;
  activeForm?: string;
};

type ParsedTodo = {
  items: TodoItem[];
  completed: number;
  total: number;
};

function parseTodoMessage(text: string): ParsedTodo | null {
  if (!text.startsWith("🗂 任务清单更新")) return null;
  const body = text.replace(/^🗂\s*任务清单更新/, "").trim();
  if (!body) return null;
  const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
  const items: TodoItem[] = [];
  let completed = 0;
  let total = 0;

  for (const line of lines) {
    const summary = line.match(/^\((\d+)\s*\/\s*(\d+)\s*completed\)$/i);
    if (summary) {
      completed = Number(summary[1] ?? 0);
      total = Number(summary[2] ?? 0);
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
    <div className="rounded-lg border border-slate-600/70 bg-slate-900/50 px-2.5 py-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-cyan-300">任务清单</span>
          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
            {parsed.completed}/{parsed.total}
          </span>
          <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300">{percent}%</span>
          {inProgress > 0 ? (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">进行中 {inProgress}</span>
          ) : null}
          {pending > 0 ? (
            <span className="rounded bg-slate-700/80 px-1.5 py-0.5 text-[10px] text-slate-300">待办 {pending}</span>
          ) : null}
        </div>
        <button
          className="rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          onClick={() => setExpanded((prev) => !prev)}
          title={expanded ? "收起任务项" : "展开任务项"}
        >
          {expanded ? "收起" : "展开"}
        </button>
      </div>
      <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-cyan-400/80 transition-all" style={{ width: `${percent}%` }} />
      </div>
      {expanded ? (
        <div className="space-y-1">
          {parsed.items.map((item, idx) => (
            <div key={`${item.content}-${idx}`} className="flex items-start gap-2 rounded px-1 py-0.5 hover:bg-slate-800/60">
              <span
                className={
                  item.status === "completed"
                    ? "mt-0.5 text-[11px] text-emerald-300"
                    : item.status === "in_progress"
                      ? "mt-0.5 text-[11px] text-amber-300"
                      : "mt-0.5 text-[11px] text-slate-400"
                }
              >
                {item.status === "completed" ? "✓" : item.status === "in_progress" ? "●" : "○"}
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className={
                    item.status === "completed"
                      ? "text-[11px] text-slate-400 line-through"
                      : item.status === "in_progress"
                        ? "text-[11px] font-medium text-amber-100"
                        : "text-[11px] text-slate-200"
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

export function isTodoUpdateToolMessage(content: string): boolean {
  return parseTodoMessage(content) !== null;
}
