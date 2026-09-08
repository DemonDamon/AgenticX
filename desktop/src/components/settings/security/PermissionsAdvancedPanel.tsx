import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { Panel } from "../../ds/Panel";
import { SettingsSwitch } from "../SettingsSwitch";
import { SECURITY_RULES_ANCHOR_ID } from "../../../settings-tab";
import { useAppStore } from "../../../store";
import { SecurityRulesGuide } from "./SecurityRulesGuide";

type PathRule = { pattern: string; allow: boolean };

type RegistryToolRow = { name: string; description?: string; category?: string; is_meta?: boolean };

export type PermissionsAdvancedPanelHandle = {
  /** 将路径/命令/工具拒绝列表写入后端；与输入框失焦保存等效，供窗口底部「保存」统一触发。 */
  flushPermissions: () => Promise<{ ok: boolean; error?: string }>;
};

export type PermissionsAdvancedPanelProps = {
  /** 从运行模式「自定义」进入时，在规则区展示用法说明。 */
  showRulesGuide?: boolean;
  /** 每次带着 focus 打开时变化，用于重复进入仍滚动并重新展示说明。 */
  highlightKey?: number;
};

export const PermissionsAdvancedPanel = forwardRef<
  PermissionsAdvancedPanelHandle,
  PermissionsAdvancedPanelProps
