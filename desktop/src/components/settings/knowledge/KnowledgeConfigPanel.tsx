// Plan-Id: machi-kb-stage1-local-mvp
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, BookOpen, Check, Eye, EyeOff, Loader2, RotateCcw, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Panel } from "../../ds/Panel";
import { SETTINGS_INTRO_CLASS, SETTINGS_LABEL_CLASS } from "../../ds/settings-typography";
import { SettingsSwitch } from "../SettingsSwitch";
import type { KBApi, ParserStatus } from "./api";
import {

  CHUNKING_STRATEGIES,
  EMBEDDING_PROVIDERS,
  RETRIEVAL_MODES,
  defaultKBConfig,
  type KBConfig,
  type KBStats,
} from "./types";
import { KB_FIELD_BASE } from "./kb-field-classes";
import { listKbEmbeddingModelOptions } from "../../../utils/embedding-model-options";
import type { ProviderCatalogEntry } from "../../../utils/model-options";
import { i18n } from "../../../i18n/i18n";

function st(key: string, opts?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: "settings", ...(opts ?? {}) }));
}

function embedProviderLabel(id: string): string {
  if (id === "ollama") return st("knowledge.provOllama");
  if (id === "bailian") return st("knowledge.provBailian");
  return EMBEDDING_PROVIDERS.find((p) => p.id === id)?.label ?? id;
}

function chunkStrategyLabel(id: string): string {
  if (id === "recursive") return st("knowledge.chunkRecursive");
  if (id === "contextual") return st("knowledge.chunkContextual");
  return CHUNKING_STRATEGIES.find((s) => s.id === id)?.label ?? id;
}

function retrievalModeLabel(id: string): string {
  const keys: Record<string, string> = {
    vector: "knowledge.retVector",
    bm25: "knowledge.retBm25",
    hybrid: "knowledge.retHybrid",
    hybrid_graph: "knowledge.retHybridGraph",
  };
  return keys[id] ? st(keys[id]) : id;
}


type Props = {
  api: KBApi;
  /** Config currently persisted on the backend (used for diffing / rebuild detection). */
  persistedConfig: KBConfig;
  /** Working copy owned by the parent so the outer SettingsPanel can flush it. */
  draft: KBConfig;
  onDraftChange: (next: KBConfig) => void;
  initialStats: KBStats | null;
  /** Model-service catalog (visible models from provider settings / API scan). */
  providerCatalog?: Record<string, ProviderCatalogEntry>;
};

