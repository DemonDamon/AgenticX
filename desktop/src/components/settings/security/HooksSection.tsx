import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Panel } from "../../ds/Panel";
import { SettingsSwitch } from "../SettingsSwitch";
import { useAppStore } from "../../../store";
import { studioFetch } from "../../../utils/studio-fetch";

type CuratedHookItem = {
  name: string;
  description: string;
  events: string[];
  enabled: boolean;
  source: string;
};

type ImportedHookItem = {
  name: string;
  source: string;
  event: string;
  type: string;
  command?: string;
  url?: string;
  prompt?: string;
  matcher?: string;
  block_on_failure?: boolean;
  timeout_seconds?: number;
  enabled: boolean;
  source_path?: string;
  discovered_via?: string;
  event_inferred?: boolean;
  duplicate_count?: number;
  duplicate_sources?: string[];
  usability?: string;
};

type HookSettings = {
  preset_paths: Record<string, { enabled: boolean }>;
  custom_paths: string[];
  declarative: unknown[];
  disabled: string[];
};

type HookScanPathItem = {
  source: string;
  path: string;
  exists: boolean;
};

type ScanSummary = {
  raw_total: number;
  deduped_total: number;
  source_counts: Record<string, number>;
};

const HOOK_PRIMARY_CONFIG_PATH = "~/.agenticx/hooks/";

const HOOK_PRESETS: { key: string; label: string; path: string }[] = [
  { key: "cursor_plugins", label: "Cursor 插件目录", path: "~/.cursor/plugins/" },
  { key: "claude_plugins", label: "Claude 插件目录", path: "~/.claude/plugins/" },
];

function hookSourceBadge(source: string): { label: string; className: string } {
  const base = "shrink-0 rounded-full border px-1.5 text-[10px]";
  switch (source) {
    case "bundled":
    case "agenticx":
      return { label: "内置", className: `${base} border-zinc-500/30 bg-zinc-500/10 text-zinc-400` };
    case "cursor":
      return { label: "Cursor", className: `${base} border-sky-500/30 bg-sky-500/10 text-sky-400` };
    case "claude":
      return { label: "Claude", className: `${base} border-orange-500/30 bg-orange-500/10 text-orange-400` };
    case "cursor_plugins":
      return { label: "Cursor 插件", className: `${base} border-sky-500/30 bg-sky-500/10 text-sky-400` };
    case "claude_plugins":
      return { label: "Claude 插件", className: `${base} border-emerald-500/30 bg-emerald-500/10 text-emerald-400` };
    case "managed":
      return { label: "用户", className: `${base} border-purple-500/30 bg-purple-500/10 text-purple-400` };
    case "workspace":
      return { label: "工作区", className: `${base} border-cyan-500/30 bg-cyan-500/10 text-cyan-400` };
    default:
      return { label: "自定义", className: `${base} border-border bg-surface-panel text-text-faint` };
  }
}

function hookTypeBadge(hookType: string): { label: string; className: string } {
  const base = "shrink-0 rounded-full border px-1.5 text-[10px]";
  switch (hookType) {
    case "command":
      return { label: "命令", className: `${base} border-amber-500/30 bg-amber-500/10 text-amber-400` };
    case "http":
      return { label: "HTTP", className: `${base} border-blue-500/30 bg-blue-500/10 text-blue-400` };
    case "prompt":
      return { label: "提示词", className: `${base} border-green-500/30 bg-green-500/10 text-green-400` };
    case "agent":
      return { label: "智能体", className: `${base} border-rose-500/30 bg-rose-500/10 text-rose-400` };
    default:
      return { label: hookType, className: `${base} border-border bg-surface-panel text-text-faint` };
  }
}

const EVENT_LABELS: Record<string, string> = {
  before_tool_call: "preToolUse",
  after_tool_call: "postToolUse",
  session_start: "sessionStart",
  session_end: "sessionEnd",
  preToolUse: "preToolUse",
  postToolUse: "postToolUse",
};

