// Plan-Id: machi-kb-stage1-local-mvp
import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, RotateCcw } from "lucide-react";
import { Panel } from "../../ds/Panel";
import type { KBApi, ParserStatus } from "./api";
import {
  CHUNKING_STRATEGIES,
  EMBEDDING_PROVIDERS,
  defaultKBConfig,
  type KBConfig,
  type KBStats,
} from "./types";
import { KB_FIELD_BASE } from "./kb-field-classes";

type Props = {
  api: KBApi;
  /** Config currently persisted on the backend (used for diffing / rebuild detection). */
  persistedConfig: KBConfig;
  /** Working copy owned by the parent so the outer SettingsPanel can flush it. */
  draft: KBConfig;
  onDraftChange: (next: KBConfig) => void;
  initialStats: KBStats | null;
};

export function KnowledgeConfigPanel({
  api,
  persistedConfig,
  draft,
  onDraftChange,
  initialStats,
}: Props) {
  const config = draft;
  const setConfig = (updater: KBConfig | ((prev: KBConfig) => KBConfig)) => {
    const next = typeof updater === "function" ? (updater as (p: KBConfig) => KBConfig)(draft) : updater;
    onDraftChange(next);
  };
  const [rebuildRequired, setRebuildRequired] = useState<boolean>(
    Boolean(initialStats?.rebuild_required),
  );
  useEffect(() => {
    setRebuildRequired(Boolean(initialStats?.rebuild_required));
  }, [initialStats?.rebuild_required]);
  const [ollamaStatus, setOllamaStatus] = useState<"unknown" | "ok" | "missing">("unknown");
  const [testStatus, setTestStatus] = useState<"idle" | "checking" | "ok" | "fail">("idle");
  const [testMessage, setTestMessage] = useState<string>("");
  const [parserStatus, setParserStatus] = useState<ParserStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await api.getParserStatus();
        if (!cancelled) setParserStatus(status);
      } catch {
        if (!cancelled) setParserStatus(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Reset the inline test badge whenever embedding-relevant fields change,
  // so users don't read a stale "有效 ✓" next to a key they just edited.
  useEffect(() => {
    setTestStatus("idle");
    setTestMessage("");
  }, [
    config.embedding.provider,
    config.embedding.model,
    config.embedding.dim,
    config.embedding.base_url,
    config.embedding.api_key,
  ]);

  async function testConnectivity() {
    setTestStatus("checking");
    setTestMessage("");
    try {
      const result = await api.testEmbedding(config.embedding);
      if (result.ok) {
        setTestStatus("ok");
        setTestMessage(
          `维度 ${result.actual_dim} · 用时 ${result.latency_ms ?? "?"}ms`,
        );
      } else {
        setTestStatus("fail");
        setTestMessage(result.error || `${result.stage ?? "unknown"} 阶段失败`);
      }
    } catch (exc) {
      setTestStatus("fail");
      setTestMessage(String((exc as Error).message ?? exc));
    }
  }

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
      persistedConfig.embedding.provider !== config.embedding.provider ||
      persistedConfig.embedding.model !== config.embedding.model ||
      persistedConfig.embedding.dim !== config.embedding.dim,
    [persistedConfig, config],
  );

  const dirty = useMemo(
    () => JSON.stringify(persistedConfig) !== JSON.stringify(config),
    [persistedConfig, config],
  );

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
              className={`w-full cursor-default opacity-90 ${KB_FIELD_BASE}`}
              value={config.vector_store.backend}
              readOnly
              title="Stage-1 MVP 仅支持 Chroma"
            />
          </Field>
          <Field label="存储路径">
            <input
              className={`w-full ${KB_FIELD_BASE}`}
              value={config.vector_store.path}
              onChange={(e) =>
                patch("vector_store", { ...config.vector_store, path: e.target.value })
              }
            />
          </Field>
          <Field label="集合名">
            <input
              className={`w-full ${KB_FIELD_BASE}`}
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
              className={`w-full ${KB_FIELD_BASE}`}
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
              className={`w-full ${KB_FIELD_BASE}`}
              value={config.embedding.model}
              onChange={(e) =>
                patch("embedding", { ...config.embedding, model: e.target.value })
              }
            />
          </Field>
          <Field label="维度 (dim)">
            <input
              type="number"
              className={`w-full ${KB_FIELD_BASE}`}
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
              className={`w-full ${KB_FIELD_BASE}`}
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
          <div className="md:col-span-2">
            <Field label="API Key">
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <ApiKeyInput
                    value={config.embedding.api_key ?? ""}
                    onChange={(v) =>
                      patch("embedding", {
                        ...config.embedding,
                        api_key: v || null,
                      })
                    }
                    placeholder={
                      config.embedding.provider === "ollama"
                        ? "本地 Ollama 可留空"
                        : "请粘贴百炼 / OpenAI / SiliconFlow 等在线服务的 API Key"
                    }
                  />
                </div>
                <button
                  type="button"
                  className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                    testStatus === "checking"
                      ? "border-amber-500/50 text-amber-400"
                      : testStatus === "ok"
                      ? "border-emerald-500/50 text-emerald-400"
                      : testStatus === "fail"
                      ? "border-rose-500/50 text-rose-400"
                      : "border-border text-text-subtle hover:bg-surface-hover hover:text-text-primary"
                  }`}
                  disabled={testStatus === "checking"}
                  onClick={testConnectivity}
                  title="发一条测试 embedding 请求，验证密钥、模型、维度是否可用"
                >
                  {testStatus === "checking"
                    ? "检测中…"
                    : testStatus === "ok"
                    ? "有效 ✓"
                    : testStatus === "fail"
                    ? "失败 ✗"
                    : "检 测"}
                </button>
              </div>
              {testMessage ? (
                <div
                  className={`mt-1 text-xs ${
                    testStatus === "ok"
                      ? "text-emerald-500"
                      : testStatus === "fail"
                      ? "text-rose-500"
                      : "text-text-subtle"
                  }`}
                >
                  {testMessage}
                </div>
              ) : null}
            </Field>
          </div>
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
              className={`w-full ${KB_FIELD_BASE}`}
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
              className={`w-full ${KB_FIELD_BASE}`}
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
              className={`w-full ${KB_FIELD_BASE}`}
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
          <div className="flex items-start gap-2">
            <input
              className={`min-w-0 flex-1 ${KB_FIELD_BASE}`}
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
            <button
              type="button"
              className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-subtle transition hover:bg-surface-hover hover:text-text-primary"
              onClick={() =>
                patch("file_filters", {
                  ...config.file_filters,
                  extensions: [...defaultKBConfig().file_filters.extensions],
                })
              }
              title="恢复 Machi 内置的全量支持列表（含 LiteParse 覆盖的旧版 Office、表格、图片）"
            >
              恢复默认
            </button>
          </div>
        </Field>
        <div className="md:col-span-2 -mt-1 flex flex-col gap-y-1 text-[11px] leading-snug text-text-faint">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            内置解析器 已就绪（纯文本 / PDF / DOCX / PPTX / HTML / JSON / CSV / YAML）
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                parserStatus?.liteparse?.available ? "bg-emerald-500" : "bg-amber-500"
              }`}
            />
            {parserStatus == null ? (
              "LiteParse 检测中…"
            ) : parserStatus.liteparse.available ? (
              <>
                LiteParse 已安装
                {parserStatus.liteparse.version ? ` v${parserStatus.liteparse.version}` : ""}
                <span className="ml-1 text-text-subtle">
                  （覆盖 .doc / .ppt / .xls / .xlsx / 图片 OCR）
                </span>
              </>
            ) : (
              <>
                未检测到 LiteParse — 旧版 Office、表格与图片暂不可解析。安装命令：
                <code className="ml-1 rounded bg-surface-hover px-1">
                  {parserStatus.install_hint || "npm i -g @llamaindex/liteparse"}
                </code>
              </>
            )}
          </span>
          {parserStatus?.libreoffice ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  parserStatus.libreoffice.available ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
              {parserStatus.libreoffice.available ? (
                <>
                  LibreOffice 已安装
                  <span className="ml-1 text-text-subtle">
                    （LiteParse 用于解析 .doc / .ppt / .xls / .xlsx）
                  </span>
                </>
              ) : (
                <>
                  未检测到 LibreOffice — 解析 .doc / .ppt / .xls / .xlsx 需要它做格式转换。安装命令：
                  <code className="ml-1 rounded bg-surface-hover px-1">
                    brew install --cask libreoffice
                  </code>
                </>
              )}
            </span>
          ) : null}
        </div>
        <Field label="单文件上限 (MB)">
          <input
            type="number"
            className={`w-full ${KB_FIELD_BASE}`}
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
        <Field label="触发模式">
          <select
            className={`w-full ${KB_FIELD_BASE}`}
            value={config.retrieval.mode ?? "auto"}
            onChange={(e) =>
              patch("retrieval", {
                ...config.retrieval,
                mode: (e.target.value as "auto" | "always" | "manual") || "auto",
              })
            }
          >
            <option value="auto">智能判断（推荐）</option>
            <option value="always">始终检索</option>
            <option value="manual">仅手动触发</option>
          </select>
        </Field>
        <Field label="默认 Top-K">
          <input
            type="number"
            className={`w-full ${KB_FIELD_BASE}`}
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
        <p className="mt-2 text-[11px] leading-snug text-text-faint">
          智能判断：仅在明显依赖用户文档时触发；始终检索：每轮优先检索后再回答；仅手动：只在你明确要求“查知识库”时触发。
        </p>
      </Panel>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {dirty ? (
          <span className="text-xs text-amber-500">· 有未保存的改动（请使用页面底部「保存」）</span>
        ) : null}
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-subtle transition hover:bg-surface-hover hover:text-text-primary"
          onClick={reset}
        >
          <RotateCcw className="h-3.5 w-3.5" /> 重置为默认
        </button>
      </div>
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

function ApiKeyInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        autoComplete="off"
        className={`w-full pr-10 ${KB_FIELD_BASE}`}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={visible ? "隐藏密钥" : "显示密钥"}
        className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-text-faint transition hover:bg-surface-hover hover:text-text-subtle"
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
