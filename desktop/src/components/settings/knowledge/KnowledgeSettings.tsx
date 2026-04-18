// Plan-Id: machi-kb-stage1-local-mvp
// Plan-File: .cursor/plans/2026-04-14-machi-kb-stage1-local-mvp.plan.md

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Library, Loader2 } from "lucide-react";
import { useAppStore } from "../../../store";
import { createKbApi } from "./api";
import { KnowledgeConfigPanel } from "./KnowledgeConfigPanel";
import { KnowledgeMaterialsPanel } from "./KnowledgeMaterialsPanel";
import { KnowledgeDebugPanel } from "./KnowledgeDebugPanel";
import type { KBConfig, KBStats } from "./types";
import { defaultKBConfig } from "./types";

type InnerTab = "config" | "materials" | "debug";

export type KnowledgeSettingsHandle = {
  /** Persist pending edits in the config sub-panel to /api/kb/config.
   *  Called by the outer SettingsPanel footer "保存" so the user does not
   *  have to click two save buttons. */
  flushIfDirty: () => Promise<{ ok: boolean; error?: string }>;
};

export const KnowledgeSettings = forwardRef<KnowledgeSettingsHandle>(function KnowledgeSettings(
  _props,
  ref,
) {
  const apiToken = useAppStore((s) => s.apiToken);
  const backendUrl = useAppStore((s) => s.backendUrl);

  const resolveApiBase = useCallback(async () => {
    const u = (backendUrl ?? "").trim();
    if (u) return u.replace(/\/+$/, "");
    const raw = String((await window.agenticxDesktop.getApiBase()) || "").trim();
    return raw.replace(/\/+$/, "");
  }, [backendUrl]);

  const api = useMemo(() => createKbApi(apiToken, resolveApiBase), [apiToken, resolveApiBase]);

  const [inner, setInner] = useState<InnerTab>("config");
  const [config, setConfig] = useState<KBConfig>(defaultKBConfig());
  const [stats, setStats] = useState<KBStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Working copy of the config panel. Lives here (not inside KnowledgeConfigPanel)
  // so the outer footer can flush it on save.
  const [draft, setDraft] = useState<KBConfig>(defaultKBConfig());
  const draftRef = useRef<KBConfig>(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const body = await api.readConfig();
      setConfig(body.config);
      setDraft(body.config);
      setStats(body.stats);
      setError(null);
    } catch (exc) {
      setError(String((exc as Error).message ?? exc));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useImperativeHandle(
    ref,
    () => ({
      async flushIfDirty() {
        const persisted = config;
        const next = draftRef.current;
        if (JSON.stringify(persisted) === JSON.stringify(next)) {
          return { ok: true };
        }
        try {
          const result = await api.writeConfig(next);
          setConfig(result.config);
          setDraft(result.config);
          try {
            const s = await api.getStats();
            setStats(s);
          } catch {
            /* non-fatal */
          }
          return { ok: true };
        } catch (exc) {
          const msg = String((exc as Error).message ?? exc);
          setError(`保存知识库配置失败：${msg}`);
          return { ok: false, error: msg };
        }
      },
    }),
    [api, config],
  );

  const innerTabs: { id: InnerTab; label: string }[] = [
    { id: "config", label: "配置" },
    { id: "materials", label: "资料" },
    { id: "debug", label: "调试" },
  ];

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Library className="h-4 w-4 text-[var(--settings-accent-fg)]" />
          知识库
          {stats ? (
            <span className="ml-2 text-xs text-text-subtle">
              · 资料 {stats.doc_count} · 已索引 {stats.indexed_doc_count}
              {stats.failed_doc_count > 0 ? ` · 失败 ${stats.failed_doc_count}` : ""}
              {stats.rebuild_required ? "  · ⚠️ 需重建" : ""}
            </span>
          ) : null}
        </div>
        <div className="flex overflow-hidden rounded-md border border-border text-xs">
          {innerTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`px-3 py-1 transition ${
                inner === t.id
                  ? "bg-[var(--settings-accent-solid)] font-medium text-[var(--settings-accent-solid-text)]"
                  : "bg-transparent text-text-subtle hover:bg-surface-hover hover:text-text-primary"
              }`}
              onClick={() => setInner(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {error ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-text-subtle">
          <Loader2 className="h-4 w-4 animate-spin" /> 读取 KB 配置…
        </div>
      ) : (
        <>
          {inner === "config" ? (
            <KnowledgeConfigPanel
              api={api}
              persistedConfig={config}
              draft={draft}
              onDraftChange={setDraft}
              initialStats={stats}
              onSaved={(next, rebuild, newStats) => {
                setConfig(next);
                setDraft(next);
                if (newStats) setStats(newStats);
                else setStats((prev) => (prev ? { ...prev, rebuild_required: rebuild } : prev));
              }}
            />
          ) : null}
          {inner === "materials" ? (
            <KnowledgeMaterialsPanel
              api={api}
              enabled={config.enabled}
              extensions={config.file_filters.extensions}
            />
          ) : null}
          {inner === "debug" ? <KnowledgeDebugPanel api={api} config={config} /> : null}
        </>
      )}
    </div>
  );
});