export function HooksSection() {
  const [curatedHooks, setCuratedHooks] = useState<CuratedHookItem[]>([]);
  const [importedHooks, setImportedHooks] = useState<ImportedHookItem[]>([]);
  const [scanSummary, setScanSummary] = useState<ScanSummary>({ raw_total: 0, deduped_total: 0, source_counts: {} });
  const [scanPaths, setScanPaths] = useState<HookScanPathItem[]>([]);
  const [hookError, setHookError] = useState<string>("");
  const [settingsError, setSettingsError] = useState<string>("");
  const [settings, setSettings] = useState<HookSettings>({
    preset_paths: {},
    custom_paths: [],
    declarative: [],
    disabled: [],
  });
  const [customPaths, setCustomPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const apiToken = useAppStore((s) => s.apiToken);
  const backendUrl = useAppStore((s) => s.backendUrl);

  const fetchAll = useCallback(async () => {
    try {
      const token = apiToken || (await window.agenticxDesktop.getApiAuthToken()) || "";
      const headers: Record<string, string> = {};
      if (token) headers["x-agx-desktop-token"] = token;

      const [hooksRes, settingsRes] = await Promise.all([
        studioFetch("/api/hooks", { headers, storeBase: backendUrl }),
        studioFetch("/api/hooks/settings", { headers, storeBase: backendUrl }),
      ]);
      const hooksData = await hooksRes.json();
      const settingsData = await settingsRes.json();

      if (hooksData.ok) {
        setCuratedHooks(hooksData.curated_hooks ?? []);
        setImportedHooks(hooksData.imported_hooks ?? []);
        setScanSummary(hooksData.scan_summary ?? { raw_total: 0, deduped_total: 0, source_counts: {} });
        setScanPaths(hooksData.scan_paths ?? []);
        setHookError("");
      } else {
        setCuratedHooks([]);
        setImportedHooks([]);
        setScanPaths(hooksData.scan_paths ?? []);
        setHookError(
          String(hooksData.error ?? hooksData.detail ?? `/api/hooks 请求失败（HTTP ${hooksRes.status || "unknown"}）`),
        );
      }
      if (settingsData.ok) {
        setSettings(settingsData);
        setCustomPaths(settingsData.custom_paths ?? []);
        setSettingsError("");
      } else {
        setSettingsError(String(settingsData.error ?? settingsData.detail ?? "/api/hooks/settings 拉取失败"));
      }
    } catch (err) {
      setCuratedHooks([]);
      setImportedHooks([]);
      setScanPaths([]);
      setHookError(err instanceof Error ? err.message : "拉取 Hook 配置失败");
      setSettingsError("");
    } finally {
      setLoading(false);
    }
  }, [apiToken, backendUrl]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const persistSettings = useCallback(
    async (patch: Partial<HookSettings>) => {
      setBusy(true);
      try {
        const token = apiToken || (await window.agenticxDesktop.getApiAuthToken()) || "";
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["x-agx-desktop-token"] = token;
        const resp = await studioFetch("/api/hooks/settings", {
          method: "PUT",
          headers,
          body: JSON.stringify(patch),
          storeBase: backendUrl,
        });
        const data = await resp.json().catch(() => null);
        if (!resp.ok || !data?.ok) {
          throw new Error(String(data?.detail ?? data?.error ?? `HTTP ${resp.status}`));
        }
        await fetchAll();
      } finally {
        setBusy(false);
      }
    },
    [apiToken, backendUrl, fetchAll],
  );

  const togglePreset = useCallback(
    (key: string, enabled: boolean) => {
      void persistSettings({ preset_paths: { ...settings.preset_paths, [key]: { enabled } } });
    },
    [settings.preset_paths, persistSettings],
  );

  const persistCustomPaths = useCallback(
    (paths: string[]) => void persistSettings({ custom_paths: paths.filter((p) => p.trim()) }),
    [persistSettings],
  );

  const toggleHookEnabled = useCallback(
    (hookName: string, enabled: boolean) => {
      const current = Array.isArray(settings.disabled) ? settings.disabled : [];
      const next = enabled ? current.filter((id) => id !== hookName) : Array.from(new Set([...current, hookName]));
      setSettings((prev) => ({ ...prev, disabled: next }));
      setCuratedHooks((prev) => prev.map((h) => (h.name === hookName ? { ...h, enabled } : h)));
      setImportedHooks((prev) => prev.map((h) => (h.name === hookName ? { ...h, enabled } : h)));
      void persistSettings({ disabled: next }).catch(() => void fetchAll());
    },
    [fetchAll, persistSettings, settings.disabled],
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-text-subtle">
        <Loader2 className="h-4 w-4 animate-spin" /> 正在加载钩子配置...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-text-subtle">
        钩子（Hooks）是智能体在执行的特定节点运行自定义脚本，可用于修改行为、执行策略或记录日志。
      </div>

      {hookError ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-300">{hookError}</div>
      ) : null}

      {/* Block A: 预置钩子 */}
      <Panel title={`预置钩子 (${curatedHooks.length})`} collapsible>
        {curatedHooks.length === 0 ? (
          <div className="py-3 text-center text-xs text-text-faint">暂无预置钩子</div>
        ) : (
          <div className="divide-y divide-border">
            {curatedHooks.map((hook) => (
              <div key={hook.name} className="flex items-center gap-3 px-1 py-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">{hook.name}</span>
                    <span className="shrink-0 rounded-full border border-zinc-500/30 bg-zinc-500/10 px-1.5 text-[10px] text-zinc-400">内置</span>
                  </div>
                  <div className="mt-0.5 text-xs text-text-faint truncate">{hook.description}</div>
                  {hook.events?.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {hook.events.map((ev) => (
                        <span key={ev} className="rounded bg-surface-hover px-1 py-0.5 text-[10px] font-mono text-text-subtle">{ev}</span>
                      ))}
                    </div>
                  )}
                </div>
                <SettingsSwitch
                  checked={hook.enabled}
                  disabled={busy}
                  size="sm"
                  aria-label={`启用 ${hook.name}`}
                  onChange={(next) => toggleHookEnabled(hook.name, next)}
                />
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Block B: 外部导入（默认折叠） */}
      <Panel
        title={`外部导入钩子${scanSummary.deduped_total > 0 ? ` (${scanSummary.deduped_total} 条，去重自 ${scanSummary.raw_total} 条)` : ""}`}
        collapsible
        defaultCollapsed
      >
        <div className="space-y-3">
            <div className="space-y-2">
              {settingsError ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">配置路径读取异常：{settingsError}</div>
              ) : null}
              <div className="text-xs text-text-faint">勾选预设路径可自动导入 Cursor / Claude Code 等工具的 Hooks。</div>
              {HOOK_PRESETS.map((preset) => {
                const isOn = settings.preset_paths?.[preset.key]?.enabled !== false;
                return (
                  <label key={preset.key} className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-1.5">
                    <input type="checkbox" checked={isOn} disabled={busy} onChange={(e) => togglePreset(preset.key, e.target.checked)} className="h-3.5 w-3.5 accent-[var(--ui-btn-primary-bg)]" />
                    <span className="flex-1 text-sm text-text-primary">{preset.label}</span>
                    <span className="text-xs text-text-faint">{preset.path}</span>
                  </label>
                );
              })}
              {customPaths.map((row, idx) => (
                <div key={`hook-path-${idx}`} className="flex gap-2">
                  <input className="flex-1 rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm" value={row} placeholder="例如 /path/to/hooks/" onChange={(e) => setCustomPaths((prev) => prev.map((p, i) => (i === idx ? e.target.value : p)))} onBlur={() => persistCustomPaths(customPaths)} disabled={busy} />
                  <button type="button" className="shrink-0 rounded-md border border-border p-2 text-text-subtle transition hover:bg-surface-hover hover:text-rose-400 disabled:opacity-40" title="移除此路径" disabled={busy} onClick={() => { const next = customPaths.filter((_, i) => i !== idx); setCustomPaths(next); persistCustomPaths(next); }}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              ))}
              <button type="button" className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40" disabled={busy} onClick={() => setCustomPaths((prev) => [...prev, ""])}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                添加配置路径
              </button>
            </div>
            {importedHooks.length === 0 ? (
              <div className="py-2 text-center text-xs text-text-faint">未发现外部钩子</div>
            ) : (
              <div className="divide-y divide-border rounded-md border border-border">
                {importedHooks.map((hook, idx) => {
                  const srcBadge = hookSourceBadge(hook.source || "custom");
                  const typeBadge = hookTypeBadge(hook.type);
                  const snippet = hook.command?.slice(0, 100) ?? hook.url?.slice(0, 100) ?? "";
                  const eventLabel = EVENT_LABELS[hook.event] ?? hook.event;
                  return (
                    <div key={`${hook.name}-${idx}`} className="px-3 py-2">
                      <div className="flex items-center gap-2 justify-between">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded bg-surface-hover px-1 py-0.5 text-[10px] font-mono text-text-subtle">{eventLabel}</span>
                          <span className={srcBadge.className}>{srcBadge.label}</span>
                          <span className={typeBadge.className}>{typeBadge.label}</span>
                          {(hook.duplicate_count ?? 1) > 1 && (
                            <span className="text-[10px] text-text-faint">x{hook.duplicate_count} 来自 {(hook.duplicate_sources ?? []).join(", ")}</span>
                          )}
                          {hook.usability === "needs_env" && (
                            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 text-[10px] text-amber-300">需要外部环境</span>
                          )}
                        </div>
                        <SettingsSwitch checked={hook.enabled} disabled={busy} size="sm" aria-label={`启用 ${hook.name}`} onChange={(next) => toggleHookEnabled(hook.name, next)} />
                      </div>
                      {snippet && <div className="mt-1 truncate font-mono text-[11px] text-text-faint">{snippet}</div>}
                    </div>
                  );
                })}
              </div>
            )}
        </div>
      </Panel>
    </div>
  );
}