export function KnowledgeConfigPanel({
  api,
  persistedConfig,
  draft,
  onDraftChange,
  initialStats,
  providerCatalog = {},
}: Props) {
  const { t } = useTranslation("settings");
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
  // so users don't read a stale st("knowledge.valid") next to a key they just edited.
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
          st("knowledge.dimLatency", { dim: result.actual_dim, ms: result.latency_ms ?? "?" }),
        );
      } else {
        setTestStatus("fail");
        setTestMessage(result.error || st("knowledge.stageFailed", { stage: result.stage ?? "unknown" }));
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

  const embeddingModelOptions = useMemo(
    () =>
      listKbEmbeddingModelOptions(
        config.embedding.provider,
        providerCatalog,
        config.embedding.model,
      ),
    [config.embedding.provider, config.embedding.model, providerCatalog],
  );

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
    const options = listKbEmbeddingModelOptions(
      providerId,
      providerCatalog,
      config.embedding.model,
    );
    const nextModel =
      options.find((m) => m === config.embedding.model) ??
      options[0] ??
      preset?.defaultModel ??
      config.embedding.model;
    setConfig((prev) => ({
      ...prev,
      embedding: {
        ...prev.embedding,
        provider: providerId,
        model: nextModel,
        dim: preset?.defaultDim ?? prev.embedding.dim,
      },
    }));
  }

  return (
    <div className="space-y-3">
      {rebuildRequired ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {st("knowledge.embedChanged")}
        </div>
      ) : null}

      {config.embedding.provider === "ollama" && ollamaStatus === "missing" ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          {st("knowledge.ollamaMissing", { url: config.embedding.base_url || "http://localhost:11434" })}
          <code className="mx-1 rounded bg-rose-500/20 px-1 py-0.5">{config.embedding.model}</code>
        </div>
      ) : null}

      <Panel title={st("knowledge.vectorStore")}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={st("knowledge.backend")}>
            <input
              className={`w-full cursor-default opacity-90 ${KB_FIELD_BASE}`}
              value={config.vector_store.backend}
              readOnly
              title={st("knowledge.chromaOnly")}
            />
          </Field>
          <Field label={st("knowledge.storePath")}>
            <input
              className={`w-full ${KB_FIELD_BASE}`}
              value={config.vector_store.path}
              onChange={(e) =>
                patch("vector_store", { ...config.vector_store, path: e.target.value })
              }
            />
          </Field>
          <Field label={st("knowledge.collection")}>
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

      <Panel title={st("knowledge.embedModel")}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Provider">
            <select
              className={`w-full ${KB_FIELD_BASE}`}
              value={config.embedding.provider}
              onChange={(e) => patchEmbeddingProvider(e.target.value)}
            >
              {EMBEDDING_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {embedProviderLabel(p.id)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={st("knowledge.model")}>
            {embeddingModelOptions.length > 0 ? (
              <select
                className={`w-full ${KB_FIELD_BASE}`}
                value={config.embedding.model}
                onChange={(e) =>
                  patch("embedding", { ...config.embedding, model: e.target.value })
                }
              >
                {embeddingModelOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className={`w-full ${KB_FIELD_BASE}`}
                value={config.embedding.model}
                onChange={(e) =>
                  patch("embedding", { ...config.embedding, model: e.target.value })
                }
                placeholder={st("knowledge.embedModelPh")}
              />
            )}
            {embeddingModelOptions.length === 0 &&
            config.embedding.provider !== "ollama" ? (
              <p className="mt-1 text-[11px] text-text-faint">
                {st("knowledge.embedModelHint")}
              </p>
            ) : null}
          </Field>
          <Field label={st("knowledge.dimension")}>
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
                config.embedding.provider === "ollama" ? "http://localhost:11434" : st("knowledge.optional")
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
                        ? st("knowledge.ollamaKeyOptional")
                        : st("knowledge.onlineKeyPh")
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
                  title={st("knowledge.probeTitle")}
                >
                  {testStatus === "checking"
                    ? st("knowledge.checking")
                    : testStatus === "ok"
                    ? st("knowledge.valid")
                    : testStatus === "fail"
                    ? st("knowledge.failedMark")
                    : st("knowledge.check")}
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
            {st("knowledge.embedChangeHint")}
          </p>
        ) : null}
      </Panel>

      <Panel title={st("knowledge.chunkStrategy")}>
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
                  {chunkStrategyLabel(s.id)}
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

      <Panel title={st("knowledge.fileFilter")}>
        <div className="space-y-4">
          <Field label={st("knowledge.extensions")}>
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
                title={st("knowledge.restoreExtTitle")}
              >
                {st("knowledge.restoreDefault")}
              </button>
            </div>
          </Field>
          <ParserCapabilitySection parserStatus={parserStatus} />
          <Field label={st("knowledge.maxFileMb")}>
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
        </div>
      </Panel>

      <Panel title={st("knowledge.retrieval")}>
        <p className={SETTINGS_INTRO_CLASS}>
          {st("knowledge.retrievalHint")}
        </p>
        <div className="space-y-4">
          <Field label={st("knowledge.defaultTopK")}>
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
          <Field label={st("knowledge.retrievalChannel")}>
            <select
              className={`w-full ${KB_FIELD_BASE}`}
              value={config.retrieval.retrieval_mode ?? "vector"}
              onChange={(e) =>
                patch("retrieval", {
                  ...config.retrieval,
                  retrieval_mode: e.target.value as KBConfig["retrieval"]["retrieval_mode"],
                })
              }
            >
              {RETRIEVAL_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {retrievalModeLabel(m.id)}
                </option>
              ))}
            </select>
          </Field>
          {(config.retrieval.retrieval_mode === "hybrid" ||
            config.retrieval.retrieval_mode === "hybrid_graph") && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="RRF k">
                <input
                  type="number"
                  className={`w-full ${KB_FIELD_BASE}`}
                  min={1}
                  value={config.retrieval.rrf_k ?? 60}
                  onChange={(e) =>
                    patch("retrieval", {
                      ...config.retrieval,
                      rrf_k: Math.max(1, Number(e.target.value) || 60),
                    })
                  }
                />
              </Field>
              <Field label={st("knowledge.vectorWeight")}>
                <input
                  type="number"
                  step="0.1"
                  className={`w-full ${KB_FIELD_BASE}`}
                  min={0}
                  value={config.retrieval.vector_weight ?? 1}
                  onChange={(e) =>
                    patch("retrieval", {
                      ...config.retrieval,
                      vector_weight: Math.max(0, Number(e.target.value) || 1),
                    })
                  }
                />
              </Field>
              <Field label={st("knowledge.bm25Weight")}>
                <input
                  type="number"
                  step="0.1"
                  className={`w-full ${KB_FIELD_BASE}`}
                  min={0}
                  value={config.retrieval.bm25_weight ?? 1}
                  onChange={(e) =>
                    patch("retrieval", {
                      ...config.retrieval,
                      bm25_weight: Math.max(0, Number(e.target.value) || 1),
                    })
                  }
                />
              </Field>
            </div>
          )}
          <p className="text-[11px] leading-snug text-text-faint">
            {st("knowledge.smartHint")}
          </p>
        </div>
      </Panel>

      <Panel title={st("knowledge.enhanced")}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <KbCapabilityTile
            phase={st("knowledge.phaseIngest")}
            icon={BookOpen}
            title={st("knowledge.wikiCompile")}
            description={st("knowledge.wikiCompileDesc")}
            enabled={config.wiki_compiler?.enabled ?? false}
            onChange={(enabled) =>
              setConfig({
                ...config,
                wiki_compiler: { enabled },
              })
            }
          />
          <KbCapabilityTile
            phase={st("knowledge.phaseAnswer")}
            icon={Sparkles}
            title={st("knowledge.synthesis")}
            description={st("knowledge.synthesisDesc")}
            enabled={config.synthesis?.enabled ?? false}
            onChange={(enabled) =>
              setConfig({
                ...config,
                synthesis: { enabled },
              })
            }
          />
        </div>
      </Panel>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {dirty ? (
          <span className="text-xs text-amber-500">{st("knowledge.unsaved")}</span>
        ) : null}
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-subtle transition hover:bg-surface-hover hover:text-text-primary"
          onClick={reset}
        >
          <RotateCcw className="h-3.5 w-3.5" /> {st("knowledge.resetDefaultBtn")}
        </button>
      </div>
    </div>
  );
}

