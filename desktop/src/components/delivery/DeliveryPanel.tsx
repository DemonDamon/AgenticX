import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { useAppStore } from "../../store";

type DeliveryStage = {
  id: string;
  label: string;
  status: string;
  retries?: number;
  artifacts?: string[];
  blocker?: string;
  avatar_id?: string;
};

type DeliveryPlan = {
  current_stage?: string;
  overall_status?: string;
  stages?: DeliveryStage[];
  output_dir?: string;
};

type DeliveryTask = {
  task_id: string;
  project_name: string;
  target: string;
  status: string;
  worktree_path?: string;
  output_dir?: string;
  plan?: DeliveryPlan;
  input_files?: string[];
};

const STAGE_ORDER = ["requirements", "design", "development", "testing", "audit"];

function stageStatusClass(status: string): string {
  switch (status) {
    case "completed":
      return "text-emerald-400";
    case "running":
      return "text-sky-400";
    case "failed":
    case "awaiting_user":
      return "text-amber-400";
    default:
      return "text-text-faint";
  }
}

export function DeliveryPanel({
  open,
  apiBase,
  apiToken,
  onClose,
}: {
  open: boolean;
  apiBase: string;
  apiToken: string;
  onClose: () => void;
}) {
  const selectedTaskId = useAppStore((s) => s.deliveryPanel.selectedTaskId);
  const setDeliverySelectedTaskId = useAppStore((s) => s.setDeliverySelectedTaskId);

  const [tasks, setTasks] = useState<DeliveryTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [projectName, setProjectName] = useState("");
  const [target, setTarget] = useState<"POC" | "MVP">("POC");
  const [inputPaths, setInputPaths] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const headers = useMemo(() => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (apiToken) h["x-agx-desktop-token"] = apiToken;
    return h;
  }, [apiToken]);

  const fetchTasks = useCallback(async () => {
    if (!apiBase) return;
    setLoading(true);
    setError("");
    try {
      const resp = await fetch(`${apiBase}/api/delivery/tasks`, { headers });
      const data = (await resp.json()) as { ok?: boolean; items?: DeliveryTask[]; error?: string };
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${resp.status}`);
      }
      setTasks(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [apiBase, headers]);

  const fetchTaskDetail = useCallback(
    async (taskId: string) => {
      if (!apiBase) return;
      try {
        const resp = await fetch(`${apiBase}/api/delivery/tasks/${encodeURIComponent(taskId)}`, { headers });
        const data = (await resp.json()) as DeliveryTask & { ok?: boolean };
        if (!resp.ok) return;
        setTasks((prev) => {
          const idx = prev.findIndex((t) => t.task_id === taskId);
          const next = { ...data, task_id: data.task_id || taskId };
          if (idx < 0) return [next, ...prev];
          const copy = [...prev];
          copy[idx] = { ...copy[idx], ...next };
          return copy;
        });
      } catch {
        /* ignore poll errors */
      }
    },
    [apiBase, headers]
  );

  useEffect(() => {
    if (!open) return;
    void fetchTasks();
  }, [open, fetchTasks]);

  useEffect(() => {
    if (!open || !selectedTaskId) return;
    void fetchTaskDetail(selectedTaskId);
    const timer = window.setInterval(() => void fetchTaskDetail(selectedTaskId), 4000);
    return () => window.clearInterval(timer);
  }, [open, selectedTaskId, fetchTaskDetail]);

  const selectedTask = tasks.find((t) => t.task_id === selectedTaskId) ?? null;

  const handleCreate = async () => {
    const name = projectName.trim();
    if (!name) {
      setError("请填写项目名称");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const input_files = inputPaths
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const resp = await fetch(`${apiBase}/api/delivery/tasks`, {
        method: "POST",
        headers,
        body: JSON.stringify({ project_name: name, target, input_files }),
      });
      const data = (await resp.json()) as { ok?: boolean; task_id?: string; detail?: string };
      if (!resp.ok) {
        throw new Error(typeof data.detail === "string" ? data.detail : `HTTP ${resp.status}`);
      }
      setProjectName("");
      setInputPaths("");
      setShowCreate(false);
      await fetchTasks();
      if (data.task_id) setDeliverySelectedTaskId(data.task_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleResume = async (taskId: string) => {
    try {
      await fetch(`${apiBase}/api/delivery/tasks/${encodeURIComponent(taskId)}/resume`, {
        method: "POST",
        headers,
      });
      await fetchTaskDetail(taskId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!open) return null;

  const stages = selectedTask?.plan?.stages ?? [];

  return (
    <div className="fixed inset-0 z-[85] flex">
      <button type="button" className="flex-1 bg-black/40" aria-label="关闭交付面板" onClick={onClose} />
      <div className="flex h-full w-[min(920px,95vw)] flex-col border-l border-border bg-surface-panel shadow-xl">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2 text-sm font-medium text-text-strong">
            <Boxes className="h-[18px] w-[18px]" strokeWidth={1.8} />
            交付任务（POC/MVP）
          </div>
          <div className="flex items-center gap-1">
            <button type="button" className="agx-topbar-btn !px-[5px]" title="刷新列表" onClick={() => void fetchTasks()}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button type="button" className="agx-topbar-btn !px-[5px]" title="关闭" onClick={onClose}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-56 shrink-0 flex-col border-r border-border">
            <div className="border-b border-border p-2">
              <button
                type="button"
                className="flex w-full items-center justify-center gap-1 rounded-md bg-[var(--ui-btn-primary-bg)] px-2 py-1.5 text-xs text-[var(--ui-btn-primary-fg)]"
                onClick={() => setShowCreate((v) => !v)}
              >
                <Plus className="h-3.5 w-3.5" />
                新建任务
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {tasks.length === 0 && !loading ? (
                <p className="px-1 text-xs text-text-faint">暂无交付任务</p>
              ) : null}
              {tasks.map((t) => (
                <button
                  key={t.task_id}
                  type="button"
                  className={`mb-1 w-full rounded-md px-2 py-1.5 text-left text-xs ${
                    selectedTaskId === t.task_id
                      ? "bg-surface-card-strong text-text-strong"
                      : "text-text-subtle hover:bg-surface-card"
                  }`}
                  onClick={() => setDeliverySelectedTaskId(t.task_id)}
                >
                  <div className="truncate font-medium">{t.project_name}</div>
                  <div className="truncate text-[10px] text-text-faint">{t.status}</div>
                </button>
              ))}
            </div>
          </aside>

          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {showCreate ? (
              <div className="border-b border-border p-4 text-sm">
                <div className="mb-2 font-medium text-text-strong">新建交付任务</div>
                <label className="mb-1 block text-xs text-text-subtle">项目名称</label>
                <input
                  className="mb-3 w-full rounded-md border border-border bg-surface-card px-2 py-1.5 text-sm"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="例如：客户门户 POC"
                />
                <label className="mb-1 block text-xs text-text-subtle">目标产物</label>
                <select
                  className="mb-3 w-full rounded-md border border-border bg-surface-card px-2 py-1.5 text-sm"
                  value={target}
                  onChange={(e) => setTarget(e.target.value as "POC" | "MVP")}
                >
                  <option value="POC">POC</option>
                  <option value="MVP">MVP</option>
                </select>
                <label className="mb-1 block text-xs text-text-subtle">需求文件路径（每行一个，可选）</label>
                <textarea
                  className="mb-3 h-20 w-full rounded-md border border-border bg-surface-card px-2 py-1.5 text-xs font-mono"
                  value={inputPaths}
                  onChange={(e) => setInputPaths(e.target.value)}
                  placeholder="~/path/to/rfp.md"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={creating}
                    className="rounded-md bg-[var(--ui-btn-primary-bg)] px-3 py-1.5 text-xs text-[var(--ui-btn-primary-fg)] disabled:opacity-50"
                    onClick={() => void handleCreate()}
                  >
                    {creating ? "创建中…" : "开始交付 Loop"}
                  </button>
                  <button type="button" className="rounded-md px-3 py-1.5 text-xs text-text-subtle" onClick={() => setShowCreate(false)}>
                    取消
                  </button>
                </div>
              </div>
            ) : null}

            {error ? <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-300">{error}</div> : null}

            {!selectedTask ? (
              <div className="flex flex-1 items-center justify-center text-sm text-text-faint">选择或新建一个交付任务</div>
            ) : (
              <div className="grid min-h-0 flex-1 grid-cols-[200px_1fr_220px]">
                <section className="overflow-y-auto border-r border-border p-3">
                  <div className="mb-2 text-xs font-medium text-text-strong">阶段进度</div>
                  {STAGE_ORDER.map((sid) => {
                    const st = stages.find((s) => s.id === sid);
                    return (
                      <div key={sid} className="mb-2 rounded-md bg-surface-card px-2 py-1.5 text-xs">
                        <div className="text-text-subtle">{st?.label ?? sid}</div>
                        <div className={stageStatusClass(st?.status ?? "pending")}>{st?.status ?? "pending"}</div>
                      </div>
                    );
                  })}
                  {selectedTask.status === "awaiting_user" ? (
                    <button
                      type="button"
                      className="mt-2 w-full rounded-md border border-border px-2 py-1 text-xs text-text-subtle hover:bg-surface-card"
                      onClick={() => void handleResume(selectedTask.task_id)}
                    >
                      继续执行
                    </button>
                  ) : null}
                </section>

                <section className="overflow-y-auto p-3">
                  <div className="mb-1 text-sm font-medium text-text-strong">{selectedTask.project_name}</div>
                  <div className="mb-3 text-xs text-text-faint">
                    状态：{selectedTask.plan?.overall_status ?? selectedTask.status} · 目标：{selectedTask.target}
                  </div>
                  {selectedTask.status === "running" ? (
                    <div className="mb-3 flex items-center gap-2 text-xs text-sky-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      流水线执行中…
                    </div>
                  ) : null}
                  <div className="text-xs text-text-subtle">
                    <div className="mb-1 font-medium text-text-strong">子智能体</div>
                    {stages
                      .filter((s) => s.status === "running")
                      .map((s) => (
                        <div key={s.id} className="mb-1 rounded bg-surface-card px-2 py-1">
                          {s.avatar_id || s.id} — {s.label}
                        </div>
                      ))}
                    {!stages.some((s) => s.status === "running") ? (
                      <p className="text-text-faint">当前无运行中阶段</p>
                    ) : null}
                  </div>
                </section>

                <section className="overflow-y-auto border-l border-border p-3">
                  <div className="mb-2 text-xs font-medium text-text-strong">产物</div>
                  <ul className="space-y-1 text-[11px] font-mono text-text-subtle">
                    {stages.flatMap((s) =>
                      (s.artifacts ?? []).map((a) => (
                        <li key={`${s.id}-${a}`} className="truncate" title={a}>
                          {a}
                        </li>
                      ))
                    )}
                  </ul>
                  {selectedTask.output_dir ? (
                    <p className="mt-3 break-all text-[10px] text-text-faint">{selectedTask.output_dir}</p>
                  ) : null}
                </section>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
