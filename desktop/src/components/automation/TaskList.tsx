import { useCallback, useState } from "react";
import { Pencil, Trash2, Play, ChevronDown, FileText } from "lucide-react";
import type { AutomationTask } from "./types";

interface Props {
  tasks: AutomationTask[];
  onToggle: (taskId: string, enabled: boolean) => void;
  onEdit: (task: AutomationTask) => void;
  onDelete: (taskId: string) => void;
  onRunNow: (task: AutomationTask) => void;
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
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--settings-accent-focus,rgba(59,130,246,0.5))] ${
        checked ? "bg-[var(--ui-btn-primary-bg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]" : "bg-surface-hover"
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
  const [logByTask, setLogByTask] = useState<
    Record<string, { path: string; lines: string[]; empty?: boolean; error?: string }>
  >({});

  const loadLog = useCallback(async (taskId: string) => {
    try {
      const r = await window.agenticxDesktop.readAutomationTaskLog({ taskId, tail: 120 });
      setLogByTask((prev) => ({
        ...prev,
        [taskId]: {
          path: r.path,
          lines: r.lines ?? [],
          empty: r.empty,
          error: r.error,
        },
      }));
    } catch (err) {
      setLogByTask((prev) => ({
        ...prev,
        [taskId]: {
          path: "",
          lines: [],
          error: err instanceof Error ? err.message : String(err),
        },
      }));
    }
  }, []);

  const handleRunNow = (task: AutomationTask) => {
    setRunningId(task.id);
    onRunNow(task);
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
                  onClick={() => handleRunNow(task)}
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
                <div className="flex items-center gap-1.5 pl-0.5">
                  <span className="whitespace-nowrap text-[10px] text-text-faint" title="启用后按计划触发">
                    启用
                  </span>
                  <SettingsSwitch
                    checked={task.enabled}
                    onChange={(next) => onToggle(task.id, next)}
                  />
                </div>
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
                {task.provider && task.model ? (
                  <div>
                    <span className="text-text-faint">执行模型：</span>
                    {task.provider}/{task.model}
                  </div>
                ) : null}
                {task.lastRunAt && (
                  <div>
                    <span className="text-text-faint">上次执行：</span>
                    {relativeTime(task.lastRunAt)}
                    {task.lastRunStatus && (
                      <span className={`ml-1 ${task.lastRunStatus === "success" ? "text-emerald-400" : "text-rose-400"}`}>
                        ({task.lastRunStatus === "success" ? "成功" : "失败"})
                      </span>
                    )}
                    {task.lastRunStatus === "error" && task.lastRunError ? (
                      <div
                        className="mt-1 line-clamp-3 break-words text-[11px] leading-snug text-rose-300/95"
                        title={task.lastRunError}
                      >
                        {task.lastRunError}
                      </div>
                    ) : null}
                  </div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-panel px-2 py-1 text-[11px] text-text-muted transition hover:border-text-faint hover:text-text-primary"
                    onClick={() => void loadLog(task.id)}
                  >
                    <FileText className="h-3 w-3" />
                    查看执行日志
                  </button>
                  {logByTask[task.id]?.path ? (
                    <span className="truncate text-[10px] text-text-faint" title={logByTask[task.id].path}>
                      {logByTask[task.id].path}
                    </span>
                  ) : null}
                </div>
                {logByTask[task.id] ? (
                  <div className="mt-1 max-h-52 overflow-y-auto rounded-md border border-border bg-surface-panel/60 p-2 font-mono text-[11px] leading-snug text-text-muted">
                    {logByTask[task.id].error ? (
                      <div className="text-rose-400">读取日志失败：{logByTask[task.id].error}</div>
                    ) : logByTask[task.id].empty || logByTask[task.id].lines.length === 0 ? (
                      <div className="text-text-faint">暂无日志（任务尚未执行过，或刚刚重建）。</div>
                    ) : (
                      logByTask[task.id].lines.map((ln, i) => (
                        <div key={i} className="whitespace-pre-wrap break-all">
                          {ln}
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
