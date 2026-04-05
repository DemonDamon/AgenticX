import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Panel } from "../ds/Panel";
import { TemplateGrid } from "./TemplateGrid";
import { TaskFormPanel } from "./TaskFormPanel";
import { TaskList } from "./TaskList";
import type { AutomationTask, AutomationTemplate } from "./types";

function PreventSleepToggle() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setLoading(true);
      setMessage("");
      try {
        const result = await window.agenticxDesktop.loadAutomationConfig();
        if (!disposed && result?.ok && result.config) {
          setEnabled(Boolean(result.config.prevent_sleep));
        }
      } catch {
        if (!disposed) setMessage("读取配置失败。");
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load();
    return () => { disposed = true; };
  }, []);

  const persist = async (next: boolean) => {
    setSaving(true);
    setMessage("");
    try {
      const result = await window.agenticxDesktop.saveAutomationConfig({ prevent_sleep: next });
      if (!result?.ok) {
        setMessage(result?.error ? String(result.error) : "保存失败。");
        setEnabled(!next);
        return;
      }
      setEnabled(next);
      setMessage("已保存。");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败。");
      setEnabled(!next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-card px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-strong">抑制系统睡眠</div>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">
          向系统申请「推迟睡眠」，减少长跑任务、合盖挂机或远程串联时被系统挂起的概率；退出 Machi 后不再拦截。
        </p>
        {message ? (
          <div className={`mt-1 text-xs ${message.startsWith("已保存") ? "text-text-faint" : "text-rose-400"}`}>
            {message}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={saving || loading}
        onClick={() => { if (!saving && !loading) void persist(!enabled); }}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${
          enabled ? "bg-text-strong" : "bg-surface-card-strong"
        } ${saving || loading ? "opacity-50" : ""}`}
      >
        <span
          className={`pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-4" : ""
          }`}
        />
      </button>
    </div>
  );
}

export function AutomationTab() {
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTask, setEditingTask] = useState<AutomationTask | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [runHint, setRunHint] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      const result = await window.agenticxDesktop.loadAutomationTasks();
      if (result?.ok && result.tasks) {
        setTasks(result.tasks as AutomationTask[]);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadTasks(); }, [loadTasks]);

  useEffect(() => {
    if (!runHint) return;
    const t = window.setTimeout(() => setRunHint(null), 10_000);
    return () => window.clearTimeout(t);
  }, [runHint]);

  const handleSave = useCallback(async (task: AutomationTask) => {
    const toSave: AutomationTask = { ...task };
    const result = await window.agenticxDesktop.saveAutomationTask(toSave);
    if (result?.ok) {
      setShowForm(false);
      setEditingTask(null);
      void loadTasks();
    }
    return {
      ok: Boolean(result?.ok),
      error: result?.error != null ? String(result.error) : undefined,
    };
  }, [loadTasks]);

  const handleDelete = useCallback(async (taskId: string) => {
    const result = await window.agenticxDesktop.deleteAutomationTask(taskId);
    if (result?.ok) void loadTasks();
  }, [loadTasks]);

  const handleToggle = useCallback(async (taskId: string, enabled: boolean) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const updated = { ...task, enabled };
    const result = await window.agenticxDesktop.saveAutomationTask(updated);
    if (result?.ok) void loadTasks();
  }, [tasks, loadTasks]);

  const handleRunNow = useCallback(async (task: AutomationTask) => {
    const sessionId = (task.sessionId ?? "").trim();
    const r = await window.agenticxDesktop.runAutomationTaskNow({
      taskId: task.id,
      sessionId: sessionId || undefined,
    });
    setRunHint(
      r.ok
        ? { kind: "ok", text: "已触发执行，请在该会话的对话窗口查看进度。" }
        : { kind: "err", text: r.error ?? "执行失败" },
    );
    setTimeout(() => void loadTasks(), 1500);
  }, [loadTasks]);

  const handleTemplateSelect = useCallback((tpl: AutomationTemplate) => {
    setEditingTask({
      id: "",
      name: tpl.name,
      prompt: tpl.defaultPrompt,
      frequency: { ...tpl.defaultFrequency },
      enabled: true,
      createdAt: "",
      fromTemplate: tpl.id,
    });
    setShowForm(true);
  }, []);

  const handleAddManual = useCallback(() => {
    setEditingTask(null);
    setShowForm(true);
  }, []);

  const handleEdit = useCallback((task: AutomationTask) => {
    setEditingTask(task);
    setShowForm(true);
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-base font-semibold text-text-strong">自动化</h3>
        <p className="mt-1 text-xs text-text-muted">管理自动化任务，让 Machi 按计划为你工作。</p>
      </div>

      {/* System section */}
      <Panel title="系统" collapsible defaultCollapsed>
        <PreventSleepToggle />
      </Panel>

      {/* Templates */}
      <TemplateGrid onSelect={handleTemplateSelect} />

      {/* Task list */}
      <Panel
        title="我的自动化任务"
        actions={
          <button
            type="button"
            onClick={handleAddManual}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-text-muted transition hover:bg-surface-card hover:text-text-primary"
          >
            <Plus className="h-3.5 w-3.5" />
            添加任务
          </button>
        }
      >
        {runHint ? (
          <div
            className={`mb-2 rounded-lg border px-3 py-2 text-xs ${
              runHint.kind === "ok"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                : "border-rose-500/30 bg-rose-500/10 text-rose-200"
            }`}
          >
            {runHint.text}
          </div>
        ) : null}
        {loading ? (
          <div className="py-4 text-center text-sm text-text-faint">加载中…</div>
        ) : (
          <TaskList
            tasks={tasks}
            onToggle={handleToggle}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onRunNow={handleRunNow}
          />
        )}
      </Panel>

      {/* Form modal */}
      {showForm && (
        <TaskFormPanel
          initial={editingTask}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditingTask(null); }}
        />
      )}
    </div>
  );
}
