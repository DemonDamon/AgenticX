import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "../../i18n/i18n";
import { Plus } from "lucide-react";
import { Panel } from "../ds/Panel";
import { TemplateGrid } from "./TemplateGrid";
import { TaskFormPanel } from "./TaskFormPanel";
import { deleteAutomationTaskWithConfirm } from "../../utils/automation-delete";
import { TaskList } from "./TaskList";
import type { AutomationTask, AutomationTemplate } from "./types";

function PreventSleepToggle() {
  const { t } = useTranslation("workspace");
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
        if (!disposed) setMessage(i18n.t("automation.loadConfigFailed", { ns: "workspace" }));
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
        setMessage(result?.error ? String(result.error) : i18n.t("automation.saveFailed", { ns: "workspace" }));
        setEnabled(!next);
        return;
      }
      setEnabled(next);
      setMessage(i18n.t("automation.saved", { ns: "workspace" }));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : i18n.t("automation.saveFailed", { ns: "workspace" }));
      setEnabled(!next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-card px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-strong">{t("automation.preventSleep")}</div>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">
          {t("automation.preventSleepHint")}
        </p>
        {message ? (
          <div className={`mt-1 text-xs ${message === t("automation.saved") ? "text-text-faint" : "text-rose-400"}`}>
            {message}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={enabled ? t("automation.sleepOn") : t("automation.sleepOff")}
        disabled={saving || loading}
        onClick={() => { if (!saving && !loading) void persist(!enabled); }}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--settings-accent-focus,rgba(59,130,246,0.5))] ${
          enabled ? "bg-[var(--ui-btn-primary-bg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]" : "bg-text-muted/35"
        } ${saving || loading ? "cursor-not-allowed opacity-50" : ""}`}
      >
        <span
          className={`pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full shadow-sm ring-1 ring-black/5 transition-transform duration-200 ease-out ${
            enabled ? "bg-[var(--ui-btn-primary-text)]" : "bg-white"
          } ${enabled ? "translate-x-4" : ""}`}
        />
      </button>
    </div>
  );
}

export function AutomationTab() {
  const { t } = useTranslation("workspace");
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
    const result = await deleteAutomationTaskWithConfirm(taskId);
    if (result.cancelled) return;
    if (result.ok) void loadTasks();
  }, [loadTasks]);

  const handleToggle = useCallback(async (taskId: string, enabled: boolean) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const updated = { ...task, enabled };
    const result = await window.agenticxDesktop.saveAutomationTask(updated);
    if (result?.ok) void loadTasks();
  }, [tasks, loadTasks]);

  const handleRunNow = useCallback(async (task: AutomationTask) => {
    const r = await window.agenticxDesktop.runAutomationTaskNow({ taskId: task.id });
    setRunHint(
      r.ok
        ? {
            kind: "ok",
            text: i18n.t("automation.runTriggered", { ns: "workspace" }),
          }
        : { kind: "err", text: r.error ?? i18n.t("automation.runFailed", { ns: "workspace" }) },
    );
    setTimeout(() => void loadTasks(), 1500);
  }, [loadTasks]);

  const handleTemplateSelect = useCallback((tpl: AutomationTemplate) => {
    setEditingTask({
      id: "",
      name: t(`automation.templates.${tpl.id}.name`),
      prompt: tpl.defaultPrompt,
      frequency: { ...tpl.defaultFrequency },
      enabled: true,
      createdAt: "",
      fromTemplate: tpl.id,
    });
    setShowForm(true);
  }, [t]);

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
      <div className="text-sm text-text-subtle">
      {t("automation.manageHint")}
      </div>

      {/* System section */}
      <Panel title={t("automation.system")} collapsible defaultCollapsed>
        <PreventSleepToggle />
      </Panel>

      {/* Templates */}
      <TemplateGrid onSelect={handleTemplateSelect} />

      {/* Task list */}
      <Panel
        title={t("automation.myTasks")}
        actions={
          <button
            type="button"
            onClick={handleAddManual}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-text-muted transition hover:bg-surface-card hover:text-text-primary"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("automation.addTask")}
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
          <div className="py-4 text-center text-sm text-text-faint">{t("automation.loading")}</div>
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
          onAfterDelete={async () => {
            setShowForm(false);
            setEditingTask(null);
            void loadTasks();
          }}
        />
      )}
    </div>
  );
}