>(function PermissionsAdvancedPanel(
  { showRulesGuide = false, highlightKey = 0 },
  ref,
) {
  const { t } = useTranslation("settings");
  const [pathRules, setPathRules] = useState<PathRule[]>([]);
  const [deniedCommands, setDeniedCommands] = useState<string[]>([]);
  const [deniedTools, setDeniedTools] = useState<string[]>([]);
  const [registryTools, setRegistryTools] = useState<RegistryToolRow[]>([]);
  const [toolInsertFilter, setToolInsertFilter] = useState("");
  const [permMode, setPermMode] = useState("default");
  const [unattendedAllowWorkspaceScripts, setUnattendedAllowWorkspaceScripts] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [guideDismissedKey, setGuideDismissedKey] = useState<number | null>(null);
  const [rulesHighlighted, setRulesHighlighted] = useState(false);
  const rulesAnchorRef = useRef<HTMLDivElement>(null);
  const apiToken = useAppStore((s) => s.apiToken);
  const backendUrl = useAppStore((s) => s.backendUrl);
  const showGuide = showRulesGuide && guideDismissedKey !== highlightKey;

  /** 与 CC Bridge / Hooks 等面板一致：未配置远程 URL 时用本机内置 Studio 的 API 根地址，避免请求落到 `/api/...` 相对路径导致 HTTP 404。 */
  const resolveApiBase = useCallback(async () => {
    const u = (backendUrl ?? "").trim();
    if (u) return u.replace(/\/+$/, "");
    const raw = String((await window.agenticxDesktop.getApiBase()) || "").trim();
    return raw.replace(/\/+$/, "");
  }, [backendUrl]);

  const filteredRegistryTools = useMemo(() => {
    const q = toolInsertFilter.trim().toLowerCase();
    const rows = registryTools.filter((tool) => tool.name);
    if (!q) return rows;
    return rows.filter((tool) => {
      const d = (tool.description ?? "").toLowerCase();
      return tool.name.toLowerCase().includes(q) || d.includes(q) || (tool.category ?? "").toLowerCase().includes(q);
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

  useEffect(() => {
    if (!showRulesGuide || loading) return;
    rulesAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setRulesHighlighted(true);
    const timer = window.setTimeout(() => setRulesHighlighted(false), 2400);
    return () => window.clearTimeout(timer);
  }, [showRulesGuide, highlightKey, loading]);

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
      <Panel title={t("security.unattendedTitle")}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm text-text-subtle">{t("security.allowWorkspaceScripts")}</div>
            <p className="mt-1 text-xs leading-relaxed text-text-faint">
              {t("security.allowWorkspaceScriptsHint")}
            </p>
          </div>
          <SettingsSwitch
            checked={unattendedAllowWorkspaceScripts}
            disabled={busy}
            onChange={(next) => {
              setUnattendedAllowWorkspaceScripts(next);
              void persist({ unattended_allow_workspace_scripts: next });
            }}
            aria-label={t("security.allowWorkspaceScripts")}
          />
        </div>
      </Panel>

      <div
        id={SECURITY_RULES_ANCHOR_ID}
        ref={rulesAnchorRef}
        className={`scroll-mt-3 space-y-4 rounded-xl p-0.5 transition-[box-shadow] duration-500 ${
          rulesHighlighted ? "shadow-[0_0_0_2px_var(--ui-btn-primary-bg)]" : ""
        }`}
      >
      {showGuide ? (
        <SecurityRulesGuide onDismiss={() => setGuideDismissedKey(highlightKey)} />
      ) : null}
      <Panel title={t("security.fileAccessTitle")}>
        <div className="text-xs leading-5 text-text-faint mb-2">
          {t("security.fileAccessHint")}
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
                <option value="allow">{t("security.allow")}</option>
                <option value="deny">{t("security.deny")}</option>
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
            {t("security.addPathRule")}
          </button>
        </div>
      </Panel>

      <Panel title={t("security.commandTitle")}>
        <div className="text-xs leading-5 text-text-faint mb-2">
          {t("security.commandHint")}
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
            {t("security.addCommandPattern")}
          </button>
        </div>
      </Panel>

      <Panel title={t("security.toolPermTitle")}>
        <div className="text-xs leading-5 text-text-faint mb-2">
          {t("security.toolPermHint")}
        </div>
        {registryTools.length > 0 ? (
          <details className="mb-3 rounded-md border border-border bg-surface-panel px-2 py-1.5">
            <summary className="cursor-pointer text-xs font-medium text-text-primary">
              {t("security.insertFromRegistry", { count: registryTools.length })}
            </summary>
            <div className="mt-2 space-y-2">
              <input
                type="search"
                className="w-full rounded-md border border-border bg-surface-card px-2 py-1 text-xs text-text-primary placeholder:text-text-faint"
                placeholder={t("security.filterToolsPh")}
                value={toolInsertFilter}
                disabled={busy}
                onChange={(e) => setToolInsertFilter(e.target.value)}
                aria-label={t("security.filterToolsAria")}
              />
              <div className="max-h-40 overflow-y-auto rounded border border-[var(--border-muted)] bg-surface-card p-1.5">
                <div className="flex flex-wrap gap-1">
                  {filteredRegistryTools.map((tool) => (
                    <button
                      key={tool.name}
                      type="button"
                      disabled={busy}
                      title={tool.description ? `${tool.description.slice(0, 400)}` : tool.name}
                      className="rounded border border-border bg-surface-panel px-1.5 py-0.5 font-mono text-[11px] text-text-primary transition hover:bg-surface-hover hover:border-text-subtle disabled:opacity-40"
                      onClick={() => appendDeniedTool(tool.name)}
                    >
                      {tool.name}
                      {tool.is_meta ? (
                        <span className="ml-0.5 text-[9px] text-amber-400/90">meta</span>
                      ) : null}
                    </button>
                  ))}
                </div>
                {filteredRegistryTools.length === 0 ? (
                  <div className="py-2 text-center text-[11px] text-text-faint">{t("security.noToolMatch")}</div>
                ) : null}
              </div>
            </div>
          </details>
        ) : (
          <div className="mb-2 text-[11px] text-status-warning">
            {t("security.registryOffline")}
          </div>
        )}
        <datalist id="agx-studio-tool-names-datalist">
          {registryTools.map((tool) => (
            <option key={tool.name} value={tool.name}>
              {(tool.description ?? "").slice(0, 80)}
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
                  const next = deniedTools.map((pat, i) => (i === idx ? e.target.value : pat));
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
            {t("security.addToolPattern")}
          </button>
        </div>
      </Panel>
      </div>
    </>
  );
});
