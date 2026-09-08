import {

  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, FolderOpen, Loader2 } from "lucide-react";
import { useAppStore } from "../../../store";
import { createCodeIndexApi } from "./api";
import { defaultCodeIndexConfig, type CodeIndexConfig, type CodeIndexTaskStatus } from "./types";
import { i18n } from "../../../i18n/i18n";

function st(key: string, opts?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: "settings", ...(opts ?? {}) }));
}


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
        className={`absolute top-0.5 h-5 w-5 rounded-full shadow transition ${
          checked ? "left-5 bg-[var(--theme-color-text)]" : "left-0.5 bg-white"
        }`}
      />
    </button>
  );
}

export const CodeIndexSettingsPanel = forwardRef<CodeIndexSettingsHandle>(function CodeIndexSettingsPanel(
  _props,
  ref,
) {
  const { t } = useTranslation("settings");
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
      setMsg(st("codeIndex.saved"));
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
    if (!draft.enabled) return st("codeIndex.off");
    if (tasks.length === 0) return st("codeIndex.notIndexed");
    const indexing = tasks.find((t) => t.status === "indexing");
    if (indexing) {
      const pct =
        indexing.files_total > 0
          ? Math.round((indexing.files_done / indexing.files_total) * 100)
          : 0;
      return st("codeIndex.indexing", { pct });
    }
    const failed = tasks.find((t) => t.status === "indexfailed");
    if (failed) return st("codeIndex.failed");
    const ready = tasks.some((t) => t.status === "indexed");
    return ready ? st("codeIndex.ready") : st("codeIndex.notIndexed");
  })();

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-surface-card p-4 text-sm text-text-faint">
        {st("codeIndex.loading")}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface-card p-4">
      <div className="mb-1 text-sm font-medium text-text-primary">{st("codeIndex.title")}</div>
      <p className="mb-3 text-xs text-text-faint">
        {st("codeIndex.intro")}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-subtle">{st("codeIndex.enable")}</span>
          <span
            className={`rounded px-2 py-0.5 text-xs ${
              statusLabel === st("codeIndex.ready")
                ? "bg-emerald-500/15 text-emerald-300"
                : statusLabel === st("codeIndex.failed")
                  ? "bg-rose-500/15 text-rose-300"
                  : statusLabel.startsWith(st("codeIndex.indexing", { pct: "__" }).split("__")[0])
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
          aria-label={st("codeIndex.enable")}
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
                setMsg(st("codeIndex.warmupSubmitted"));
              } catch (e) {
                setMsg(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          {busy ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : null}
          {st("codeIndex.warmup")}
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle hover:bg-surface-hover"
          onClick={() => void window.agenticxDesktop.openCodeIndexModelCache()}
        >
          <FolderOpen className="mr-1 inline h-3.5 w-3.5" />
          {st("codeIndex.openCache")}
        </button>
      </div>
      <button
        type="button"
        className="mt-3 flex items-center gap-1 text-xs text-text-subtle"
        onClick={() => setAdvOpen((v) => !v)}
      >
        {advOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {st("codeIndex.advanced")}
      </button>
      {advOpen ? (
        <div className={`mt-2 space-y-3 ${draft.enabled ? "" : "pointer-events-none opacity-50"}`}>
          <label className="block text-xs text-text-subtle">
            {st("codeIndex.backend")}
            <select
              className="mt-1 w-full rounded border border-border bg-surface-panel px-2 py-1 text-sm"
              value={draft.backend}
              disabled
            >
              <option value="semble">Semble</option>
              <option value="native">{st("codeIndex.nativeSoon")}</option>
            </select>
          </label>
          <label className="block text-xs text-text-subtle">
            {st("codeIndex.defaultMode")}
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
            {st("codeIndex.defaultTopK")}
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
            <span className="text-xs text-text-subtle">{st("codeIndex.indexText")}</span>
            <SettingsSwitch
              checked={draft.semble.include_text_files}
              onChange={(next) => {
                dirtyRef.current = true;
                setDraft((d) => ({ ...d, semble: { ...d.semble, include_text_files: next } }));
              }}
              aria-label={st("codeIndex.indexTextAria")}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-text-subtle">{st("codeIndex.warmupOnStart")}</span>
            <SettingsSwitch
              checked={draft.preload_model}
              onChange={(next) => {
                dirtyRef.current = true;
                setDraft((d) => ({ ...d, preload_model: next }));
              }}
              aria-label={st("codeIndex.warmupOnStartAria")}
            />
          </div>
          <label className="block text-xs text-text-subtle">
            {st("codeIndex.memLimit")}
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
            {st("codeIndex.modelCache", { model: draft.semble.model })}
          </p>
          {tasks.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs font-medium text-text-subtle">{st("codeIndex.indexedWs")}</div>
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
                    {st("codeIndex.clear")}
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
