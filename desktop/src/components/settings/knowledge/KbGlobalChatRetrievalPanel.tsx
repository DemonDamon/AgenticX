/**
 * Global chat KB retrieval trigger — applies to all sessions unless overridden
 * per session in the chat input bar. Persisted via /api/kb/config (not per-brain).
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Loader2, Radar, Sparkles } from "lucide-react";
import { createKbApi } from "./api";
import { defaultKBConfig, normalizeKbConfig, type KBConfig } from "./types";
import { setCachedGlobalKbRetrievalMode, type KbRetrievalMode } from "../../../utils/kb-retrieval-mode";

export type KbGlobalChatRetrievalHandle = {
  flushIfDirty: () => Promise<{ ok: boolean; error?: string }>;
};

type Props = {
  apiToken: string;
  resolveApiBase: () => Promise<string>;
  onDirtyChange?: (dirty: boolean) => void;
};

const MODE_OPTIONS: { value: KbRetrievalMode; label: string; hint: string; icon: typeof Sparkles }[] = [
  {
    value: "auto",
    label: "智能检索",
    hint: "由模型判断何时查知识库",
    icon: Sparkles,
  },
  {
    value: "always",
    label: "始终检索",
    hint: "回答前优先检索知识库",
    icon: Radar,
  },
];

export const KbGlobalChatRetrievalPanel = forwardRef<KbGlobalChatRetrievalHandle, Props>(
  function KbGlobalChatRetrievalPanel({ apiToken, resolveApiBase, onDirtyChange }, ref) {
    const api = useMemo(
      () => createKbApi(apiToken, resolveApiBase, "legacy"),
      [apiToken, resolveApiBase],
    );
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [persisted, setPersisted] = useState<KBConfig>(defaultKBConfig);
    const [draft, setDraft] = useState<KBConfig>(defaultKBConfig);
    const loadGenRef = useRef(0);

    const dirty = draft.retrieval.mode !== persisted.retrieval.mode;

    useEffect(() => {
      onDirtyChange?.(dirty);
    }, [dirty, onDirtyChange]);

    const reload = useCallback(async () => {
      const gen = ++loadGenRef.current;
      setLoading(true);
      setError(null);
      try {
        const body = await api.readConfig();
        if (gen !== loadGenRef.current) return;
        const normalized = normalizeKbConfig(body.config);
        setPersisted(normalized);
        setDraft(normalized);
        const mode = normalized.retrieval.mode === "always" ? "always" : "auto";
        setCachedGlobalKbRetrievalMode(mode);
      } catch (exc) {
        if (gen !== loadGenRef.current) return;
        setError(String((exc as Error).message ?? exc));
      } finally {
        if (gen === loadGenRef.current) setLoading(false);
      }
    }, [api]);

    useEffect(() => {
      void reload();
    }, [reload]);

    const flushIfDirty = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
      if (!dirty) return { ok: true };
      setSaving(true);
      setError(null);
      try {
        const result = await api.writeConfig(draft);
        const normalized = normalizeKbConfig(result.config);
        setPersisted(normalized);
        setDraft(normalized);
        const mode = normalized.retrieval.mode === "always" ? "always" : "auto";
        setCachedGlobalKbRetrievalMode(mode);
        return { ok: true };
      } catch (exc) {
        const msg = String((exc as Error).message ?? exc);
        setError(msg);
        return { ok: false, error: msg };
      } finally {
        setSaving(false);
      }
    }, [api, dirty, draft]);

    useImperativeHandle(ref, () => ({ flushIfDirty }), [flushIfDirty]);

    const effectiveMode: KbRetrievalMode =
      draft.retrieval.mode === "always" ? "always" : "auto";

    return (
      <section className="shrink-0 flex items-center justify-between gap-4 rounded-xl border border-border bg-surface-card px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
            默认检索模式
            {error ? <span className="text-[10px] font-normal text-red-400">{error}</span> : null}
          </h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">
            新建对话的默认模式；单会话可在输入框旁单独切换
          </p>
        </div>

        <div className="shrink-0">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              加载…
            </div>
          ) : (
            <div
              className="inline-grid grid-cols-2 rounded-md border border-border bg-surface-panel p-0.5"
              role="radiogroup"
              aria-label="检索模式"
            >
              {MODE_OPTIONS.map((opt) => {
                const active = effectiveMode === opt.value;
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={saving}
                    role="radio"
                    aria-checked={active}
                    className={`flex items-center justify-center gap-1.5 rounded-[4px] px-2.5 py-1 text-xs font-medium transition ${
                      active
                        ? "bg-[var(--settings-accent-solid)] text-[var(--settings-accent-solid-text)] shadow-sm"
                        : "text-text-muted hover:bg-surface-hover hover:text-text-strong"
                    }`}
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        retrieval: {
                          ...prev.retrieval,
                          mode: opt.value,
                        },
                      }))
                    }
                    title={opt.hint}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                    {opt.label}
                    {opt.value === "auto" ? (
                      <span
                        className={`ml-0.5 rounded px-1 py-px text-[9px] font-medium ${
                          active ? "bg-white/15" : "bg-surface-hover text-text-subtle"
                        }`}
                      >
                        推荐
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>
    );
  },
);
