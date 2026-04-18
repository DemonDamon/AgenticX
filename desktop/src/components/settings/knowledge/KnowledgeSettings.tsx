// Plan-Id: machi-kb-stage1-local-mvp
// Plan-File: .cursor/plans/2026-04-14-machi-kb-stage1-local-mvp.plan.md

import { useCallback, useEffect, useMemo, useState } from "react";
import { Library, Loader2 } from "lucide-react";
import { useAppStore } from "../../../store";
import { createKbApi } from "./api";
import { KnowledgeConfigPanel } from "./KnowledgeConfigPanel";
import { KnowledgeMaterialsPanel } from "./KnowledgeMaterialsPanel";
import { KnowledgeDebugPanel } from "./KnowledgeDebugPanel";
import type { KBConfig, KBStats } from "./types";
import { defaultKBConfig } from "./types";

type InnerTab = "config" | "materials" | "debug";

export function KnowledgeSettings() {
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

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const body = await api.readConfig();
      setConfig(body.config);
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

  const innerTabs: { id: InnerTab; label: string }[] = [
    { id: "config", label: "配置" },
    { id: "materials", label: "资料" },
    { id: "debug", label: "调试" },
  ];

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Library className="h-4 w-4 text-accent" />
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
                  ? "bg-accent text-white"
                  : "bg-transparent text-text-subtle hover:text-text-primary"
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
              initialConfig={config}
              initialStats={stats}
              onSaved={(next, rebuild, newStats) => {
                setConfig(next);
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
}
