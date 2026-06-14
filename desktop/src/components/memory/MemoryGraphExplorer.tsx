import { PanelRightClose, RefreshCw, Search, Share2 } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useAppStore } from "../../store";
import {
  listProviderVisibleModelIds,
  type ProviderCatalogEntry,
} from "../../utils/model-options";
import { MemoryGraphCanvas } from "./MemoryGraphCanvas";
import { MemoryGraphDetail } from "./MemoryGraphDetail";
import { WorkspaceMemoryList } from "./WorkspaceMemoryList";
import {
  deleteMemoryGraphEpisode,
  deriveGroupId,
  fetchMemoryGraphConfig,
  fetchMemoryGraphEpisodes,
  fetchMemoryGraphOverview,
  fetchMemoryGraphStatus,
  formatMemoryGraphFetchError,
  isMemoryGraphEnabled,
  searchMemoryGraph,
  updateMemoryGraphConfig,
} from "./memory-graph-api";
import type {
  GraphEpisodeDTO,
  GraphNodeDTO,
  GraphViewDTO,
  MemoryGraphScope,
  MemoryGraphStatus,
} from "./memory-graph-types";

function MiniSwitch({
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
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={`relative h-5 w-9 shrink-0 rounded-full transition focus:outline-none disabled:opacity-40 ${
        checked ? "bg-[rgb(var(--theme-color-rgb,16,185,129))]" : "bg-surface-hover"
      }`}
    >
      <span
        className={`pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

type Props = {
  apiBase: string;
  apiToken: string;
  avatarId?: string | null;
  sessionId?: string;
  layout?: "dashboard" | "sidebar";
  showConfig?: boolean;
  initialScope?: MemoryGraphScope;
  /** 侧栏模式展示当前分区名称（如分身名、群聊名） */
  contextTitle?: string;
  /** 可选 provider 列表，用于「记忆构建模型」选择器（来自 SettingsPanel） */
  providerOptions?: string[];
  onClose?: () => void;
};

const EMPTY_GRAPH: GraphViewDTO = {
  nodes: [],
  edges: [],
  meta: { groupId: "", generatedAt: "", truncated: false },
};

function scopeLabel(scope: MemoryGraphScope): string {
  if (scope === "avatar") return "数字分身";
  if (scope === "group") return "群聊";
  if (scope === "user") return "用户";
  return "元智能体";
}

const JOB_STAGE_LABELS: Record<string, string> = {
  queued: "排队",
  preparing: "准备引擎",
  formatting: "整理对话",
  extracting: "抽取实体与关系",
  extracting_entities: "抽取实体",
  extracting_edges: "抽取关系",
  embedding: "向量化",
  linking: "关联写入",
  updating: "更新图谱",
  finalizing: "收尾",
};

function shouldShowBuildError(st: MemoryGraphStatus | null): boolean {
  const err = st?.last_error?.trim();
  if (!err) return false;
  const errAt = st?.last_error_at ? Date.parse(st.last_error_at) : Number.NaN;
  const okAt = st?.last_success_at ? Date.parse(st.last_success_at) : Number.NaN;
  if (Number.isFinite(errAt) && Number.isFinite(okAt)) {
    return errAt > okAt;
  }
  return true;
}

function resolveMemoryBuildUi(st: MemoryGraphStatus | null): {
  hint: string | null;
  progress: number | null;
} {
  if (!st) return { hint: null, progress: null };
  const pending = st.pending_jobs ?? 0;
  const active = Boolean(st.job_active);
  const rawProgress = st.job_progress;
  const progress =
    typeof rawProgress === "number" && rawProgress > 0
      ? Math.min(100, Math.max(0, Math.round(rawProgress)))
      : null;
  if (!active && pending <= 0 && (progress == null || progress <= 0)) {
    return { hint: null, progress: null };
  }
  const stageKey = String(st.job_stage || "").trim();
  const stageLabel = stageKey ? JOB_STAGE_LABELS[stageKey] || stageKey : null;
  let hint = "正在构建记忆…";
  if (pending > 0) hint += `（队列 ${pending}）`;
  if (stageLabel) {
    hint += pending > 0 ? ` · ${stageLabel}` : `（${stageLabel}）`;
  }
  return { hint, progress };
}

import { Panel } from "../ds/Panel";

/** 与设置页 Panel / 知识库卡片一致的边线语义 */
const MG_PANEL = "rounded-lg border border-border bg-surface-card";
const MG_DIVIDER = "h-px shrink-0 bg-[var(--border-muted)]";
const MG_FIELD =
  "rounded-md border border-border bg-surface-panel px-2 py-1.5 text-xs text-text-primary outline-none focus:border-[var(--settings-accent-focus)]";

function buildProviderModelOptions(
  providers: Record<string, ProviderCatalogEntry>,
  providerId: string,
  currentModel: string,
): string[] {
  const entry = providerId.trim() ? providers[providerId.trim()] : undefined;
  const fromCatalog = entry ? listProviderVisibleModelIds(entry) : [];
  const set = new Set(fromCatalog);
  const cur = currentModel.trim();
  if (cur && !set.has(cur)) set.add(cur);
  return Array.from(set);
}

function StatRow({
  label,
  value,
  sub,
  accent = "rgba(99,102,241,0.9)",
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="relative px-3 py-2.5">
      <span
        className="absolute inset-y-2.5 left-0 w-[2px] rounded-full"
        style={{ background: accent }}
        aria-hidden
      />
      <div className="pl-2">
        <div className="text-[10px] uppercase tracking-[0.06em] text-text-faint">{label}</div>
        <div className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-text-strong">{value}</div>
        {sub ? <div className="mt-0.5 text-[10px] text-text-faint">{sub}</div> : null}
      </div>
    </div>
  );
}

function MemoryGraphExplorerInner({
  apiBase,
  apiToken,
  avatarId = null,
  sessionId = "",
  layout = "dashboard",
  showConfig = false,
  initialScope = "meta",
  contextTitle = "",
  providerOptions = [],
  onClose,
}: Props) {
  const scopeLocked = layout === "sidebar";
  const [scope, setScope] = useState<MemoryGraphScope>(initialScope);
  const [graph, setGraph] = useState<GraphViewDTO>(EMPTY_GRAPH);
  const [episodes, setEpisodes] = useState<GraphEpisodeDTO[]>([]);
  const [status, setStatus] = useState<MemoryGraphStatus | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const [buildProgress, setBuildProgress] = useState<number | null>(null);
  const [configMsg, setConfigMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [defaultScope, setDefaultScope] = useState<MemoryGraphScope>("meta");
  const [ingestAuto, setIngestAuto] = useState(true);
  const [llmProvider, setLlmProvider] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [embedProvider, setEmbedProvider] = useState("");
  const [embedModel, setEmbedModel] = useState("");
  const [defaultProvider, setDefaultProvider] = useState("");
  const providerCatalog = useAppStore((s) => s.settings.providers);

  const isDashboard = layout === "dashboard";
  const groupId = useMemo(
    () => deriveGroupId(scope, avatarId),
    [scope, avatarId],
  );

  const selectedNode: GraphNodeDTO | null = useMemo(
    () => graph.nodes.find((n) => n.id === selectedId) || null,
    [graph.nodes, selectedId],
  );

  const loadConfig = useCallback(async () => {
    if (!apiBase.trim() || !showConfig) return;
    try {
      const cfg = await fetchMemoryGraphConfig(apiBase, apiToken);
      setEnabled(Boolean(cfg.enabled));
      const sc = String(cfg.default_scope || "meta");
      const resolved: MemoryGraphScope =
        sc === "avatar" || sc === "group" ? sc : "meta";
      setDefaultScope(resolved);
      const ingest = cfg.ingest as { auto?: boolean } | undefined;
      setIngestAuto(ingest?.auto !== false);
      const llm = (cfg.llm as { provider?: string; model?: string } | undefined) || {};
      setLlmProvider(String(llm.provider || ""));
      setLlmModel(String(llm.model || ""));
      const emb = (cfg.embedder as { provider?: string; model?: string } | undefined) || {};
      setEmbedProvider(String(emb.provider || ""));
      setEmbedModel(String(emb.model || ""));
    } catch {
      // ignore
    }
  }, [apiBase, apiToken, showConfig]);

  const reload = useCallback(async () => {
    if (!apiBase.trim()) {
      setError("后端未连接");
      return;
    }
    setLoading(true);
    setError(null);
    if (scope === "user") {
      setDisabled(false);
      setStatusHint(null);
      setBuildProgress(null);
      setGraph(EMPTY_GRAPH);
      setEpisodes([]);
      setLoading(false);
      return;
    }
    try {
      const st = await fetchMemoryGraphStatus(apiBase, apiToken);
      setStatus(st);
      if (st.models?.default_provider) setDefaultProvider(st.models.default_provider);
      if (!isMemoryGraphEnabled(st)) {
        setDisabled(true);
        setStatusHint("记忆图谱未启用。在上方配置中开启，或编辑 ~/.agenticx/config.yaml。");
        setBuildProgress(null);
        setGraph(EMPTY_GRAPH);
        setEpisodes([]);
        return;
      }
      setDisabled(false);
      if (!groupId) {
        setStatusHint(
          scope === "avatar"
            ? "当前窗格不是分身会话（请在分身窗格查看其记忆）"
            : scope === "group"
              ? "当前窗格不是群聊会话（请在群聊窗格查看其群体记忆）"
              : null,
        );
        setBuildProgress(null);
        setGraph(EMPTY_GRAPH);
        setEpisodes([]);
        return;
      }
      if (st.graphiti_installed === false) {
        const hint = st.install_hint?.trim();
        setStatusHint(
          hint
            ? `graphiti-core 未安装于当前后端（${st.python_executable || "agx serve"}）。请执行：${hint}`
            : "graphiti-core 未安装于当前 agx serve 环境",
        );
        setBuildProgress(null);
        setGraph(EMPTY_GRAPH);
        setEpisodes([]);
        return;
      } else if (shouldShowBuildError(st)) {
        setStatusHint(`构建异常：${st.last_error}`);
        setBuildProgress(null);
      } else {
        const buildUi = resolveMemoryBuildUi(st);
        if (buildUi.hint) {
          setStatusHint(buildUi.hint);
          setBuildProgress(buildUi.progress);
        } else {
          setStatusHint(null);
          setBuildProgress(null);
        }
      }
      const overview = await fetchMemoryGraphOverview(apiBase, apiToken, {
        scope,
        avatarId,
        sessionId,
        groupId,
      });
      setGraph(overview);
      const eps = await fetchMemoryGraphEpisodes(apiBase, apiToken, groupId, 30, {
        scope,
        avatarId,
        sessionId,
      });
      setEpisodes(eps);
    } catch (e) {
      const msg = formatMemoryGraphFetchError(e, "加载记忆图谱失败");
      if (msg.includes("memory_graph_disabled")) {
        setDisabled(true);
        setStatusHint("记忆图谱未启用");
        setBuildProgress(null);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [apiBase, apiToken, groupId, avatarId, sessionId, scope]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    setScope(initialScope);
  }, [initialScope]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const pending = status?.pending_jobs ?? 0;
    const progress = status?.job_progress ?? 0;
    if (!apiBase.trim() || (pending <= 0 && progress <= 0)) return;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const st = await fetchMemoryGraphStatus(apiBase, apiToken);
          setStatus(st);
          if (shouldShowBuildError(st)) {
            setStatusHint(`构建异常：${st.last_error}`);
            setBuildProgress(null);
            return;
          }
          const buildUi = resolveMemoryBuildUi(st);
          if (buildUi.hint) {
            setStatusHint(buildUi.hint);
            setBuildProgress(buildUi.progress);
          } else {
            setStatusHint(null);
            setBuildProgress(null);
            void reload();
          }
        } catch {
          // ignore poll errors
        }
      })();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [apiBase, apiToken, reload, status?.job_progress, status?.pending_jobs]);

  const onSearch = async () => {
    if (scope === "user") {
      void reload();
      return;
    }
    if (!apiBase.trim() || !query.trim()) {
      void reload();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await searchMemoryGraph(
        apiBase,
        apiToken,
        groupId,
        query.trim(),
        sessionId,
        avatarId,
      );
      setGraph(result);
    } catch (e) {
      setError(formatMemoryGraphFetchError(e, "搜索失败"));
    } finally {
      setLoading(false);
    }
  };

  const onDeleteEpisode = async (episodeId: string) => {
    if (!apiBase.trim()) return;
    try {
      await deleteMemoryGraphEpisode(
        apiBase,
        apiToken,
        episodeId,
        groupId,
        sessionId,
        avatarId,
      );
      await reload();
      setSelectedId(null);
    } catch (e) {
      setError(formatMemoryGraphFetchError(e, "删除 episode 失败"));
    }
  };

  const saveConfig = async (patch: {
    enabled?: boolean;
    default_scope?: MemoryGraphScope;
    ingest_auto?: boolean;
    llm?: { provider: string; model: string };
    embedder?: { provider: string; model: string };
  }) => {
    if (!apiBase.trim()) return;
    const nextEnabled = patch.enabled ?? enabled;
    const nextScope = patch.default_scope ?? defaultScope;
    const nextAuto = patch.ingest_auto ?? ingestAuto;
    setEnabled(nextEnabled);
    setDefaultScope(nextScope);
    setIngestAuto(nextAuto);
    setSaving(true);
    setConfigMsg("");
    try {
      const current = await fetchMemoryGraphConfig(apiBase, apiToken);
      const ingest = (current.ingest as Record<string, unknown> | undefined) || {};
      const body: Record<string, unknown> = {
        ...current,
        enabled: nextEnabled,
        default_scope: nextScope,
        ingest: { ...ingest, auto: nextAuto },
      };
      if (patch.llm) body.llm = patch.llm;
      if (patch.embedder) body.embedder = patch.embedder;
      await updateMemoryGraphConfig(apiBase, apiToken, body);
      setConfigMsg("已保存");
      void reload();
    } catch (e) {
      setConfigMsg(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const saveModels = () =>
    void saveConfig({
      llm: { provider: llmProvider.trim(), model: llmModel.trim() },
      embedder: { provider: embedProvider.trim(), model: embedModel.trim() },
    });

  const providerSelectOptions = useMemo(() => {
    const set = new Set<string>(providerOptions);
    if (llmProvider) set.add(llmProvider);
    if (embedProvider) set.add(embedProvider);
    return Array.from(set);
  }, [providerOptions, llmProvider, embedProvider]);

  const llmModelOptions = useMemo(
    () => buildProviderModelOptions(providerCatalog, llmProvider, llmModel),
    [providerCatalog, llmProvider, llmModel],
  );

  const embedModelOptions = useMemo(
    () => buildProviderModelOptions(providerCatalog, embedProvider, embedModel),
    [providerCatalog, embedProvider, embedModel],
  );

  const nodeCount = graph.meta.nodeCount ?? graph.nodes.length;
  const edgeCount = graph.meta.edgeCount ?? graph.edges.length;
  const entityCount = graph.nodes.filter((n) => n.kind === "entity").length;
  const episodeCount = graph.nodes.filter((n) => n.kind === "episode").length;

  const toolbar = (
    <div
      className={`flex flex-wrap items-center gap-2 ${
        isDashboard ? "px-0.5" : "border-b border-[var(--border-muted)] px-3 py-2"
      }`}
    >
      {!isDashboard ? (
        <div className="mr-auto flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2 text-sm font-medium text-text-strong">
            <Share2 className="h-4 w-4 shrink-0" strokeWidth={1.8} />
            <span className="truncate">记忆图谱</span>
          </div>
          {scopeLocked ? (
            <div className="truncate pl-6 text-[10px] text-text-faint">
              {contextTitle.trim() || scopeLabel(scope)}
            </div>
          ) : null}
        </div>
      ) : null}
      {scopeLocked ? (
        <span className="shrink-0 rounded-md border border-border bg-surface-card px-2 py-1 text-[11px] text-text-muted">
          {scopeLabel(scope)}
        </span>
      ) : (
        <div className="flex overflow-hidden rounded-md border border-border text-[11px]">
          {(["user", "meta", "avatar", "group"] as MemoryGraphScope[]).map((s) => (
            <button
              key={s}
              type="button"
              className={`px-2.5 py-1 transition ${
                scope === s
                  ? "bg-[var(--ui-btn-primary-bg)] font-medium text-[var(--ui-btn-primary-text)]"
                  : "bg-transparent text-text-muted hover:bg-surface-hover hover:text-text-primary"
              }`}
              onClick={() => setScope(s)}
            >
              {scopeLabel(s)}
            </button>
          ))}
        </div>
      )}
      <div className="flex min-w-[200px] flex-1 items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onSearch();
            }}
            placeholder="搜索实体、关系…"
            className={`w-full pl-8 pr-2 ${MG_FIELD}`}
          />
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition hover:opacity-90"
          style={{ background: "var(--ui-btn-primary-bg)", color: "var(--ui-btn-primary-text)" }}
          onClick={() => void onSearch()}
        >
          搜索
        </button>
      </div>
      <button
        type="button"
        className="agx-topbar-btn !px-[5px]"
        onClick={() => void reload()}
        title="刷新图谱"
      >
        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
      </button>
      {onClose ? (
        <button type="button" className="agx-topbar-btn !px-[5px]" onClick={onClose} title="收起">
          <PanelRightClose className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );

  const isErrorHint = Boolean(statusHint?.startsWith("构建异常"));

  const alerts = (
    <>
      {statusHint ? (
        <div
          className={`rounded-md px-3 py-2 text-[11px] leading-relaxed ${
            isErrorHint
              ? "bg-status-error/10 text-status-error"
              : "bg-status-warning/10 text-status-warning"
          }`}
        >
          {buildProgress != null ? (
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 break-words">{statusHint}</span>
              <span className="shrink-0 tabular-nums text-[10px] opacity-90">{buildProgress}%</span>
            </div>
          ) : (
            <div className="max-h-36 min-w-0 overflow-y-auto break-words [overflow-wrap:anywhere] whitespace-pre-wrap">
              {statusHint}
            </div>
          )}
          {buildProgress != null ? (
            <div
              className="mt-1.5 h-1 overflow-hidden rounded-full bg-status-warning/15"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={buildProgress}
            >
              <div
                className="h-full rounded-full bg-status-warning transition-[width] duration-500 ease-out"
                style={{ width: `${buildProgress}%` }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div className="max-h-36 overflow-y-auto rounded-md bg-status-error/10 px-3 py-2 text-[11px] leading-relaxed text-status-error break-words [overflow-wrap:anywhere] whitespace-pre-wrap">
          {error}
        </div>
      ) : null}
    </>
  );

  const canvasArea = (
    <div
      className={`relative min-h-0 overflow-hidden rounded-lg border border-border bg-surface-panel/60 bg-[radial-gradient(circle_at_50%_45%,rgba(99,102,241,0.05),transparent_60%)] ${
        isDashboard ? "h-full" : "min-h-[200px] flex-1"
      }`}
    >
      {disabled ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-surface-card">
            <Share2 className="h-7 w-7 text-text-faint/50" strokeWidth={1.2} />
          </div>
          <p className="text-sm font-medium text-text-subtle">记忆图谱未启用</p>
          <p className="max-w-xs text-xs leading-relaxed text-text-faint">
            开启后，对话中的实体与关系会以力导向图呈现；与文本记忆并行，不互相替换。
          </p>
        </div>
      ) : graph.nodes.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="h-20 w-20 rounded-full border border-dashed border-[var(--border-muted)] opacity-60" />
          <p className="text-sm font-medium text-text-subtle">{loading ? "加载图谱…" : "暂无节点"}</p>
          <p className="max-w-xs text-xs leading-relaxed text-text-faint">
            {status?.graphiti_installed === false
              ? "请先安装 graphiti-core，再完成几轮对话"
              : "完成几轮含人名/关系的对话后点击刷新；ingest 在后台异步执行，可稍等几秒。"}
          </p>
        </div>
      ) : (
        <MemoryGraphCanvas
          nodes={graph.nodes}
          edges={graph.edges}
          selectedId={selectedId}
          onSelect={setSelectedId}
          className="absolute inset-0 h-full w-full"
        />
      )}
      {graph.meta.truncated ? (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-surface-base/90 px-2 py-0.5 text-[10px] text-text-faint shadow-[inset_0_0_0_1px_var(--border-muted)]">
          已截断展示 · 全量 {nodeCount} 节点
        </div>
      ) : null}
    </div>
  );

  const legend = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-faint">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-[#60a5fa]" /> 实体
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-[#94a3b8]" /> Episode
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-[#a78bfa]" /> 社区
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-px w-4 border-t border-dashed border-text-faint/70" /> 已失效关系
      </span>
    </div>
  );

  const leftRail = (
    <div className={`flex w-[160px] shrink-0 flex-col overflow-hidden ${MG_PANEL}`}>
      <StatRow
        label="节点"
        value={nodeCount}
        sub={`实体 ${entityCount} · 片段 ${episodeCount}`}
        accent="rgba(96,165,250,0.9)"
      />
      <div className={MG_DIVIDER} />
      <StatRow label="关系" value={edgeCount} accent="rgba(167,139,250,0.9)" />
      <div className={MG_DIVIDER} />
      <StatRow label="Episodes" value={episodes.length} sub="时间轴条目" accent="rgba(148,163,184,0.9)" />
      <div className={MG_DIVIDER} />
      <StatRow
        label="队列"
        value={status?.pending_jobs ?? 0}
        sub={status?.graphiti_installed === false ? "未安装引擎" : "待 ingest"}
        accent="rgba(245,158,11,0.9)"
      />
      <div className={MG_DIVIDER} />
      <div className="px-3 py-2.5 text-[10px]">
        <div className="text-[10px] uppercase tracking-[0.06em] text-text-faint">分区</div>
        <div className="mt-1 break-all font-mono text-text-subtle">{groupId}</div>
      </div>
    </div>
  );

  const rightRail = (
    <div className="flex w-[236px] shrink-0 flex-col gap-2 overflow-hidden">
      <MemoryGraphDetail node={selectedNode} edges={graph.edges} onDeleteEpisode={onDeleteEpisode} />
      <section className={`flex min-h-0 flex-1 flex-col overflow-hidden ${MG_PANEL}`}>
        <header className="border-b border-[var(--border-muted)] px-3 py-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-subtle">
            Episode 时间轴
          </h4>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {episodes.length === 0 ? (
            <div className="px-1.5 py-2 text-[10px] text-text-faint">暂无 episode</div>
          ) : (
            episodes.map((ep) => (
              <button
                key={ep.id}
                type="button"
                className={`mb-0.5 block w-full truncate rounded-md px-2 py-1.5 text-left text-[10px] transition ${
                  selectedId === ep.id
                    ? "bg-surface-hover text-text-strong"
                    : "text-text-subtle hover:bg-surface-hover"
                }`}
                onClick={() => setSelectedId(ep.id)}
                title={ep.preview}
              >
                {ep.referenceTime ? (
                  <span className="mr-1 text-text-faint">{ep.referenceTime.slice(5, 16)}</span>
                ) : null}
                {ep.preview || ep.name}
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );

  const configStrip = showConfig ? (
    <Panel title="记忆图谱设置" collapsible defaultCollapsed>
      <div className="space-y-0 text-sm text-text-subtle">
        <p className="pb-2 text-[11px] leading-relaxed text-text-faint">
          结构化时态记忆的可视化视图。文本检索仍走 WorkspaceMemoryStore，二者并行不替换。
        </p>
        <div className={MG_DIVIDER} />
        <div className="flex items-center justify-between gap-4 py-1">
          <div>
            <div>启用记忆图谱</div>
            <div className="mt-0.5 text-[11px] text-text-faint">默认关闭；开启后异步 ingest</div>
          </div>
          <MiniSwitch
            checked={enabled}
            disabled={saving}
            onChange={(next) => void saveConfig({ enabled: next })}
            aria-label="启用记忆图谱"
          />
        </div>
        <div className={MG_DIVIDER} />
        <div className="flex items-center justify-between gap-4 py-2">
          <div>默认展示范围</div>
          <select
            value={defaultScope}
            disabled={saving}
            onChange={(e) => void saveConfig({ default_scope: e.target.value as MemoryGraphScope })}
            className={MG_FIELD}
          >
            <option value="avatar">分身</option>
            <option value="meta">元智能体</option>
            <option value="group">群聊</option>
          </select>
        </div>
        <div className={MG_DIVIDER} />
        <div className="flex items-center justify-between gap-4 py-2">
          <div>自动 ingest</div>
          <MiniSwitch
            checked={ingestAuto}
            disabled={saving || !enabled}
            onChange={(next) => void saveConfig({ ingest_auto: next })}
            aria-label="自动 ingest"
          />
        </div>
        <div className={MG_DIVIDER} />
        <div className="space-y-2 py-2">
          <div>
            <div>记忆构建模型</div>
            <div className="mt-0.5 text-[11px] text-text-faint">
              实体/关系抽取用 LLM，向量化用 Embedder；留空则跟随全局默认 provider
              {defaultProvider ? `（当前默认：${defaultProvider}）` : ""}。
            </div>
            {status?.models ? (
              <div className="mt-1 text-[11px] text-text-muted">
                当前生效：抽取 {status.models.llm_provider}/{status.models.llm_model} · 向量化{" "}
                {status.models.embedder_provider}/{status.models.embedder_model}
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-[64px_1fr_1.2fr] items-center gap-2">
            <span className="text-[11px] text-text-faint">抽取 LLM</span>
            <select
              value={llmProvider}
              disabled={saving}
              onChange={(e) => {
                const next = e.target.value;
                setLlmProvider(next);
                const nextModels = buildProviderModelOptions(providerCatalog, next, "");
                if (llmModel.trim() && !nextModels.includes(llmModel.trim())) {
                  setLlmModel("");
                }
              }}
              className={MG_FIELD}
            >
              <option value="">默认 provider</option>
              {providerSelectOptions.map((p) => (
                <option key={`llm-${p}`} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              value={llmModel}
              disabled={saving || !llmProvider.trim()}
              onChange={(e) => setLlmModel(e.target.value)}
              className={MG_FIELD}
              title={
                llmProvider.trim()
                  ? undefined
                  : "请先选择 provider，或在「模型服务」中配置可见模型"
              }
            >
              <option value="">模型名（留空用默认）</option>
              {llmModelOptions.map((m) => (
                <option key={`llm-model-${m}`} value={m}>
                  {m}
                </option>
              ))}
              {llmProvider.trim() && llmModelOptions.length === 0 ? (
                <option disabled value="__no_models">
                  请先在「模型服务」添加可见模型
                </option>
              ) : null}
            </select>
          </div>
          <div className="grid grid-cols-[64px_1fr_1.2fr] items-center gap-2">
            <span className="text-[11px] text-text-faint">向量化</span>
            <select
              value={embedProvider}
              disabled={saving}
              onChange={(e) => {
                const next = e.target.value;
                setEmbedProvider(next);
                const nextModels = buildProviderModelOptions(providerCatalog, next, "");
                if (embedModel.trim() && !nextModels.includes(embedModel.trim())) {
                  setEmbedModel("");
                }
              }}
              className={MG_FIELD}
            >
              <option value="">默认 provider</option>
              {providerSelectOptions.map((p) => (
                <option key={`emb-${p}`} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              value={embedModel}
              disabled={saving || !embedProvider.trim()}
              onChange={(e) => setEmbedModel(e.target.value)}
              className={MG_FIELD}
              title={
                embedProvider.trim()
                  ? undefined
                  : "请先选择 provider，或在「模型服务」中配置可见模型"
              }
            >
              <option value="">如 text-embedding-3-small（留空用默认）</option>
              {embedModelOptions.map((m) => (
                <option key={`emb-model-${m}`} value={m}>
                  {m}
                </option>
              ))}
              {embedProvider.trim() && embedModelOptions.length === 0 ? (
                <option disabled value="__no_models">
                  请先在「模型服务」添加可见模型
                </option>
              ) : null}
            </select>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={saving}
              onClick={saveModels}
              className="rounded-md px-3 py-1.5 text-xs font-medium transition hover:opacity-90 disabled:opacity-50"
              style={{ background: "var(--ui-btn-primary-bg)", color: "var(--ui-btn-primary-text)" }}
            >
              保存模型设置
            </button>
          </div>
        </div>
        {configMsg ? (
          <>
            <div className={MG_DIVIDER} />
            <div className={`py-1 text-xs ${configMsg === "已保存" ? "text-text-muted" : "text-status-error"}`}>
              {configMsg}
            </div>
          </>
        ) : null}
      </div>
    </Panel>
  ) : null;

  const isUserScope = scope === "user";
  const userListArea = <WorkspaceMemoryList apiBase={apiBase} apiToken={apiToken} />;

  if (isDashboard) {
    return (
      <div className="flex flex-col gap-4">
        <div className="shrink-0 space-y-4">
          {configStrip}
          {toolbar}
          {alerts}
        </div>
        {isUserScope ? (
          <div>{userListArea}</div>
        ) : (
          <div className="flex min-h-[500px] flex-1 gap-3 overflow-hidden">
            {leftRail}
            <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden">
              <div className="min-h-0 flex-1">{canvasArea}</div>
              {legend}
            </div>
            {rightRail}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-base text-text-subtle">
      {toolbar}
      <div className="min-w-0 space-y-2 px-3 pt-2 empty:hidden">{alerts}</div>
      {isUserScope ? (
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-2">{userListArea}</div>
      ) : (
        <>
          <div className="min-h-0 flex-1 p-2">{canvasArea}</div>
          <div className="max-h-[42%] space-y-2 overflow-y-auto border-t border-border px-3 py-2">
            <MemoryGraphDetail node={selectedNode} edges={graph.edges} onDeleteEpisode={onDeleteEpisode} />
            {episodes.length > 0 ? (
              <div className="max-h-24 overflow-y-auto text-[10px]">
                <div className="mb-1 font-medium text-text-faint">Episode 时间轴</div>
                {episodes.map((ep) => (
                  <button
                    key={ep.id}
                    type="button"
                    className="mb-1 block w-full truncate rounded px-1 py-0.5 text-left hover:bg-surface-card"
                    onClick={() => setSelectedId(ep.id)}
                  >
                    {ep.preview || ep.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

export const MemoryGraphExplorer = memo(MemoryGraphExplorerInner);
