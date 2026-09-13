import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "../../i18n/i18n";
import { X, FolderOpen, ChevronDown } from "lucide-react";
import { FrequencyPicker } from "./FrequencyPicker";
import type { AutomationTask, AutomationFrequency } from "./types";
import { deleteAutomationTaskWithConfirm } from "../../utils/automation-delete";
import { useAppStore } from "../../store";
import { collectSelectableModelOptions, isModelSelectable } from "../../utils/model-options";

function encodeLlm(provider: string, model: string): string {
  return `${provider}:${model}`;
}

function decodeLlm(value: string): { provider: string; model: string } | null {
  const i = value.indexOf(":");
  if (i <= 0) return null;
  const provider = value.slice(0, i).trim();
  const model = value.slice(i + 1).trim();
  if (!provider || !model) return null;
  return { provider, model };
}

interface Props {
  initial?: AutomationTask | null;
  onSave: (task: AutomationTask) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => void;
  /** 删除成功后回调（刷新列表、关闭表单等） */
  onAfterDelete?: () => void | Promise<void>;
}

function generateId(): string {
  return `atask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function TaskFormPanel({ initial, onSave, onCancel, onAfterDelete }: Props) {
  const { t } = useTranslation("workspace");
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
  const editingId = initial?.id?.trim() ?? "";
  const canDelete = Boolean(editingId);

  const [workspaceDirs, setWorkspaceDirs] = useState<string[]>([]);
  const [wsDropdown, setWsDropdown] = useState(false);
  const [wsFilter, setWsFilter] = useState("");
  const [wsHint, setWsHint] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const settings = useAppStore((s) => s.settings);
  const [llmValue, setLlmValue] = useState(() => {
    const p = (initial?.provider ?? "").trim();
    const m = (initial?.model ?? "").trim();
    return p && m ? encodeLlm(p, m) : "";
  });

  const llmOptions = useMemo(() => {
    return collectSelectableModelOptions(settings.providers).map((row) => ({
      value: encodeLlm(row.provider, row.model),
      label: row.label,
    }));
  }, [settings.providers]);

  useEffect(() => {
    const decoded = decodeLlm(llmValue.trim());
    if (!decoded) return;
    if (isModelSelectable(decoded.provider, decoded.model, settings.providers)) return;
    setLlmValue("");
  }, [llmValue, settings.providers]);

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
      setWsHint(r?.error ? String(r.error) : i18n.t("automation.noDirSelected", { ns: "workspace" }));
    } catch (e) {
      setWsHint(e instanceof Error ? e.message : i18n.t("automation.pickDirFailed", { ns: "workspace" }));
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
      const llm = decodeLlm(llmValue.trim());
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
        ...(llm ? { provider: llm.provider, model: llm.model } : {}),
      };
      if (!llm) {
        delete (task as { provider?: string }).provider;
        delete (task as { model?: string }).model;
      }
      const res = await onSave(task);
      if (!res.ok) setSaveError(res.error?.trim() || i18n.t("automation.saveFailedRetry", { ns: "workspace" }));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : i18n.t("automation.saveFailedShort", { ns: "workspace" }));
    } finally {
      setSaving(false);
    }
  }, [name, prompt, workspace, frequency, dateRangeEnabled, dateStart, dateEnd, llmValue, initial, onSave]);

  const handleDeleteClick = useCallback(async () => {
    if (!canDelete || !editingId) return;
    setSaving(true);
    setSaveError("");
    try {
      const res = await deleteAutomationTaskWithConfirm(editingId);
      if (res.cancelled) return;
      if (!res.ok) {
        setSaveError(res.error?.trim() || i18n.t("automation.deleteFailedRetry", { ns: "workspace" }));
        return;
      }
      await onAfterDelete?.();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : i18n.t("automation.deleteFailedShort", { ns: "workspace" }));
    } finally {
      setSaving(false);
    }
  }, [canDelete, editingId, onAfterDelete]);

  const filteredDirs = workspaceDirs.filter((d) =>
    d.toLowerCase().includes(wsFilter.toLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div className="agx-task-form-panel relative isolate flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-border bg-[var(--surface-base-fallback)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="text-sm font-semibold text-text-strong">
            {initial?.id?.trim() ? t("automation.editTitle") : t("automation.addTitle")}
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
            <span className="text-sm font-medium text-text-strong">{t("automation.name")}</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("automation.namePlaceholder")}
              className="mt-1 w-full rounded-md border border-border bg-surface-card px-3 py-2 text-sm text-text-primary placeholder:text-text-faint focus:border-text-subtle focus:outline-none"
            />
          </label>

          {/* Workspace */}
          <div className="relative" ref={dropdownRef}>
            <span className="text-sm font-medium text-text-strong">{t("automation.workspace")}</span>
            <span className="ml-1 text-xs text-text-faint">
              {t("automation.workspaceHint")}
            </span>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface-card px-3 py-2 text-left text-sm transition hover:border-text-faint"
                onClick={() => setWsDropdown(!wsDropdown)}
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-text-faint" />
                <span className={`min-w-0 flex-1 truncate ${workspace ? "text-text-primary" : "text-text-faint"}`}>
                  {workspace || t("automation.pickWorkspace")}
                </span>
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-text-faint transition ${wsDropdown ? "rotate-180" : ""}`} />
              </button>
              <button
                type="button"
                title={t("automation.browseFolderTip")}
                className="shrink-0 rounded-md border border-border bg-surface-card px-3 py-2 text-xs font-medium text-text-muted transition hover:border-text-faint hover:text-text-primary"
                onClick={() => void pickWorkspaceFolder()}
              >
                {t("automation.browseFolder")}
              </button>
            </div>
            {wsHint ? <p className="mt-1 text-xs text-rose-400">{wsHint}</p> : null}
            {wsDropdown && (
              <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-md border border-border bg-[var(--surface-base-fallback)] shadow-xl">
                <div className="border-b border-border px-2 py-1.5">
                  <input
                    type="text"
                    placeholder={t("automation.searchWorkspace")}
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
                      {t("automation.clearSelection")}
                    </button>
                  )}
                  {filteredDirs.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-text-faint">{t("automation.noWorkspace")}</div>
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

          {/* Per-task LLM */}
          <label className="block">
            <span className="text-sm font-medium text-text-strong">{t("automation.execModel")}</span>
            <span className="ml-1 text-xs text-text-faint">
              {t("automation.execModelHint")}
            </span>
            <select
              value={llmValue}
              onChange={(e) => setLlmValue(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-surface-card px-3 py-2 text-sm text-text-primary focus:border-text-subtle focus:outline-none"
            >
              <option value="">{t("automation.defaultModel")}</option>
              {llmOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {llmOptions.length === 0 ? (
              <p className="mt-1 text-xs text-amber-400/90">{t("automation.needApiKey")}</p>
            ) : null}
          </label>

          {/* Prompt */}
          <label className="block">
            <span className="text-sm font-medium text-text-strong">{t("automation.prompt")}</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder={t("automation.promptPlaceholder")}
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
              {dateRangeEnabled ? t("automation.dateRangeOn") : t("automation.dateRangeOff")}
              <span className="ml-1 text-text-faint">{t("automation.dateRangeHint")}</span>
            </button>
            {dateRangeEnabled && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="date"
                  value={dateStart}
                  onChange={(e) => setDateStart(e.target.value)}
                  className="rounded-md border border-border bg-surface-card px-2 py-1.5 text-sm text-text-primary"
                  placeholder={t("automation.startDate")}
                />
                <span className="text-xs text-text-faint">{t("automation.to")}</span>
                <input
                  type="date"
                  value={dateEnd}
                  onChange={(e) => setDateEnd(e.target.value)}
                  className="rounded-md border border-border bg-surface-card px-2 py-1.5 text-sm text-text-primary"
                  placeholder={t("automation.endDate")}
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
          <div className="order-1 flex flex-wrap items-center justify-end gap-2 sm:order-2 sm:shrink-0">
            {canDelete ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleDeleteClick()}
                className="mr-auto rounded-md px-3 py-1.5 text-sm text-rose-400 transition hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-40 sm:mr-0"
              >
                {t("automation.deleteTask")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="rounded-md px-4 py-1.5 text-sm text-text-muted transition hover:bg-surface-card hover:text-text-primary disabled:opacity-40"
            >
              {t("cancel", { ns: "common" })}
            </button>
            <button
              type="button"
              disabled={!name.trim() || !prompt.trim() || saving}
              onClick={() => void handleSave()}
              className="rounded-md bg-text-strong px-4 py-1.5 text-sm font-medium text-surface-panel transition hover:opacity-90 disabled:opacity-40"
            >
              {saving ? t("automation.saving") : t("save", { ns: "common" })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
