// Plan-Id: machi-kb-stage1-local-mvp
import { useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { Panel } from "../../ds/Panel";
import type { KBApi } from "./api";
import {
  CHUNKING_STRATEGIES,
  EMBEDDING_PROVIDERS,
  defaultKBConfig,
  type KBConfig,
  type KBStats,
} from "./types";

type Props = {
  api: KBApi;
  initialConfig: KBConfig;
  initialStats: KBStats | null;
  onSaved: (nextConfig: KBConfig, rebuildRequired: boolean, stats: KBStats | null) => void;
};

export function KnowledgeConfigPanel({ api, initialConfig, initialStats, onSaved }: Props) {
  const [config, setConfig] = useState<KBConfig>(initialConfig);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rebuildRequired, setRebuildRequired] = useState<boolean>(
    Boolean(initialStats?.rebuild_required),
  );
  const [ollamaStatus, setOllamaStatus] = useState<"unknown" | "ok" | "missing">("unknown");

  useEffect(() => {
    setConfig(initialConfig);
  }, [initialConfig]);

  // Plan-Id: machi-kb-stage1-local-mvp (t13) — best-effort Ollama probe.
  useEffect(() => {
    let cancelled = false;
    if (config.embedding.provider !== "ollama") {
      setOllamaStatus("unknown");
      return;
    }
    const base = config.embedding.base_url || "http://localhost:11434";
    (async () => {
      try {
        const res = await fetch(`${base.replace(/\/+$/, "")}/api/tags`, { method: "GET" });
        if (cancelled) return;
        if (res.ok) {
          const body = await res.json().catch(() => ({}));
          const models: string[] = Array.isArray(body?.models)
            ? body.models.map((m: { name?: string }) => (m?.name ? String(m.name) : "")).filter(Boolean)
            : [];
          const has = models.some(
            (name) => name === config.embedding.model || name.startsWith(`${config.embedding.model}:`),
          );
          setOllamaStatus(has ? "ok" : "missing");
        } else {
          setOllamaStatus("missing");
        }
      } catch {
        if (!cancelled) setOllamaStatus("missing");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config.embedding.provider, config.embedding.model, config.embedding.base_url]);

  const embeddingChanged = useMemo(
    () =>
      initialConfig.embedding.provider !== config.embedding.provider ||
      initialConfig.embedding.model !== config.embedding.model ||
      initialConfig.embedding.dim !== config.embedding.dim,
    [initialConfig, config],
  );

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const result = await api.writeConfig(config);
      setRebuildRequired(Boolean(result.rebuild_required));
      // fetch fresh stats so the "rebuild required" badge stays accurate
      let stats: KBStats | null = null;
      try {
        stats = await api.getStats();
      } catch {
        stats = null;
      }
      onSaved(result.config, Boolean(result.rebuild_required), stats);
    } catch (exc) {
      setError(String((exc as Error).message ?? exc));
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setConfig(defaultKBConfig());
  }

  function patch<K extends keyof KBConfig>(key: K, value: KBConfig[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  function patchEmbeddingProvider(providerId: string) {
    const preset = EMBEDDING_PROVIDERS.find((p) => p.id === providerId);
    setConfig((prev) => ({
      ...prev,
      embedding: {
        ...prev.embedding,
        provider: providerId,
        model: preset?.defaultModel ?? prev.embedding.model,
        dim: preset?.defaultDim ?? prev.embedding.dim,
      },
    }));
  }

  return (
    <div className="space-y-3">
      {rebuildRequired ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          ⚠️ 嵌入模型或维度已变更，现有索引与新配置不一致，需要在「资料」页点「重建索引」后才能重新检索。
        </div>
      ) : null}

      {config.embedding.provider === "ollama" && ollamaStatus === "missing" ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          未在本机 ({config.embedding.base_url || "http://localhost:11434"}) 检测到 Ollama 或模型
          <code className="mx-1 rounded bg-rose-500/20 px-1 py-0.5">{config.embedding.model}</code>。
          你可以继续保存（稍后启动 Ollama 即可），也可以切换到「OpenAI / SiliconFlow / Bailian」等在线 Provider。
        </div>
      ) : null}

      <Panel title="启用">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => patch("enabled", e.target.checked)}
          />
          <span>启用本地知识库（禁用后 `knowledge_search` 工具返回空结果）</span>
        </label>
      </Panel>

      <Panel title="向量库">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="后端">
            <input
              className="kb-input"
              value={config.vector_store.backend}
              readOnly
              title="Stage-1 MVP 仅支持 Chroma"
            />
          </Field>
          <Field label="存储路径">
            <input
              className="kb-input"
              value={config.vector_store.path}
              onChange={(e) =>
                patch("vector_store", { ...config.vector_store, path: e.target.value })
              }
            />
          </Field>
          <Field label="集合名">
            <input
              className="kb-input"
              value={config.vector_store.collection}
              onChange={(e) =>
                patch("vector_store", { ...config.vector_store, collection: e.target.value })
              }
            />
          </Field>
        </div>
      </Panel>

      <Panel title="嵌入模型">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Provider">
            <select
              className="kb-input"
              value={config.embedding.provider}
              onChange={(e) => patchEmbeddingProvider(e.target.value)}
            >
              {EMBEDDING_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="模型">
            <input
              className="kb-input"
              value={config.embedding.model}
              onChange={(e) =>
                patch("embedding", { ...config.embedding, model: e.target.value })
              }
            />
          </Field>
          <Field label="维度 (dim)">
            <input
              type="number"
              className="kb-input"
              value={config.embedding.dim}
              min={16}
              max={4096}
              onChange={(e) =>
                patch("embedding", { ...config.embedding, dim: Number(e.target.value) || 0 })
              }
            />
          </Field>
          <Field label="Base URL">
            <input
              className="kb-input"
              value={config.embedding.base_url ?? ""}
              placeholder={
                config.embedding.provider === "ollama" ? "http://localhost:11434" : "可选"
              }
              onChange={(e) =>
                patch("embedding", {
                  ...config.embedding,
                  base_url: e.target.value || null,
                })
              }
            />
          </Field>
          <Field label="API Key 环境变量名（可选）">
            <input
              className="kb-input"
              value={config.embedding.api_key_env ?? ""}
              placeholder="如 OPENAI_API_KEY"
              onChange={(e) =>
                patch("embedding", {
                  ...config.embedding,
                  api_key_env: e.target.value || null,
                })
              }
            />
          </Field>
        </div>
        {embeddingChanged ? (
          <p className="mt-3 text-xs text-text-subtle">
            修改嵌入模型后，保存时将提示现有索引需要重建 —— 该操作不会自动删除向量库。
          </p>
        ) : null}
      </Panel>

      <Panel title="切片策略">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Strategy">
            <select
              className="kb-input"
              value={config.chunking.strategy}
              onChange={(e) =>
                patch("chunking", { ...config.chunking, strategy: e.target.value })
              }
            >
              {CHUNKING_STRATEGIES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="chunk_size">
            <input
              type="number"
              className="kb-input"
              value={config.chunking.chunk_size}
              min={64}
              onChange={(e) =>
                patch("chunking", {
                  ...config.chunking,
                  chunk_size: Number(e.target.value) || 800,
                })
              }
            />
          </Field>
          <Field label="chunk_overlap">
            <input
              type="number"
              className="kb-input"
              value={config.chunking.chunk_overlap}
              min={0}
              onChange={(e) =>
                patch("chunking", {
                  ...config.chunking,
                  chunk_overlap: Number(e.target.value) || 0,
                })
              }
            />
          </Field>
        </div>
      </Panel>

      <Panel title="文件过滤">
        <Field label="扩展名（逗号分隔）">
          <input
            className="kb-input"
            value={config.file_filters.extensions.join(",")}
            onChange={(e) =>
              patch("file_filters", {
                ...config.file_filters,
                extensions: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
        <Field label="单文件上限 (MB)">
          <input
            type="number"
            className="kb-input"
            value={config.file_filters.max_file_size_mb}
            min={1}
            onChange={(e) =>
              patch("file_filters", {
                ...config.file_filters,
                max_file_size_mb: Number(e.target.value) || 1,
              })
            }
          />
        </Field>
      </Panel>

      <Panel title="检索">
        <Field label="默认 Top-K">
          <input
            type="number"
            className="kb-input"
            min={1}
            max={20}
            value={config.retrieval.top_k}
            onChange={(e) =>
              patch("retrieval", {
                ...config.retrieval,
                top_k: Math.min(20, Math.max(1, Number(e.target.value) || 5)),
              })
            }
          />
        </Field>
      </Panel>

      {error ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          保存失败：{error}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          className="kb-button-ghost"
          onClick={reset}
          disabled={saving}
        >
          <RotateCcw className="h-3.5 w-3.5" /> 重置为默认
        </button>
        <button
          type="button"
          className="kb-button-primary"
          onClick={save}
          disabled={saving}
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          保存
        </button>
      </div>

      <style>{`
        .kb-input {
          width: 100%;
          border: 1px solid var(--color-border, #e5e7eb);
          background: var(--color-surface-card, #fff);
          border-radius: 0.375rem;
          padding: 0.4rem 0.6rem;
          font-size: 0.875rem;
        }
        .kb-input:focus {
          outline: 2px solid var(--color-accent, #6366f1);
          outline-offset: -1px;
        }
        .kb-button-primary, .kb-button-ghost {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.4rem 0.8rem;
          border-radius: 0.375rem;
          font-size: 0.8rem;
          cursor: pointer;
          border: 1px solid transparent;
        }
        .kb-button-primary {
          background: var(--color-accent, #6366f1);
          color: white;
        }
        .kb-button-primary:disabled { opacity: 0.55; cursor: progress; }
        .kb-button-ghost {
          border-color: var(--color-border, #e5e7eb);
          background: transparent;
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-text-subtle">
      <span className="mb-1 inline-block">{label}</span>
      {children}
    </label>
  );
}
