import { useState } from "react";
import { Pencil, Trash2, Play, ChevronDown } from "lucide-react";
import type { AutomationTask } from "./types";

interface Props {
  tasks: AutomationTask[];
  onToggle: (taskId: string, enabled: boolean) => void;
  onEdit: (task: AutomationTask) => void;
  onDelete: (taskId: string) => void;
  onRunNow: (taskId: string) => void;
}

function SettingsSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => { if (!disabled) onChange(!checked); }}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${
        checked ? "bg-text-strong" : "bg-surface-card-strong"
      } ${disabled ? "opacity-50" : ""}`}
    >
      <span
        className={`pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : ""
        }`}
      />
    </button>
  );
}

function frequencyLabel(task: AutomationTask): string {
  const f = task.frequency;
  const dayMap: Record<number, string> = { 1: "一", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六", 7: "日" };
  const daysStr = (days: number[]) => {
    if (days.length === 7) return "每天";
    if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return "工作日";
    return days.map((d) => `周${dayMap[d]}`).join("、");
  };
  switch (f.type) {
    case "daily":
      return `${daysStr(f.days)} ${f.time}`;
    case "interval":
      return `每 ${f.hours} 小时 · ${daysStr(f.days)}`;
    case "once":
      return `单次 ${f.date} ${f.time}`;
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${Math.floor(diff / 86400_000)} 天前`;
}

export function TaskList({ tasks, onToggle, onEdit, onDelete, onRunNow }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const handleRunNow = (taskId: string) => {
    setRunningId(taskId);
    onRunNow(taskId);
    setTimeout(() => setRunningId(null), 3000);
  };

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <div className="text-3xl">📋</div>
        <p className="text-sm text-text-muted">还没有自动化任务</p>
        <p className="text-xs text-text-faint">从上方模板开始，或点击「添加任务」手动创建</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {tasks.map((task) => {
        const expanded = expandedId === task.id;
        return (
          <div
            key={task.id}
            className="rounded-lg border border-border bg-surface-card transition hover:border-text-faint"
          >
            <div className="flex items-center gap-3 px-3 py-2.5">
              <button
                type="button"
                className="shrink-0 text-text-faint transition hover:text-text-primary"
                onClick={() => setExpandedId(expanded ? null : task.id)}
              >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "" : "-rotate-90"}`} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-text-strong">{task.name}</div>
                <div className="mt-0.5 text-xs text-text-faint">{frequencyLabel(task)}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  title="立即执行"
                  disabled={runningId === task.id}
                  className="rounded-md p-1 text-text-faint transition hover:bg-surface-panel hover:text-text-primary disabled:opacity-40"
                  onClick={() => handleRunNow(task.id)}
                >
                  <Play className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="编辑"
                  className="rounded-md p-1 text-text-faint transition hover:bg-surface-panel hover:text-text-primary"
                  onClick={() => onEdit(task)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="删除"
                  className="rounded-md p-1 text-text-faint transition hover:bg-surface-panel hover:text-rose-400"
                  onClick={() => onDelete(task.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <SettingsSwitch
                  checked={task.enabled}
                  onChange={(next) => onToggle(task.id, next)}
                />
              </div>
            </div>
            {expanded && (
              <div className="border-t border-border px-3 py-2 text-xs text-text-muted space-y-1">
                <div className="line-clamp-3">
                  <span className="text-text-faint">提示词：</span>{task.prompt}
                </div>
                {task.workspace && (
                  <div><span className="text-text-faint">工作区：</span>{task.workspace}</div>
                )}
                {task.lastRunAt && (
                  <div>
                    <span className="text-text-faint">上次执行：</span>
                    {relativeTime(task.lastRunAt)}
                    {task.lastRunStatus && (
                      <span className={`ml-1 ${task.lastRunStatus === "success" ? "text-emerald-400" : "text-rose-400"}`}>
                        ({task.lastRunStatus === "success" ? "成功" : "失败"})
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