function KbCapabilityTile({
  phase,
  icon: Icon,
  title,
  description,
  enabled,
  onChange,
}: {
  phase: string;
  icon: LucideIcon;
  title: string;
  description: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <div
      className={`flex h-full flex-col rounded-lg border px-3 py-3 transition ${
        enabled
          ? "border-[var(--settings-accent-border-strong)] bg-[var(--settings-accent-row-bg)] ring-1 ring-[var(--settings-accent-badge-bg)]"
          : "border-border bg-surface-panel/60 hover:border-text-subtle/40 hover:bg-surface-hover"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition ${
              enabled
                ? "bg-[var(--settings-accent-badge-bg)] text-[var(--settings-accent-fg)]"
                : "bg-surface-hover text-text-muted"
            }`}
          >
            <Icon className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-sm font-medium text-text-primary">{title}</span>
              <span className="rounded-full bg-surface-hover px-1.5 py-0.5 text-[10px] text-text-faint">
                {phase}
              </span>
            </div>
            <p className="mt-1 text-xs leading-snug text-text-muted">{description}</p>
          </div>
        </div>
        <SettingsSwitch checked={enabled} onChange={onChange} size="sm" aria-label={title} />
      </div>
    </div>
  );
}

function ParserCapabilitySection({ parserStatus }: { parserStatus: ParserStatus | null }) {
  const liteparseOk = parserStatus?.liteparse?.available === true;
  const liteparseLoading = parserStatus == null;
  const libreofficeOk = parserStatus?.libreoffice?.available === true;
  const showLibreoffice = parserStatus?.libreoffice != null;

  return (
    <div className="space-y-2">
      <div className={SETTINGS_LABEL_CLASS}>{st("knowledge.parseAbility")}</div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface-panel/60">
        <ParserCapabilityRow
          title={st("knowledge.builtinParser")}
          state="ok"
          statusLabel={st("knowledge.ready")}
          detail={st("knowledge.builtinDetail")}
        />
        <ParserCapabilityDivider />
        <ParserCapabilityRow
          title="LiteParse"
          state={liteparseLoading ? "loading" : liteparseOk ? "ok" : "warn"}
          statusLabel={
            liteparseLoading
              ? st("knowledge.detecting")
              : liteparseOk
                ? parserStatus?.liteparse?.version
                  ? st("knowledge.installedVer", { version: parserStatus.liteparse.version })
                  : st("knowledge.installed")
                : st("knowledge.notInstalled")
          }
          detail={
            liteparseLoading ? (
              st("knowledge.liteparseDetecting")
            ) : liteparseOk ? (
              st("knowledge.liteparseOk")
            ) : (
              <>
                {st("knowledge.liteparseMissing")}
                <code className="ml-1 rounded bg-surface-hover px-1 py-0.5 text-[11px] text-text-primary">
                  {parserStatus?.install_hint || "npm i -g @llamaindex/liteparse"}
                </code>
              </>
            )
          }
        />
        {showLibreoffice ? (
          <>
            <ParserCapabilityDivider />
            <ParserCapabilityRow
              title="LibreOffice"
              state={libreofficeOk ? "ok" : "warn"}
              statusLabel={libreofficeOk ? st("knowledge.installed") : st("knowledge.notInstalled")}
              detail={
                libreofficeOk ? (
                  st("knowledge.loHintOk")
                ) : (
                  <>
                    {st("knowledge.loHintMissing")}
                    <code className="ml-1 rounded bg-surface-hover px-1 py-0.5 text-[11px] text-text-primary">
                      brew install --cask libreoffice
                    </code>
                  </>
                )
              }
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function ParserCapabilityDivider() {
  return <div className="h-px bg-[var(--border-muted)]" aria-hidden="true" />;
}

function ParserCapabilityRow({
  title,
  state,
  statusLabel,
  detail,
}: {
  title: string;
  state: "ok" | "warn" | "loading";
  statusLabel: string;
  detail: React.ReactNode;
}) {
  const statusClass =
    state === "ok"
      ? "bg-[var(--brain-scope-enabled-bg)] text-[var(--brain-scope-enabled-fg)]"
      : state === "warn"
        ? "bg-amber-500/15 text-[var(--status-warning)]"
        : "bg-surface-hover text-text-muted";

  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${statusClass}`}
        aria-hidden="true"
      >
        {state === "ok" ? (
          <Check className="h-3 w-3" strokeWidth={2.5} />
        ) : state === "warn" ? (
          <AlertTriangle className="h-3 w-3" strokeWidth={2.5} />
        ) : (
          <Loader2 className="h-3 w-3 animate-spin" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-xs font-medium text-text-primary">{title}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusClass}`}>
            {statusLabel}
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">{detail}</p>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${SETTINGS_LABEL_CLASS}`}>
      <span className="mb-1 inline-block">{label}</span>
      {hint ? (
        <p className="mb-1.5 text-[11px] leading-relaxed text-text-muted">{hint}</p>
      ) : null}
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
        aria-label={visible ? st("knowledge.hideKey") : st("knowledge.showKey")}
        className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-text-faint transition hover:bg-surface-hover hover:text-text-subtle"
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
