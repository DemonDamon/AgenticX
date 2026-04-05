import { useCallback, useEffect, useRef, useState } from "react";
import { X, FolderOpen, ChevronDown } from "lucide-react";
import { FrequencyPicker } from "./FrequencyPicker";
import type { AutomationTask, AutomationFrequency } from "./types";

interface Props {
  initial?: AutomationTask | null;
  onSave: (task: AutomationTask) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => void;
}

function generateId(): string {
  return `atask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function TaskFormPanel({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [workspace, setWorkspace] = useState(initial?.workspace ?? "");
  const [frequency, setFrequency] = useState<AutomationFrequency>(
    initial?.frequency ?? { type: "daily", time: "09:00", days: [1, 2, 3, 4, 5, 6, 7] },
  );
  const [dateRangeEnabled, setDateRangeEnabled] = useState(!!initial?.effectiveDateRange?.start || !!initial?.effectiveDateRange?.end);
  const [dateStart, setDateStart] = useState(initial?.effectiveDateRange?.start ?? "");
  const [dateEnd, setDateEnd] = useState(initial?.effectiveDateRange?.end ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [workspaceDirs, setWorkspaceDirs] = useState<string[]>([]);
  const [wsDropdown, setWsDropdown] = useState(false);
  const [wsFilter, setWsFilter] = useState("");
  const [wsHint, setWsHint] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const pickWorkspaceFolder = useCallback(async () => {
    setWsHint("");
    try {
      const r = await window.agenticxDesktop.chooseDirectory();
      if (r?.ok && r.path) {
        setWorkspace(r.path);
        setWsDropdown(false);
        setWsFilter("");
        return;
      }
      if (r?.canceled) return;
      setWsHint(r?.error ? String(r.error) : "未选择目录");
    } catch (e) {
      setWsHint(e instanceof Error ? e.message : "选择目录失败");
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const base = await window.agenticxDesktop.getApiBase();
        const token = await window.agenticxDesktop.getApiAuthToken();
        const resp = await fetch(`${base}/api/taskspace/workspaces`, {
          headers: token ? { "x-agx-desktop-token": token } : {},
        });
        if (resp.ok) {
          const data = (await resp.json()) as { workspaces?: Array<{ path: string; label?: string }> };
          if (data.workspaces) {
            setWorkspaceDirs(data.workspaces.map((w) => w.path));
          }
        }
      } catch { /* silent */ }
    };
    void load();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setWsDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim() || !prompt.trim()) return;
    setSaving(true);
    setSaveError("");
    try {
      const id = initial?.id?.trim() ? initial.id.trim() : generateId();
      const createdAt = initial?.createdAt?.trim() ? initial.createdAt.trim() : new Date().toISOString();
      const sid = (initial?.sessionId ?? "").trim() || undefined;
      const task: AutomationTask = {
        id,
        name: name.trim(),
        prompt: prompt.trim(),
        workspace: workspace || undefined,
        sessionId: sid,
        frequency,
        effectiveDateRange: dateRangeEnabled ? { start: dateStart || undefined, end: dateEnd || undefined } : undefined,
        enabled: initial?.enabled ?? true,
        createdAt,
        lastRunAt: initial?.lastRunAt,
        lastRunStatus: initial?.lastRunStatus,
        lastRunError: initial?.lastRunError,
        fromTemplate: initial?.fromTemplate,
      };
      const res = await onSave(task);
      if (!res.ok) setSaveError(res.error?.trim() || "保存失败，请重试。");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [name, prompt, workspace, frequency, dateRangeEnabled, dateStart, dateEnd, initial, onSave]);

  const filteredDirs = workspaceDirs.filter((d) =>
    d.toLowerCase().includes(wsFilter.toLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div className="relative isolate flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-border bg-[var(--surface-base-fallback)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="text-sm font-semibold text-text-strong">
            {initial?.id?.trim() ? "编辑自动化任务" : "添加自动化任务"}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 text-text-faint transition hover:bg-surface-card hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Name */}
          <label className="block">
            <span className="text-sm font-medium text-text-strong">名称</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：每日 AI 新闻推送"
              className="mt-1 w-full rounded-md border border-border bg-surface-card px-3 py-2 text-sm text-text-primary placeholder:text-text-faint focus:border-text-subtle focus:outline-none"
            />
          </label>

          {/* Workspace */}
          <div className="relative" ref={dropdownRef}>
            <span className="text-sm font-medium text-text-strong">工作空间</span>
            <span className="ml-1 text-xs text-text-faint">（可选）</span>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface-card px-3 py-2 text-left text-sm transition hover:border-text-faint"
                onClick={() => setWsDropdown(!wsDropdown)}
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-text-faint" />
                <span className={`min-w-0 flex-1 truncate ${workspace ? "text-text-primary" : "text-text-faint"}`}>
                  {workspace || "从已添加工作区选择…"}
                </span>
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-text-faint transition ${wsDropdown ? "rotate-180" : ""}`} />
              </button>
              <button
                type="button"
                title="在系统中浏览并选择文件夹"
                className="shrink-0 rounded-md border border-border bg-surface-card px-3 py-2 text-xs font-medium text-text-muted transition hover:border-text-faint hover:text-text-primary"
                onClick={() => void pickWorkspaceFolder()}
              >
                浏览文件夹
              </button>
            </div>
            {wsHint ? <p className="mt-1 text-xs text-rose-400">{wsHint}</p> : null}
            {wsDropdown && (
              <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-md border border-border bg-[var(--surface-base-fallback)] shadow-xl">
                <div className="border-b border-border px-2 py-1.5">
                  <input
                    type="text"
                    placeholder="搜索工作区..."
                    value={wsFilter}
                    onChange={(e) => setWsFilter(e.target.value)}
                    className="w-full bg-transparent text-xs text-text-primary placeholder:text-text-faint focus:outline-none"
                    autoFocus
                  />
                </div>
                <div className="max-h-40 overflow-y-auto py-1">
                  {workspace && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-muted hover:bg-surface-card"
                      onClick={() => { setWorkspace(""); setWsDropdown(false); setWsFilter(""); }}
                    >
                      清除选择
                    </button>
                  )}
                  {filteredDirs.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-text-faint">暂无工作区</div>
                  ) : (
                    filteredDirs.map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition hover:bg-surface-card ${
                          d === workspace ? "text-text-strong" : "text-text-muted"
                        }`}
                        onClick={() => { setWorkspace(d); setWsDropdown(false); setWsFilter(""); }}
                      >
                        <FolderOpen className="h-3 w-3 shrink-0" />
                        <span className="truncate">{d.split("/").pop()}</span>
                        <span className="ml-auto truncate text-[10px] text-text-faint">{d}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Prompt */}
          <label className="block">
            <span className="text-sm font-medium text-text-strong">提示词</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="描述 Machi 应该执行的任务..."
              className="mt-1 w-full resize-y rounded-md border border-border bg-surface-card px-3 py-2 text-sm text-text-primary placeholder:text-text-faint focus:border-text-subtle focus:outline-none"
            />
          </label>

          {/* Frequency */}
          <FrequencyPicker value={frequency} onChange={setFrequency} />

          {/* Date Range */}
          <div>
            <button
              type="button"
              className="text-xs text-text-muted hover:text-text-primary transition"
              onClick={() => setDateRangeEnabled(!dateRangeEnabled)}
            >
              {dateRangeEnabled ? "▾ 生效日期区间" : "▸ 生效日期区间"}
              <span className="ml-1 text-text-faint">（可选，留空表示始终生效。）</span>
            </button>
            {dateRangeEnabled && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="date"
                  value={dateStart}
                  onChange={(e) => setDateStart(e.target.value)}
                  className="rounded-md border border-border bg-surface-card px-2 py-1.5 text-sm text-text-primary"
                  placeholder="开始日期"
                />
                <span className="text-xs text-text-faint">至</span>
                <input
                  type="date"
                  value={dateEnd}
                  onChange={(e) => setDateEnd(e.target.value)}
                  className="rounded-md border border-border bg-surface-card px-2 py-1.5 text-sm text-text-primary"
                  placeholder="结束日期"
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 border-t border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          {saveError ? (
            <p className="order-2 text-xs text-rose-400 sm:order-1 sm:min-w-0 sm:flex-1 sm:pr-2">{saveError}</p>
          ) : (
            <span className="hidden sm:block sm:order-1 sm:flex-1" />
          )}
          <div className="order-1 flex justify-end gap-2 sm:order-2 sm:shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-4 py-1.5 text-sm text-text-muted transition hover:bg-surface-card hover:text-text-primary"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!name.trim() || !prompt.trim() || saving}
            onClick={() => void handleSave()}
            className="rounded-md bg-text-strong px-4 py-1.5 text-sm font-medium text-surface-panel transition hover:opacity-90 disabled:opacity-40"
          >
            {saving ? "保存中…" : "保存"}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
