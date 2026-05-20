import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDown, ChevronRight, FolderOpen, Loader2 } from "lucide-react";
import { useAppStore } from "../../../store";
import { createCodeIndexApi } from "./api";
import { defaultCodeIndexConfig, type CodeIndexConfig, type CodeIndexTaskStatus } from "./types";

export type CodeIndexSettingsHandle = {
  flushIfDirty: () => Promise<{ ok: boolean; error?: string }>;
};

function SettingsSwitch({
  checked,
  disabled,
  onChange,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition ${
        checked ? "bg-[var(--settings-accent)]" : "bg-surface-panel"
      } ${disabled ? "opacity-40" : ""}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
          checked ? "left-5" : "left-0.5"
        }`}
      />
    </button>
  );
}

export const CodeIndexSettingsPanel = forwardRef<CodeIndexSettingsHandle>(function CodeIndexSettingsPanel(
  _props,
  ref,
) {
  const apiToken = useAppStore((s) => s.apiToken);
  const backendUrl = useAppStore((s) => s.backendUrl);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [advOpen, setAdvOpen] = useState(false);
  const [draft, setDraft] = useState<CodeIndexConfig>(defaultCodeIndexConfig());
  const [tasks, setTasks] = useState<CodeIndexTaskStatus[]>([]);
  const draftRef = useRef(draft);
  const dirtyRef = useRef(false);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const resolveApiBase = useCallback(async () => {
    const u = (backendUrl ?? "").trim();
    if (u) return u.replace(/\/+$/, "");
    const raw = String((await window.agenticxDesktop.getApiBase()) || "").trim();
    return raw.replace(/\/+$/, "");
  }, [backendUrl]);

  const api = useMemo(() => createCodeIndexApi(apiToken, resolveApiBase), [apiToken, resolveApiBase]);

  const reloadTasks = useCallback(async () => {
    if (!draft.enabled) {
      setTasks([]);
      return;
    }
    try {
      const list = await api.listTasks();
      setTasks(list);
    } catch {
      setTasks([]);
    }
  }, [api, draft.enabled]);

  const reload = useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      const cfg = await api.readConfig();
      setDraft(cfg);
      dirtyRef.current = false;
      await reloadTasks();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [api, reloadTasks]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!draft.enabled) return;
    const t = window.setInterval(() => void reloadTasks(), 4000);
    return () => window.clearInterval(t);
  }, [draft.enabled, reloadTasks]);

  const persist = useCallback(async () => {
    setBusy(true);
    setMsg("");
    try {
      await api.writeConfig(draftRef.current);
      dirtyRef.current = false;
      setMsg("已保存，立即生效（无需重启 Machi）。");
      await reloadTasks();
      return { ok: true as const };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      setMsg(err);
      return { ok: false as const, error: err };
    } finally {
      setBusy(false);
    }
  }, [api, reloadTasks]);

  useImperativeHandle(
    ref,
    () => ({
      flushIfDirty: async () => {
        if (!dirtyRef.current) return { ok: true };
        return persist();
      },
    }),
    [persist],
  );

  const statusLabel = (() => {
    if (!draft.enabled) return "已关闭";
    if (tasks.length === 0) return "未索引";
    const indexing = tasks.find((t) => t.status === "indexing");
    if (indexing) {
      const pct =
        indexing.files_total > 0
          ? Math.round((indexing.files_done / indexing.files_total) * 100)
          : 0;
      return `索引中 ${pct}%`;
    }
    const failed = tasks.find((t) => t.status === "indexfailed");
    if (failed) return "失败";
    const ready = tasks.some((t) => t.status === "indexed");
    return ready ? "已就绪" : "未索引";
  })();

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-surface-card p-4 text-sm text-text-faint">
        加载代码语义索引…
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface-card p-4">
      <div className="mb-1 text-sm font-medium text-text-primary">代码语义索引</div>
      <p className="mb-3 text-xs text-text-faint">
        为 Agent 提供 <code className="text-text-subtle">code_search</code> 工具（Semble hybrid）。
        探索阶段优先于整文件读取；精确字符串匹配请用 grep。
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-subtle">启用代码语义索引</span>
          <span
            className={`rounded px-2 py-0.5 text-xs ${
              statusLabel === "已就绪"
                ? "bg-emerald-500/15 text-emerald-300"
                : statusLabel === "失败"
                  ? "bg-rose-500/15 text-rose-300"
                  : statusLabel.startsWith("索引中")
                    ? "bg-amber-500/15 text-amber-200"
                    : "bg-surface-panel text-text-faint"
            }`}
            title={tasks.find((t) => t.error_summary)?.error_summary ?? undefined}
          >
            {statusLabel}
          </span>
        </div>
        <SettingsSwitch
          checked={draft.enabled}
          disabled={busy}
          aria-label="启用代码语义索引"
          onChange={(next) => {
            dirtyRef.current = true;
            setDraft((d) => ({ ...d, enabled: next }));
          }}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!draft.enabled || busy}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle hover:bg-surface-hover disabled:opacity-40"
          onClick={() => {
            void (async () => {
              setBusy(true);
              setMsg("");
              try {
                await api.preloadModel();
                setMsg("嵌入模型预热已提交（首次约需数分钟）。");
              } catch (e) {
                setMsg(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          {busy ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : null}
          预热嵌入模型
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle hover:bg-surface-hover"
          onClick={() => void window.agenticxDesktop.openCodeIndexModelCache()}
        >
          <FolderOpen className="mr-1 inline h-3.5 w-3.5" />
          打开模型缓存目录
        </button>
      </div>
      <button
        type="button"
        className="mt-3 flex items-center gap-1 text-xs text-text-subtle"
        onClick={() => setAdvOpen((v) => !v)}
      >
        {advOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        高级设置
      </button>
      {advOpen ? (
        <div className={`mt-2 space-y-3 ${draft.enabled ? "" : "pointer-events-none opacity-50"}`}>
          <label className="block text-xs text-text-subtle">
            后端
            <select
              className="mt-1 w-full rounded border border-border bg-surface-panel px-2 py-1 text-sm"
              value={draft.backend}
              disabled
            >
              <option value="semble">Semble</option>
              <option value="native">Native（即将推出）</option>
            </select>
          </label>
          <label className="block text-xs text-text-subtle">
            默认检索模式
            <select
              className="mt-1 w-full rounded border border-border bg-surface-panel px-2 py-1 text-sm"
              value={draft.semble.search_mode}
              onChange={(e) => {
                dirtyRef.current = true;
                setDraft((d) => ({
                  ...d,
                  semble: { ...d.semble, search_mode: e.target.value as CodeIndexConfig["semble"]["search_mode"] },
                }));
              }}
            >
              <option value="hybrid">hybrid</option>
              <option value="semantic">semantic</option>
              <option value="bm25">bm25</option>
            </select>
          </label>
          <label className="block text-xs text-text-subtle">
            默认 top_k
            <input
              type="number"
              min={1}
              max={50}
              className="mt-1 w-full rounded border border-border bg-surface-panel px-2 py-1 text-sm"
              value={draft.semble.default_top_k}
              onChange={(e) => {
                dirtyRef.current = true;
                setDraft((d) => ({
                  ...d,
                  semble: { ...d.semble, default_top_k: Number(e.target.value) || 10 },
                }));
              }}
            />
          </label>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-text-subtle">索引 Markdown 等文本文件</span>
            <SettingsSwitch
              checked={draft.semble.include_text_files}
              onChange={(next) => {
                dirtyRef.current = true;
                setDraft((d) => ({ ...d, semble: { ...d.semble, include_text_files: next } }));
              }}
              aria-label="索引文本文件"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-text-subtle">启动时预热嵌入模型</span>
            <SettingsSwitch
              checked={draft.preload_model}
              onChange={(next) => {
                dirtyRef.current = true;
                setDraft((d) => ({ ...d, preload_model: next }));
              }}
              aria-label="启动时预热"
            />
          </div>
          <label className="block text-xs text-text-subtle">
            单库内存上限 (MB)
            <input
              type="number"
              min={128}
              max={8192}
              className="mt-1 w-full rounded border border-border bg-surface-panel px-2 py-1 text-sm"
              value={draft.max_index_memory_mb}
              onChange={(e) => {
                dirtyRef.current = true;
                setDraft((d) => ({ ...d, max_index_memory_mb: Number(e.target.value) || 1024 }));
              }}
            />
          </label>
          <p className="text-xs text-text-faint">
            模型：{draft.semble.model}（缓存目录见上方按钮）
          </p>
          {tasks.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs font-medium text-text-subtle">已索引工作区</div>
              {tasks.map((t) => (
                <div
                  key={t.task_id}
                  className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1.5 text-xs"
                >
                  <div className="min-w-0 flex-1 truncate text-text-subtle" title={t.codebase_path}>
                    {t.codebase_path}
                    <span className="ml-2 text-text-faint">
                      {t.status} · {t.total_chunks} chunks
                    </span>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 text-rose-300 hover:underline"
                    onClick={() => {
                      void (async () => {
                        try {
                          await api.clearIndex(t.codebase_path);
                          await reloadTasks();
                        } catch (e) {
                          setMsg(e instanceof Error ? e.message : String(e));
                        }
                      })();
                    }}
                  >
                    清除
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {msg ? <div className="mt-2 text-xs text-text-muted">{msg}</div> : null}
    </div>
  );
});
