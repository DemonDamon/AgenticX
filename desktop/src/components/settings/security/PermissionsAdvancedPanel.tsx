import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Panel } from "../../ds/Panel";
import { SettingsSwitch } from "../SettingsSwitch";
import { useAppStore } from "../../../store";

type PathRule = { pattern: string; allow: boolean };

type RegistryToolRow = { name: string; description?: string; category?: string; is_meta?: boolean };

export type PermissionsAdvancedPanelHandle = {
  /** 将路径/命令/工具拒绝列表写入后端；与输入框失焦保存等效，供窗口底部「保存」统一触发。 */
  flushPermissions: () => Promise<{ ok: boolean; error?: string }>;
};

export const PermissionsAdvancedPanel = forwardRef<PermissionsAdvancedPanelHandle>(function PermissionsAdvancedPanel(_props, ref) {
  const [pathRules, setPathRules] = useState<PathRule[]>([]);
  const [deniedCommands, setDeniedCommands] = useState<string[]>([]);
  const [deniedTools, setDeniedTools] = useState<string[]>([]);
  const [registryTools, setRegistryTools] = useState<RegistryToolRow[]>([]);
  const [toolInsertFilter, setToolInsertFilter] = useState("");
  const [permMode, setPermMode] = useState("default");
  const [unattendedAllowWorkspaceScripts, setUnattendedAllowWorkspaceScripts] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const apiToken = useAppStore((s) => s.apiToken);
  const backendUrl = useAppStore((s) => s.backendUrl);

  /** 与 CC Bridge / Hooks 等面板一致：未配置远程 URL 时用本机内置 Studio 的 API 根地址，避免请求落到 `/api/...` 相对路径导致 HTTP 404。 */
  const resolveApiBase = useCallback(async () => {
    const u = (backendUrl ?? "").trim();
    if (u) return u.replace(/\/+$/, "");
    const raw = String((await window.agenticxDesktop.getApiBase()) || "").trim();
    return raw.replace(/\/+$/, "");
  }, [backendUrl]);

  const filteredRegistryTools = useMemo(() => {
    const q = toolInsertFilter.trim().toLowerCase();
    const rows = registryTools.filter((t) => t.name);
    if (!q) return rows;
    return rows.filter((t) => {
      const d = (t.description ?? "").toLowerCase();
      return t.name.toLowerCase().includes(q) || d.includes(q) || (t.category ?? "").toLowerCase().includes(q);
    });
  }, [registryTools, toolInsertFilter]);

  const fetchPerms = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (apiToken) headers["x-agx-desktop-token"] = apiToken;
      const base = await resolveApiBase();
      const [permRes, regRes] = await Promise.all([
        fetch(`${base}/api/permissions`, { headers }),
        fetch(`${base}/api/tools/registry`, { headers }),
      ]);
      const data = await permRes.json();
      if (data.ok) {
        setPermMode(data.mode ?? "default");
        setPathRules(
          (data.path_rules ?? []).map((r: { pattern?: string; allow?: boolean }) => ({
            pattern: r.pattern ?? "",
            allow: r.allow !== false,
          })),
        );
        setDeniedCommands(data.denied_commands ?? []);
        setDeniedTools(data.denied_tools ?? []);
        setUnattendedAllowWorkspaceScripts(data.unattended_allow_workspace_scripts === true);
      }
      try {
        const reg = await regRes.json();
        if (reg.ok && Array.isArray(reg.tools)) {
          setRegistryTools(
            reg.tools.map((t: { name?: string; description?: string; category?: string; is_meta?: boolean }) => ({
              name: String(t.name ?? "").trim(),
              description: typeof t.description === "string" ? t.description : "",
              category: typeof t.category === "string" ? t.category : "",
              is_meta: Boolean(t.is_meta),
            })),
          );
        } else {
          setRegistryTools([]);
        }
      } catch {
        setRegistryTools([]);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [apiToken, resolveApiBase]);

  useEffect(() => { void fetchPerms(); }, [fetchPerms]);

  const persist = useCallback(
    async (patch: Record<string, unknown>) => {
      setBusy(true);
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (apiToken) headers["x-agx-desktop-token"] = apiToken;
        const base = await resolveApiBase();
        await fetch(`${base}/api/permissions`, {
          method: "PUT",
          headers,
          body: JSON.stringify(patch),
        });
        await fetchPerms();
      } finally {
        setBusy(false);
      }
    },
    [apiToken, resolveApiBase, fetchPerms],
  );

  const appendDeniedTool = useCallback(
    (rawName: string) => {
      const trimmed = rawName.trim();
      if (!trimmed) return;
      setDeniedTools((prev) => {
        if (prev.some((p) => p.trim() === trimmed)) return prev;
        const next = [...prev, trimmed];
        queueMicrotask(() => {
          void persist({ denied_tools: next });
        });
        return next;
      });
    },
    [persist],
  );

  useImperativeHandle(
    ref,
    () => ({
      flushPermissions: async () => {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (apiToken) headers["x-agx-desktop-token"] = apiToken;
        const pathRulesPayload = pathRules.filter((r) => String(r.pattern ?? "").trim());
        const deniedCommandsPayload = deniedCommands.map((s) => String(s).trim()).filter(Boolean);
        const deniedToolsPayload = deniedTools.map((s) => String(s).trim()).filter(Boolean);
        try {
          const base = await resolveApiBase();
          const res = await fetch(`${base}/api/permissions`, {
            method: "PUT",
            headers,
            body: JSON.stringify({
              path_rules: pathRulesPayload,
              denied_commands: deniedCommandsPayload,
              denied_tools: deniedToolsPayload,
              unattended_allow_workspace_scripts: unattendedAllowWorkspaceScripts,
            }),
          });
          let detail = "";
          try {
            const j = (await res.json()) as { detail?: string; error?: string };
            if (!res.ok) {
              detail =
                (typeof j?.detail === "string" && j.detail) ||
                (typeof j?.error === "string" && j.error) ||
                "";
            }
          } catch {
            /* ignore */
          }
          if (!res.ok) {
            return { ok: false, error: detail || `HTTP ${res.status}` };
          }
          await fetchPerms();
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),
    [apiToken, resolveApiBase, pathRules, deniedCommands, deniedTools, unattendedAllowWorkspaceScripts, fetchPerms],
  );

  if (loading) return null;

  return (
    <>
      <Panel title="定时任务 / 无人值守">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm text-text-subtle">允许执行工作区内已存在的脚本</div>
            <p className="mt-1 text-xs leading-relaxed text-text-faint">
              仅放行工作区内已存在的脚本；删除、关机、外发类操作仍会被拒绝。
            </p>
          </div>
          <SettingsSwitch
            checked={unattendedAllowWorkspaceScripts}
            disabled={busy}
            onChange={(next) => {
              setUnattendedAllowWorkspaceScripts(next);
              void persist({ unattended_allow_workspace_scripts: next });
            }}
            aria-label="允许执行工作区内已存在的脚本"
          />
        </div>
      </Panel>

      <Panel title="文件访问">
        <div className="text-xs text-text-faint mb-2">
          按 glob 模式匹配文件路径。
        </div>
        <div className="space-y-1.5">
          {pathRules.map((rule, idx) => (
            <div key={`pr-${idx}`} className="flex gap-2 items-center">
              <input
                className="flex-1 rounded-md border border-border bg-surface-panel px-2 py-1 text-sm font-mono"
                value={rule.pattern}
                placeholder="/etc/*"
                disabled={busy}
                onChange={(e) => {
                  const next = pathRules.map((r, i) => (i === idx ? { ...r, pattern: e.target.value } : r));
                  setPathRules(next);
                }}
                onBlur={() => void persist({ path_rules: pathRules })}
              />
              <select
                className="rounded-md border border-border bg-surface-panel px-1.5 py-1 text-xs"
                value={rule.allow ? "allow" : "deny"}
                disabled={busy}
                onChange={(e) => {
                  const next = pathRules.map((r, i) =>
                    i === idx ? { ...r, allow: e.target.value === "allow" } : r,
                  );
                  setPathRules(next);
                  void persist({ path_rules: next });
                }}
              >
                <option value="allow">允许</option>
                <option value="deny">拒绝</option>
              </select>
              <button
                type="button"
                className="shrink-0 rounded-md border border-border p-1.5 text-text-subtle transition hover:bg-surface-hover hover:text-rose-400 disabled:opacity-40"
                disabled={busy}
                onClick={() => {
                  const next = pathRules.filter((_, i) => i !== idx);
                  setPathRules(next);
                  void persist({ path_rules: next });
                }}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
            disabled={busy}
            onClick={() => setPathRules((prev) => [...prev, { pattern: "", allow: false }])}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            添加路径规则
          </button>
        </div>
      </Panel>

      <Panel title="命令执行">
        <div className="text-xs text-text-faint mb-2">
          命中的 shell 命令将被阻止执行。
        </div>
        <div className="space-y-1.5">
          {deniedCommands.map((cmd, idx) => (
            <div key={`dc-${idx}`} className="flex gap-2">
              <input
                className="flex-1 rounded-md border border-border bg-surface-panel px-2 py-1 text-sm font-mono"
                value={cmd}
                placeholder="rm -rf *"
                disabled={busy}
                onChange={(e) => {
                  const next = deniedCommands.map((c, i) => (i === idx ? e.target.value : c));
                  setDeniedCommands(next);
                }}
                onBlur={() => void persist({ denied_commands: deniedCommands })}
              />
              <button
                type="button"
                className="shrink-0 rounded-md border border-border p-1.5 text-text-subtle transition hover:bg-surface-hover hover:text-rose-400 disabled:opacity-40"
                disabled={busy}
                onClick={() => {
                  const next = deniedCommands.filter((_, i) => i !== idx);
                  setDeniedCommands(next);
                  void persist({ denied_commands: next });
                }}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
            disabled={busy}
            onClick={() => setDeniedCommands((prev) => [...prev, ""])}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            添加命令模式
          </button>
        </div>
      </Panel>

      <Panel title="工具权限">
        <div className="text-xs text-text-faint mb-2">
          按 Studio 工具名做 fnmatch（例如 <code className="text-text-subtle">bash_exec</code>、
          <code className="text-text-subtle">mcp_call</code>、<code className="text-text-subtle">file_*</code>
          ）。命中后<strong className="text-text-primary">直接拒绝</strong>该工具调用，且<strong className="text-text-primary">不会</strong>再弹出执行确认（策略优先于询问）。
          工具名与<strong className="text-text-primary">设置 → 工具</strong>页预授权列表一致；亦可到该页查看说明。
        </div>
        {registryTools.length > 0 ? (
          <details className="mb-3 rounded-md border border-border bg-surface-panel px-2 py-1.5">
            <summary className="cursor-pointer text-xs font-medium text-text-primary">
              从已注册工具插入（共 {registryTools.length} 个）
            </summary>
            <div className="mt-2 space-y-2">
              <input
                type="search"
                className="w-full rounded-md border border-border bg-surface-card px-2 py-1 text-xs text-text-primary placeholder:text-text-faint"
                placeholder="筛选工具名或描述…"
                value={toolInsertFilter}
                disabled={busy}
                onChange={(e) => setToolInsertFilter(e.target.value)}
                aria-label="筛选工具列表"
              />
              <div className="max-h-40 overflow-y-auto rounded border border-[var(--border-muted)] bg-surface-card p-1.5">
                <div className="flex flex-wrap gap-1">
                  {filteredRegistryTools.map((t) => (
                    <button
                      key={t.name}
                      type="button"
                      disabled={busy}
                      title={t.description ? `${t.description.slice(0, 400)}` : t.name}
                      className="rounded border border-border bg-surface-panel px-1.5 py-0.5 font-mono text-[11px] text-text-primary transition hover:bg-surface-hover hover:border-text-subtle disabled:opacity-40"
                      onClick={() => appendDeniedTool(t.name)}
                    >
                      {t.name}
                      {t.is_meta ? (
                        <span className="ml-0.5 text-[9px] text-amber-400/90">meta</span>
                      ) : null}
                    </button>
                  ))}
                </div>
                {filteredRegistryTools.length === 0 ? (
                  <div className="py-2 text-center text-[11px] text-text-faint">无匹配项，清空筛选试试</div>
                ) : null}
              </div>
            </div>
          </details>
        ) : (
          <div className="mb-2 text-[11px] text-status-warning">
            未能加载工具注册表（需后端在线）。仍可手动输入工具名；完整列表见设置 → 工具页。
          </div>
        )}
        <datalist id="agx-studio-tool-names-datalist">
          {registryTools.map((t) => (
            <option key={t.name} value={t.name}>
              {(t.description ?? "").slice(0, 80)}
            </option>
          ))}
        </datalist>
        <div className="space-y-1.5">
          {deniedTools.map((toolPat, idx) => (
            <div key={`dt-${idx}`} className="flex gap-2">
              <input
                className="flex-1 rounded-md border border-border bg-surface-panel px-2 py-1 text-sm font-mono"
                value={toolPat}
                placeholder="bash_exec"
                list="agx-studio-tool-names-datalist"
                autoComplete="off"
                disabled={busy}
                onChange={(e) => {
                  const next = deniedTools.map((t, i) => (i === idx ? e.target.value : t));
                  setDeniedTools(next);
                }}
                onBlur={() => void persist({ denied_tools: deniedTools })}
              />
              <button
                type="button"
                className="shrink-0 rounded-md border border-border p-1.5 text-text-subtle transition hover:bg-surface-hover hover:text-rose-400 disabled:opacity-40"
                disabled={busy}
                onClick={() => {
                  const next = deniedTools.filter((_, i) => i !== idx);
                  setDeniedTools(next);
                  void persist({ denied_tools: next });
                }}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
            disabled={busy}
            onClick={() => setDeniedTools((prev) => [...prev, ""])}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            添加工具模式
          </button>
        </div>
      </Panel>
    </>
  );
});
