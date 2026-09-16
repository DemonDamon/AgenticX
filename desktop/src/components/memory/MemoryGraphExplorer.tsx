import { PanelRight, Pin, PinOff, RefreshCw, Search, Share2, Trash2 } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import {

  listProviderVisibleModelIds,
  type ProviderCatalogEntry,
} from "../../utils/model-options";
import { Button } from "../ds/Button";
import { Modal } from "../ds/Modal";
import { Panel } from "../ds/Panel";
import { SettingsDropdown } from "../ds/SettingsDropdown";
import { i18n } from "../../i18n/i18n";
import { MemoryGraphCanvas } from "./MemoryGraphCanvas";
import { MemoryGraphDetail } from "./MemoryGraphDetail";
import { WorkspaceMemoryList } from "./WorkspaceMemoryList";
import {
  bulkDeleteMemoryGraphEpisodes,
  deleteMemoryGraphEpisode,
  deriveGroupId,
  fetchMemoryGraphConfig,
  fetchMemoryGraphEpisodes,
  fetchMemoryGraphOverview,
  fetchMemoryGraphStatus,
  formatMemoryGraphFetchError,
  formatMemoryGraphActionError,
  humanizeMemoryGraphError,
  isLikelyGraphCorruptionError,
  isMemoryGraphEnabled,
  repairMemoryGraph,
  runMemoryGraphRetention,
  searchMemoryGraph,
  setEpisodePin,
  updateMemoryGraphConfig,
} from "./memory-graph-api";
import type {
  GraphEpisodeDTO,
  GraphNodeDTO,
  GraphViewDTO,
  MemoryGraphScope,
  MemoryGraphStatus,
} from "./memory-graph-types";

function st(key: string, opts?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: "settings", ...(opts ?? {}) }));
}

type EpisodeTimeFilter = "all" | "7d" | "30d" | "older30d";

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
        className={`pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full shadow-sm transition-transform ${
          checked ? "bg-[var(--theme-color-text)]" : "bg-white"
        } ${checked ? "translate-x-4" : "translate-x-0"}`}
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
  if (scope === "avatar") return st("memoryGraph.scopeAvatarLong");
  if (scope === "group") return st("memoryGraph.scopeGroupLong");
  return st("memoryGraph.scopeMetaLong");
}

function jobStageLabel(stageKey: string): string {
  const keys: Record<string, string> = {
    queued: "memoryGraph.stageQueued",
    preparing: "memoryGraph.stagePreparing",
    formatting: "memoryGraph.stageFormatting",
    extracting: "memoryGraph.stageExtracting",
    extracting_entities: "memoryGraph.stageEntities",
    extracting_edges: "memoryGraph.stageEdges",
    embedding: "memoryGraph.stageEmbedding",
    linking: "memoryGraph.stageLinking",
    updating: "memoryGraph.stageUpdating",
    finalizing: "memoryGraph.stageFinalizing",
  };
  const key = keys[stageKey];
  return key ? st(key) : stageKey;
}

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
  const stageLabel = stageKey ? jobStageLabel(stageKey) || stageKey : null;
  let hint = i18n.t("memoryGraph.building", { ns: "settings" }) as string;
  if (pending > 0) hint += st("memoryGraph.queuePending", { count: pending });
  if (stageLabel) {
    hint += pending > 0 ? ` · ${stageLabel}` : `（${stageLabel}）`;
  }
  return { hint, progress };
}

/** 与设置页 Panel / 知识库卡片一致的边线语义 */
const MG_PANEL = "rounded-lg border border-border bg-surface-card";
const MG_DIVIDER = "h-px shrink-0 bg-[var(--border-muted)]";
const MG_FIELD =
  "rounded-md border border-border bg-surface-panel px-2 py-1.5 text-xs text-text-primary outline-none focus:border-[var(--settings-accent-focus)]";
/** 工具栏行内控件统一高度，与 MG_FIELD 视觉对齐 */
const MG_TOOLBAR_CTRL =
  "h-8 rounded-md border border-border bg-surface-panel text-xs text-text-primary outline-none focus:border-[var(--settings-accent-focus)]";

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

function StatChip({
  label,
  value,
  sub,
  accent = "rgba(99,102,241,0.9)",
  className = "",
  mono = false,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  className?: string;
  mono?: boolean;
}) {
  return (
    <div className={`relative min-w-0 flex-1 px-3 pb-2 pt-2.5 ${className}`}>
      <span
        className="absolute inset-x-3 top-0 h-[2px] rounded-full"
        style={{ background: accent }}
        aria-hidden
      />
      <div>
        <div className="text-[10px] tracking-[0.06em] text-text-faint">{label}</div>
        <div
          className={`mt-0.5 tabular-nums leading-none text-text-strong ${
            mono ? "break-all font-mono text-[11px] font-normal leading-snug" : "text-base font-semibold"
          }`}
        >
          {value}
        </div>
        {sub ? <div className="mt-0.5 truncate text-[10px] text-text-faint">{sub}</div> : null}
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
  const { t } = useTranslation("workspace");
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
  const [statusHintIsError, setStatusHintIsError] = useState(false);
  const autoRecoverAttemptedRef = useRef(false);
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
  const [retentionEnabled, setRetentionEnabled] = useState(false);
  const [retentionMaxEpisodes, setRetentionMaxEpisodes] = useState(200);
  const [retentionMaxAgeDays, setRetentionMaxAgeDays] = useState(90);
  const [retentionOnIngest, setRetentionOnIngest] = useState(true);
  const [episodeSelectMode, setEpisodeSelectMode] = useState(false);
  const [selectedEpisodeIds, setSelectedEpisodeIds] = useState<Set<string>>(() => new Set());
  const [episodeTimeFilter, setEpisodeTimeFilter] = useState<EpisodeTimeFilter>("all");
  const [pendingBulkDelete, setPendingBulkDelete] = useState<{
    ids: string[];
    pinnedSkipped: number;
  } | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const bulkDeletingRef = useRef(false);
  const [pendingRetentionRun, setPendingRetentionRun] = useState<number | null>(null);
  const providerCatalog = useAppStore((s) => s.settings.providers);
  const setApiBase = useAppStore((s) => s.setApiBase);
  const avatarsList = useAppStore((s) => s.avatars);
  const groupsList = useAppStore((s) => s.groups);

  const isDashboard = layout === "dashboard";

  // Dashboard 模式可自由切换具体分身 / 群聊查看其记忆；sidebar 模式锁定当前窗格主体。
  const [selectedSubjectId, setSelectedSubjectId] = useState("");

  const effectiveAvatarId = useMemo(() => {
    if (scopeLocked) return avatarId;
    if (scope === "meta") return null;
    const sid = selectedSubjectId.trim();
    if (!sid) return null;
    return scope === "group" ? `group:${sid}` : sid;
  }, [scopeLocked, avatarId, scope, selectedSubjectId]);

  const effectiveSessionId = scopeLocked ? sessionId : "";

  const groupId = useMemo(
    () => deriveGroupId(scope, effectiveAvatarId),
    [scope, effectiveAvatarId],
  );

  const subjectAvatarIdForWorkspace = useMemo(() => {
    const aid = (effectiveAvatarId || "").trim();
    if (scope === "meta") return null;
    if (scope === "group") {
      if (aid.startsWith("group:")) return aid;
      return aid ? `group:${aid}` : null;
    }
    if (!aid || aid.startsWith("group:")) return null;
    return aid;
  }, [scope, effectiveAvatarId]);

  const subjectOptions = useMemo(() => {
    const list = scope === "group" ? groupsList : avatarsList;
    return list.map((item) => ({ value: item.id, label: item.name }));
  }, [scope, groupsList, avatarsList]);

  const subjectDisplayLabel = useMemo(() => {
    const empty = scope === "group" ? st("memoryGraph.noGroups") : st("memoryGraph.noAvatars");
    if (!selectedSubjectId.trim()) return empty;
    return subjectOptions.find((o) => o.value === selectedSubjectId)?.label ?? selectedSubjectId;
  }, [scope, selectedSubjectId, subjectOptions]);

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
      const retention = (cfg.retention as {
        enabled?: boolean;
        max_episodes?: number;
        max_age_days?: number;
        on_ingest?: boolean;
      } | undefined) || {};
      setRetentionEnabled(Boolean(retention.enabled));
      setRetentionMaxEpisodes(Number(retention.max_episodes ?? 200) || 0);
      setRetentionMaxAgeDays(Number(retention.max_age_days ?? 90) || 0);
      setRetentionOnIngest(retention.on_ingest !== false);
    } catch {
      // ignore
    }
  }, [apiBase, apiToken, showConfig]);

  const reload = useCallback(async () => {
    if (!apiBase.trim()) {
      setError(st("memoryGraph.backendOff"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const graphStatus = await fetchMemoryGraphStatus(apiBase, apiToken);
      setStatus(graphStatus);
      if (graphStatus.models?.default_provider) setDefaultProvider(graphStatus.models.default_provider);
      if (!isMemoryGraphEnabled(graphStatus)) {
        setDisabled(true);
        setStatusHint(st("memoryGraph.disabledHintConfig"));
        setBuildProgress(null);
        setGraph(EMPTY_GRAPH);
        setEpisodes([]);
        return;
      }
      setDisabled(false);
      if (!groupId) {
        setStatusHint(
          scope === "avatar"
            ? st("memoryGraph.notAvatarPane")
            : scope === "group"
              ? st("memoryGraph.notGroupPane")
              : null,
        );
        setBuildProgress(null);
        setGraph(EMPTY_GRAPH);
        setEpisodes([]);
        return;
      }
      if (graphStatus.graphiti_installed === false) {
        const hint = graphStatus.install_hint?.trim();
        setStatusHint(
          hint
            ? st("memoryGraph.graphitiMissingAt", {
                exe: graphStatus.python_executable || "agx serve",
                hint,
              })
            : st("memoryGraph.graphitiMissing"),
        );
        setBuildProgress(null);
        setGraph(EMPTY_GRAPH);
        setEpisodes([]);
        return;
      } else if (shouldShowBuildError(graphStatus)) {
        const corrupt = isLikelyGraphCorruptionError(graphStatus.last_error);
        if (corrupt && !autoRecoverAttemptedRef.current) {
          autoRecoverAttemptedRef.current = true;
          setStatusHint(st("memoryGraph.repairing"));
          setStatusHintIsError(false);
          setBuildProgress(20);
          try {
            const repair = await repairMemoryGraph(apiBase, apiToken);
            const stAfter = await fetchMemoryGraphStatus(apiBase, apiToken);
            setStatus(stAfter);
            setBuildProgress(null);
            if (repair.recovered) {
              const action = String(repair.recovery?.action || "");
              setStatusHint(
                action === "restored_from_backup"
                  ? st("memoryGraph.restoredBackup")
                  : action === "recreated_empty"
                    ? st("memoryGraph.rebuiltEmpty")
                    : st("memoryGraph.repaired"),
              );
              setStatusHintIsError(false);
            } else if (shouldShowBuildError(stAfter)) {
              setStatusHint(humanizeMemoryGraphError(stAfter.last_error || ""));
              setStatusHintIsError(true);
            } else {
              setStatusHint(null);
              setStatusHintIsError(false);
            }
          } catch (repairErr) {
            setBuildProgress(null);
            setStatusHint(formatMemoryGraphFetchError(repairErr, st("memoryGraph.repairFailed")));
            setStatusHintIsError(true);
            setGraph(EMPTY_GRAPH);
            setEpisodes([]);
            return;
          }
        } else {
          setStatusHint(humanizeMemoryGraphError(graphStatus.last_error || ""));
          setStatusHintIsError(true);
          setBuildProgress(null);
        }
      } else {
        const buildUi = resolveMemoryBuildUi(graphStatus);
        if (buildUi.hint) {
          setStatusHint(buildUi.hint);
          setStatusHintIsError(false);
          setBuildProgress(buildUi.progress);
        } else {
          setStatusHint(null);
          setStatusHintIsError(false);
          setBuildProgress(null);
        }
      }
      const overview = await fetchMemoryGraphOverview(apiBase, apiToken, {
        scope,
        avatarId: effectiveAvatarId,
        sessionId: effectiveSessionId,
        groupId,
        limitNodes: 40,
        limitEdges: 60,
      });
      setGraph(overview);
      const eps = await fetchMemoryGraphEpisodes(apiBase, apiToken, groupId, 100, {
        scope,
        avatarId: effectiveAvatarId,
        sessionId: effectiveSessionId,
      });
      setEpisodes(eps);
      setStatusHint(null);
      setStatusHintIsError(false);
      setBuildProgress(null);
    } catch (e) {
      const msg = formatMemoryGraphFetchError(e, st("memoryGraph.loadFailed"));
      if (
        /无法连接 agx serve|failed to fetch|networkerror|load failed/i.test(msg) &&
        typeof window !== "undefined" &&
        window.agenticxDesktop?.getApiBase
      ) {
        try {
          const freshBase = await window.agenticxDesktop.getApiBase();
          if (freshBase && freshBase !== apiBase) {
            setStatusHint(st("memoryGraph.reconnecting"));
            setApiBase(freshBase);
            return;
          }
        } catch {
          // keep original error path
        }
      }
      if (msg.includes("memory_graph_disabled")) {
        setDisabled(true);
        setStatusHint(st("memoryGraph.disabledShort"));
        setBuildProgress(null);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [apiBase, apiToken, groupId, effectiveAvatarId, effectiveSessionId, scope, setApiBase]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    setScope(initialScope);
  }, [initialScope]);

  // Dashboard 模式切换主体类型时，自动选中该类型下第一个主体（避免空分区提示）。
  useEffect(() => {
    if (scopeLocked || scope === "meta") return;
    const list = scope === "group" ? groupsList : avatarsList;
    const ids = list.map((item) => item.id);
    if (!selectedSubjectId || !ids.includes(selectedSubjectId)) {
      setSelectedSubjectId(ids[0] ?? "");
    }
  }, [scope, scopeLocked, avatarsList, groupsList, selectedSubjectId]);

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
            setStatusHint(humanizeMemoryGraphError(st.last_error || ""));
            setStatusHintIsError(true);
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
        effectiveSessionId,
        effectiveAvatarId,
      );
      setGraph(result);
    } catch (e) {
      setError(formatMemoryGraphFetchError(e, st("memoryGraph.searchFailed")));
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
        effectiveSessionId,
        effectiveAvatarId,
      );
      await reload();
      setSelectedId(null);
    } catch (e) {
      setError(formatMemoryGraphActionError(e, st("memoryGraph.deleteEpisodeFailed")));
    }
  };

  const filteredEpisodes = useMemo(() => {
    const now = Date.now();
    return episodes.filter((ep) => {
      if (episodeTimeFilter === "all") return true;
      const ref = ep.referenceTime ? Date.parse(ep.referenceTime) : Number.NaN;
      if (!Number.isFinite(ref)) return false;
      const ageMs = now - ref;
      const dayMs = 86400000;
      if (episodeTimeFilter === "7d") return ageMs <= 7 * dayMs;
      if (episodeTimeFilter === "30d") return ageMs <= 30 * dayMs;
      if (episodeTimeFilter === "older30d") return ageMs > 30 * dayMs;
      return true;
    });
  }, [episodes, episodeTimeFilter]);

  const toggleEpisodeSelection = (episodeId: string) => {
    setSelectedEpisodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(episodeId)) next.delete(episodeId);
      else next.add(episodeId);
      return next;
    });
  };

  const requestBulkDelete = (ids: string[]) => {
    const deletable = ids.filter((id) => {
      const ep = episodes.find((e) => e.id === id);
      return ep && !ep.pinned;
    });
    const pinnedSkipped = ids.length - deletable.length;
    if (deletable.length === 0) {
      setError(st("memoryGraph.allPinned"));
      return;
    }
    setPendingBulkDelete({ ids: deletable, pinnedSkipped });
  };

  const confirmBulkDelete = async () => {
    if (bulkDeletingRef.current || !pendingBulkDelete || !apiBase.trim()) return;
    bulkDeletingRef.current = true;
    setBulkDeleting(true);
    setError(null);
    const ids = pendingBulkDelete.ids;
    try {
      const result = await bulkDeleteMemoryGraphEpisodes(
        apiBase,
        apiToken,
        groupId,
        ids,
        effectiveSessionId,
        effectiveAvatarId,
      );
      setPendingBulkDelete(null);
      setSelectedEpisodeIds(new Set());
      setEpisodeSelectMode(false);
      if (result.failed.length > 0) {
        const preview = result.failed
          .slice(0, 2)
          .map((f) => `${f.episode_uuid.slice(0, 8)}…：${f.error}`)
          .join("；");
        const suffix =
          result.failed.length > 2 ? st("memoryGraph.moreFailed", { count: result.failed.length - 2 }) : "";
        setError(
          result.deleted.length > 0
            ? st("memoryGraph.deletedPartial", {
                ok: result.deleted.length,
                fail: result.failed.length,
                preview,
                suffix,
              })
            : st("memoryGraph.deleteFailed", { preview, suffix }),
        );
      }
    } catch (e) {
      const msg = formatMemoryGraphActionError(e, st("memoryGraph.bulkDeleteFailed"));
      if (
        /无法连接 agx serve|failed to fetch|networkerror|load failed/i.test(msg) &&
        typeof window !== "undefined" &&
        window.agenticxDesktop?.getApiBase
      ) {
        try {
          const freshBase = await window.agenticxDesktop.getApiBase();
          if (freshBase && freshBase !== apiBase) {
            setApiBase(freshBase);
            setError(st("memoryGraph.retryAfterUrlChange"));
            return;
          }
        } catch {
          // fall through
        }
      }
      setError(
        /无法连接 agx serve|failed to fetch|networkerror|load failed/i.test(msg)
          ? st("memoryGraph.backendHung")
          : msg,
      );
      return;
    } finally {
      bulkDeletingRef.current = false;
      setBulkDeleting(false);
    }
    try {
      await reload();
    } catch (e) {
      setError(formatMemoryGraphActionError(e, st("memoryGraph.deletedRefreshFailed")));
    }
  };

  const onTogglePin = async (episodeId: string, pinned: boolean) => {
    if (!apiBase.trim()) return;
    try {
      await setEpisodePin(
        apiBase,
        apiToken,
        episodeId,
        groupId,
        pinned,
        effectiveSessionId,
        effectiveAvatarId,
      );
      await reload();
    } catch (e) {
      setError(formatMemoryGraphActionError(e, st("memoryGraph.pinFailed")));
    }
  };

  const previewRetentionCleanup = async () => {
    if (!apiBase.trim() || !groupId) return;
    try {
      const result = await runMemoryGraphRetention(
        apiBase,
        apiToken,
        groupId,
        true,
        effectiveSessionId,
        effectiveAvatarId,
      );
      setPendingRetentionRun(result.count ?? result.would_delete?.length ?? 0);
    } catch (e) {
      setError(formatMemoryGraphActionError(e, st("memoryGraph.previewCleanFailed")));
    }
  };

  const confirmRetentionCleanup = async () => {
    if (!apiBase.trim() || !groupId) return;
    try {
      await runMemoryGraphRetention(
        apiBase,
        apiToken,
        groupId,
        false,
        effectiveSessionId,
        effectiveAvatarId,
      );
      setPendingRetentionRun(null);
      await reload();
    } catch (e) {
      setError(formatMemoryGraphActionError(e, st("memoryGraph.runCleanFailed")));
    }
  };

  const saveConfig = async (patch: {
    enabled?: boolean;
    default_scope?: MemoryGraphScope;
    ingest_auto?: boolean;
    llm?: { provider: string; model: string };
    embedder?: { provider: string; model: string };
    retention?: {
      enabled?: boolean;
      max_episodes?: number;
      max_age_days?: number;
      on_ingest?: boolean;
    };
  }) => {
    if (!apiBase.trim()) return;
    const nextEnabled = patch.enabled ?? enabled;
    const nextScope = patch.default_scope ?? defaultScope;
    const nextAuto = patch.ingest_auto ?? ingestAuto;
    const nextRetentionEnabled = patch.retention?.enabled ?? retentionEnabled;
    const nextRetentionMaxEpisodes = patch.retention?.max_episodes ?? retentionMaxEpisodes;
    const nextRetentionMaxAgeDays = patch.retention?.max_age_days ?? retentionMaxAgeDays;
    const nextRetentionOnIngest = patch.retention?.on_ingest ?? retentionOnIngest;
    setEnabled(nextEnabled);
    setDefaultScope(nextScope);
    setIngestAuto(nextAuto);
    setRetentionEnabled(nextRetentionEnabled);
    setRetentionMaxEpisodes(nextRetentionMaxEpisodes);
    setRetentionMaxAgeDays(nextRetentionMaxAgeDays);
    setRetentionOnIngest(nextRetentionOnIngest);
    setSaving(true);
    setConfigMsg("");
    try {
      const current = await fetchMemoryGraphConfig(apiBase, apiToken);
      const ingest = (current.ingest as Record<string, unknown> | undefined) || {};
      const retention = (current.retention as Record<string, unknown> | undefined) || {};
      const body: Record<string, unknown> = {
        ...current,
        enabled: nextEnabled,
        default_scope: nextScope,
        ingest: { ...ingest, auto: nextAuto },
        retention: {
          ...retention,
          enabled: nextRetentionEnabled,
          max_episodes: nextRetentionMaxEpisodes,
          max_age_days: nextRetentionMaxAgeDays,
          on_ingest: nextRetentionOnIngest,
        },
      };
      if (patch.llm) body.llm = patch.llm;
      if (patch.embedder) body.embedder = patch.embedder;
      await updateMemoryGraphConfig(apiBase, apiToken, body);
      setConfigMsg(st("memoryGraph.saved"));
      void reload();
    } catch (e) {
      setConfigMsg(e instanceof Error ? e.message : st("memoryGraph.saveFailed"));
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

  const toolbar = scopeLocked ? (
    <>
      <div className="flex items-center gap-2 border-b border-[var(--border-muted)] px-3 py-2">
        <Share2 className="h-4 w-4 shrink-0 text-text-strong" strokeWidth={1.8} />
        <div className="mr-auto min-w-0">
          <div className="truncate text-sm font-medium text-text-strong">{st("memoryGraph.title")}</div>
          {contextTitle.trim() ? (
            <div className="truncate text-[10px] text-text-faint">{contextTitle.trim()}</div>
          ) : null}
        </div>
        <span className="shrink-0 rounded-md border border-border bg-surface-card px-2 py-1 text-[11px] text-text-muted">
          {scopeLabel(scope)}
        </span>
        {onClose ? (
          <button type="button" className="agx-topbar-btn !px-[5px]" onClick={onClose} title={st("memoryGraph.collapse")}>
            <PanelRight className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-muted)] px-3 py-2">
        <div className="flex min-w-[160px] flex-1 items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onSearch();
              }}
              placeholder={st("memoryGraph.searchPh")}
              className={`w-full pl-8 pr-2 ${MG_FIELD}`}
            />
          </div>
          <button
            type="button"
            className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition hover:opacity-90"
            style={{ background: "var(--ui-btn-primary-bg)", color: "var(--ui-btn-primary-text)" }}
            onClick={() => void onSearch()}
          >
            {st("memoryGraph.search")}
          </button>
        </div>
        <button
          type="button"
          className="agx-topbar-btn !px-[5px]"
          onClick={() => void reload()}
          title={st("memoryGraph.refreshTitle")}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
    </>
  ) : (
    <div
      className={
        isDashboard
          ? `${MG_PANEL} flex flex-col gap-2 p-3`
          : "flex flex-col gap-2 border-b border-[var(--border-muted)] px-3 py-2"
      }
    >
      {/* 第一行：主体类型 + 分身 / 群聊（与设置区 select 同字号、同高度） */}
      <div className="flex items-center gap-2">
        <div className="flex h-8 shrink-0 overflow-hidden rounded-md border border-border text-xs">
          {(["meta", "avatar", "group"] as MemoryGraphScope[]).map((s) => (
            <button
              key={s}
              type="button"
              className={`flex h-full items-center px-3 transition ${
                scope === s
                  ? "bg-[var(--ui-btn-primary-bg)] text-[var(--ui-btn-primary-text)]"
                  : "bg-transparent text-text-muted hover:bg-surface-hover hover:text-text-primary"
              }`}
              onClick={() => setScope(s)}
            >
              {scopeLabel(s)}
            </button>
          ))}
        </div>
        {scope !== "meta" ? (
          <SettingsDropdown
            size="compact"
            className="min-w-0 flex-1 max-w-xs"
            value={selectedSubjectId}
            displayLabel={subjectDisplayLabel}
            options={subjectOptions}
            onChange={setSelectedSubjectId}
            disabled={subjectOptions.length === 0}
            title={scope === "group" ? st("memoryGraph.pickGroup") : st("memoryGraph.pickAvatar")}
          />
        ) : (
          <div className="min-w-0 flex-1" />
        )}
        {onClose ? (
          <button
            type="button"
            className="agx-topbar-btn !px-[5px] shrink-0"
            onClick={onClose}
            title={st("memoryGraph.collapse")}
          >
            <PanelRight className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {/* 第二行：搜索 + 刷新 */}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onSearch();
            }}
            placeholder={st("memoryGraph.searchPh")}
            className={`h-8 w-full pl-8 pr-2 ${MG_TOOLBAR_CTRL}`}
          />
        </div>
        <button
          type="button"
          className="h-8 shrink-0 rounded-md px-3 text-xs font-medium transition hover:opacity-90"
          style={{ background: "var(--ui-btn-primary-bg)", color: "var(--ui-btn-primary-text)" }}
          onClick={() => void onSearch()}
        >
          {st("memoryGraph.search")}
        </button>
        <button
          type="button"
          className="agx-topbar-btn !h-8 !px-[5px]"
          onClick={() => {
            autoRecoverAttemptedRef.current = false;
            void reload();
          }}
          title={st("memoryGraph.refreshTitle")}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
    </div>
  );

  const isErrorHint = statusHintIsError;

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
          <p className="text-sm font-medium text-text-subtle">{st("memoryGraph.disabledTitle")}</p>
          <p className="max-w-xs text-xs leading-relaxed text-text-faint">
            {st("memoryGraph.disabledHint")}
          </p>
        </div>
      ) : graph.nodes.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="h-20 w-20 rounded-full border border-dashed border-[var(--border-muted)] opacity-60" />
          <p className="text-sm font-medium text-text-subtle">{loading ? st("memoryGraph.loadingGraph") : st("memoryGraph.noNodes")}</p>
          <p className="max-w-xs text-xs leading-relaxed text-text-faint">
            {status?.graphiti_installed === false
              ? st("memoryGraph.installHint")
              : st("memoryGraph.emptyHint")}
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
      {graph.nodes.length > 0 ? (
        <>
          <div className="pointer-events-none absolute left-2 top-2 max-w-[calc(100%-9rem)] rounded-md bg-surface-base/90 px-2 py-0.5 text-[10px] text-text-faint shadow-[inset_0_0_0_1px_var(--border-muted)]">
            {st("memoryGraph.partialNote")}
          </div>
          <div className="pointer-events-none absolute right-2 top-2 rounded-md bg-surface-base/90 px-2 py-1.5 shadow-[inset_0_0_0_1px_var(--border-muted)]">
            <div className="flex flex-col gap-1 text-[10px] text-text-faint">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full bg-[#60a5fa]" /> {st("memoryGraph.entity")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full bg-[#94a3b8]" /> Episode
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full bg-[#a78bfa]" /> {st("memoryGraph.community")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-px w-4 shrink-0 border-t border-dashed border-text-faint/70" />{" "}
                {st("memoryGraph.staleEdge")}
              </span>
            </div>
          </div>
        </>
      ) : null}
      {graph.meta.truncated ? (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-surface-base/90 px-2 py-0.5 text-[10px] text-text-faint shadow-[inset_0_0_0_1px_var(--border-muted)]">
          {st("memoryGraph.truncated", { count: nodeCount })}
        </div>
      ) : null}
    </div>
  );

  const statsBar = (
    <div className={`flex shrink-0 flex-wrap items-stretch overflow-hidden ${MG_PANEL}`}>
      <StatChip
        label={st("memoryGraph.nodes")}
        value={nodeCount}
        sub={st("memoryGraph.nodeSub", { entities: entityCount, episodes: episodeCount })}
        accent="rgba(96,165,250,0.9)"
      />
      <div className="hidden w-px shrink-0 self-stretch bg-[var(--border-muted)] sm:block" aria-hidden />
      <StatChip label={st("memoryGraph.edges")} value={edgeCount} accent="rgba(167,139,250,0.9)" />
      <div className="hidden w-px shrink-0 self-stretch bg-[var(--border-muted)] sm:block" aria-hidden />
      <StatChip label={st("memoryGraph.episodes")} value={episodes.length} sub={st("memoryGraph.timelineItems")} accent="rgba(148,163,184,0.9)" />
      <div className="hidden w-px shrink-0 self-stretch bg-[var(--border-muted)] sm:block" aria-hidden />
      <StatChip
        label={st("memoryGraph.queue")}
        value={status?.pending_jobs ?? 0}
        sub={status?.graphiti_installed === false ? st("memoryGraph.engineMissing") : st("memoryGraph.pendingIngest")}
        accent="rgba(245,158,11,0.9)"
      />
      <div className="hidden w-px shrink-0 self-stretch bg-[var(--border-muted)] sm:block" aria-hidden />
      <StatChip
        label={st("memoryGraph.partition")}
        value={groupId}
        mono
        className="min-w-0 flex-[1.2]"
        accent="rgba(99,102,241,0.55)"
      />
    </div>
  );

  const rightRail = (
    <div className="flex w-[236px] shrink-0 flex-col gap-2 overflow-hidden">
      <MemoryGraphDetail node={selectedNode} edges={graph.edges} onDeleteEpisode={onDeleteEpisode} />
      <section className={`flex min-h-0 flex-1 flex-col overflow-hidden ${MG_PANEL}`}>
        <header className="space-y-2 border-b border-[var(--border-muted)] px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-subtle">
              {st("memoryGraph.timeline")}
            </h4>
            <button
              type="button"
              className={`text-[10px] ${episodeSelectMode ? "text-text-strong" : "text-text-faint hover:text-text-subtle"}`}
              onClick={() => {
                setEpisodeSelectMode((v) => !v);
                if (episodeSelectMode) setSelectedEpisodeIds(new Set());
              }}
            >
              {episodeSelectMode ? st("memoryGraph.cancelMulti") : st("memoryGraph.multiSelect")}
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {(
              [
                ["all", st("memoryGraph.filterAll")],
                ["7d", st("memoryGraph.filter7d")],
                ["30d", st("memoryGraph.filter30d")],
                ["older30d", st("memoryGraph.filterOlder")],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`rounded px-1.5 py-0.5 text-[10px] ${
                  episodeTimeFilter === key
                    ? "bg-surface-hover text-text-strong"
                    : "text-text-faint hover:bg-surface-hover"
                }`}
                onClick={() => setEpisodeTimeFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {episodeSelectMode ? (
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                className="text-[10px] text-text-faint hover:text-text-subtle"
                onClick={() =>
                  setSelectedEpisodeIds(new Set(filteredEpisodes.filter((e) => !e.pinned).map((e) => e.id)))
                }
              >
                {st("memoryGraph.selectAll")}
              </button>
              <button
                type="button"
                className="text-[10px] text-text-faint hover:text-text-subtle"
                onClick={() => setSelectedEpisodeIds(new Set())}
              >
                {st("memoryGraph.cancel")}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[10px] text-rose-400 hover:text-rose-300"
                disabled={selectedEpisodeIds.size === 0}
                onClick={() => requestBulkDelete(Array.from(selectedEpisodeIds))}
              >
                <Trash2 className="h-3 w-3" />
                {st("memoryGraph.deleteSelected")}
              </button>
              {episodeTimeFilter === "older30d" ? (
                <button
                  type="button"
                  className="text-[10px] text-rose-400 hover:text-rose-300"
                  onClick={() =>
                    requestBulkDelete(filteredEpisodes.filter((e) => !e.pinned).map((e) => e.id))
                  }
                >
                  {st("memoryGraph.deleteFiltered")}
                </button>
              ) : null}
            </div>
          ) : null}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {filteredEpisodes.length === 0 ? (
            <div className="px-1.5 py-2 text-[10px] text-text-faint">{st("memoryGraph.noEpisode")}</div>
          ) : (
            filteredEpisodes.map((ep) => (
              <div
                key={ep.id}
                className={`mb-0.5 flex items-start gap-1 rounded-md px-1 py-0.5 ${
                  selectedId === ep.id ? "bg-surface-hover" : "hover:bg-surface-hover"
                }`}
              >
                {episodeSelectMode ? (
                  <input
                    type="checkbox"
                    className="mt-1.5 shrink-0"
                    checked={selectedEpisodeIds.has(ep.id)}
                    disabled={Boolean(ep.pinned)}
                    onChange={() => toggleEpisodeSelection(ep.id)}
                  />
                ) : null}
                <button
                  type="button"
                  className={`min-w-0 flex-1 truncate rounded-md px-1 py-1 text-left text-[10px] ${
                    selectedId === ep.id ? "text-text-strong" : "text-text-subtle"
                  }`}
                  onClick={() => setSelectedId(ep.id)}
                  title={ep.preview}
                >
                  {ep.pinned ? (
                    <Pin className="mr-0.5 inline h-3 w-3 text-amber-400/90" />
                  ) : null}
                  {ep.referenceTime ? (
                    <span className="mr-1 text-text-faint">{ep.referenceTime.slice(5, 16)}</span>
                  ) : null}
                  {ep.preview || ep.name}
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded p-1 text-text-faint hover:bg-surface-card hover:text-text-subtle"
                  title={ep.pinned ? st("memoryGraph.unpin") : st("memoryGraph.pinProtect")}
                  onClick={() => void onTogglePin(ep.id, !ep.pinned)}
                >
                  {ep.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );

  const configStrip = showConfig ? (
    <Panel title={st("memoryGraph.settingsTitle")} collapsible defaultCollapsed>
      <div className="space-y-0 text-sm text-text-subtle">
        <p className="pb-2 text-[11px] leading-relaxed text-text-faint">
          {st("memoryGraph.settingsIntro")}
        </p>
        <div className={MG_DIVIDER} />
        <div className="flex items-center justify-between gap-4 py-1">
          <div>
            <div>{st("memoryGraph.enable")}</div>
            <div className="mt-0.5 text-[11px] text-text-faint">{st("memoryGraph.enableHint")}</div>
          </div>
          <MiniSwitch
            checked={enabled}
            disabled={saving}
            onChange={(next) => void saveConfig({ enabled: next })}
            aria-label={st("memoryGraph.enableAria")}
          />
        </div>
        <div className={MG_DIVIDER} />
        <div className="flex items-center justify-between gap-4 py-2">
          <div>{st("memoryGraph.defaultScope")}</div>
          <select
            value={defaultScope}
            disabled={saving}
            onChange={(e) => void saveConfig({ default_scope: e.target.value as MemoryGraphScope })}
            className={MG_FIELD}
          >
            <option value="avatar">{st("memoryGraph.scopeAvatar")}</option>
            <option value="meta">{st("memoryGraph.scopeMeta")}</option>
            <option value="group">{st("memoryGraph.scopeGroup")}</option>
          </select>
        </div>
        <div className={MG_DIVIDER} />
        <div className="flex items-center justify-between gap-4 py-2">
          <div>{st("memoryGraph.autoIngest")}</div>
          <MiniSwitch
            checked={ingestAuto}
            disabled={saving || !enabled}
            onChange={(next) => void saveConfig({ ingest_auto: next })}
            aria-label={st("memoryGraph.autoIngestAria")}
          />
        </div>
        <div className={MG_DIVIDER} />
        <div className="space-y-2 py-2">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div>{st("memoryGraph.retention")}</div>
              <div className="mt-0.5 text-[11px] text-text-faint">{st("memoryGraph.retentionHint")}</div>
            </div>
            <MiniSwitch
              checked={retentionEnabled}
              disabled={saving || !enabled}
              onChange={(next) =>
                void saveConfig({ retention: { enabled: next } })
              }
              aria-label={st("memoryGraph.autoCleanAria")}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-text-faint">
              {st("memoryGraph.maxKeep")}
              <input
                type="number"
                min={0}
                disabled={saving || !enabled}
                value={retentionMaxEpisodes}
                onChange={(e) => setRetentionMaxEpisodes(Number(e.target.value) || 0)}
                onBlur={() =>
                  void saveConfig({
                    retention: {
                      max_episodes: retentionMaxEpisodes,
                      max_age_days: retentionMaxAgeDays,
                      on_ingest: retentionOnIngest,
                    },
                  })
                }
                className={`${MG_FIELD} mt-1 w-full`}
              />
            </label>
            <label className="text-[11px] text-text-faint">
              {st("memoryGraph.keepDays")}
              <input
                type="number"
                min={0}
                disabled={saving || !enabled}
                value={retentionMaxAgeDays}
                onChange={(e) => setRetentionMaxAgeDays(Number(e.target.value) || 0)}
                onBlur={() =>
                  void saveConfig({
                    retention: {
                      max_episodes: retentionMaxEpisodes,
                      max_age_days: retentionMaxAgeDays,
                      on_ingest: retentionOnIngest,
                    },
                  })
                }
                className={`${MG_FIELD} mt-1 w-full`}
              />
            </label>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="text-[11px] text-text-faint">{st("memoryGraph.cleanAfterIngest")}</div>
            <MiniSwitch
              checked={retentionOnIngest}
              disabled={saving || !enabled || !retentionEnabled}
              onChange={(next) => void saveConfig({ retention: { on_ingest: next } })}
              aria-label={st("memoryGraph.cleanAfterIngest")}
            />
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              disabled={!enabled || !groupId}
              onClick={() => void previewRetentionCleanup()}
            >
              {st("memoryGraph.cleanNow")}
            </Button>
          </div>
        </div>
        <div className={MG_DIVIDER} />
        <div className="space-y-2 py-2">
          <div>
            <div>{st("memoryGraph.buildModel")}</div>
            <div className="mt-0.5 text-[11px] text-text-faint">
              {st("memoryGraph.buildModelHint", {
                current: defaultProvider ? st("memoryGraph.currentDefault", { provider: defaultProvider }) : "",
              })}
            </div>
            {status?.models ? (
              <div className="mt-1 text-[11px] text-text-muted">
                {st("memoryGraph.effective", {
                  llm: `${status.models.llm_provider}/${status.models.llm_model}`,
                  embed: `${status.models.embedder_provider}/${status.models.embedder_model}`,
                })}
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-[64px_1fr_1.2fr] items-center gap-2">
            <span className="text-[11px] text-text-faint">{st("memoryGraph.extractLlm")}</span>
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
              <option value="">{st("memoryGraph.defaultProvider")}</option>
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
                  : st("memoryGraph.pickProviderFirst")
              }
            >
              <option value="">{st("memoryGraph.modelNamePh")}</option>
              {llmModelOptions.map((m) => (
                <option key={`llm-model-${m}`} value={m}>
                  {m}
                </option>
              ))}
              {llmProvider.trim() && llmModelOptions.length === 0 ? (
                <option disabled value="__no_models">
                  {st("memoryGraph.addVisibleModels")}
                </option>
              ) : null}
            </select>
          </div>
          <div className="grid grid-cols-[64px_1fr_1.2fr] items-center gap-2">
            <span className="text-[11px] text-text-faint">{st("memoryGraph.embedLabel")}</span>
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
              <option value="">{st("memoryGraph.defaultProvider")}</option>
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
                  : st("memoryGraph.pickProviderFirst")
              }
            >
              <option value="">{st("memoryGraph.embedPh")}</option>
              {embedModelOptions.map((m) => (
                <option key={`emb-model-${m}`} value={m}>
                  {m}
                </option>
              ))}
              {embedProvider.trim() && embedModelOptions.length === 0 ? (
                <option disabled value="__no_models">
                  {st("memoryGraph.addVisibleModels")}
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
              {st("memoryGraph.saveModels")}
            </button>
          </div>
        </div>
        {configMsg ? (
          <>
            <div className={MG_DIVIDER} />
            <div className={`py-1 text-xs ${configMsg === st("memoryGraph.saved") ? "text-text-muted" : "text-status-error"}`}>
              {configMsg}
            </div>
          </>
        ) : null}
      </div>
    </Panel>
  ) : null;

  const subjectMemoryArea = (
    <WorkspaceMemoryList
      apiBase={apiBase}
      apiToken={apiToken}
      avatarId={subjectAvatarIdForWorkspace}
      title={t("memoryList.titleScoped", {
        scope:
          scope === "avatar"
            ? t("memoryList.scopeAvatar")
            : scope === "group"
              ? t("memoryList.scopeGroup")
              : t("memoryList.scopeMeta"),
      })}
      description={scope === "meta" ? t("memoryList.descMeta") : t("memoryList.descSubject")}
    />
  );

  const modals = (
    <>
      <Modal
        open={pendingBulkDelete != null}
        title={st("memoryGraph.deleteEpisodeTitle")}
        backdropClassName="bg-black/70"
        panelClassName="w-full max-w-[min(92vw,480px)] bg-[var(--surface-base-fallback)]"
        onClose={() => {
          if (!bulkDeleting) setPendingBulkDelete(null);
        }}
        footer={
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              className="min-w-[76px] bg-surface-card-strong"
              disabled={bulkDeleting}
              onClick={() => setPendingBulkDelete(null)}
            >
              {st("memoryGraph.cancel")}
            </Button>
            <Button
              type="button"
              variant="danger"
              className="min-w-[76px]"
              disabled={bulkDeleting}
              onClick={() => void confirmBulkDelete()}
            >
              {bulkDeleting ? st("memoryGraph.deleting") : st("memoryGraph.delete")}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-text-subtle">
          {st("memoryGraph.deleteCount", { count: pendingBulkDelete?.ids.length ?? 0 })}
          {pendingBulkDelete && pendingBulkDelete.pinnedSkipped > 0
            ? st("memoryGraph.pinnedKept", { count: pendingBulkDelete.pinnedSkipped })
            : ""}
          {st("memoryGraph.irreversible")}
        </p>
        {bulkDeleting ? (
          <p className="mt-2 text-sm text-text-faint">
            {st("memoryGraph.deletingHint")}
          </p>
        ) : null}
      </Modal>
      <Modal
        open={pendingRetentionRun != null}
        title={st("memoryGraph.cleanTitle")}
        backdropClassName="bg-black/70"
        panelClassName="w-full max-w-[min(92vw,480px)] bg-[var(--surface-base-fallback)]"
        onClose={() => setPendingRetentionRun(null)}
        footer={
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              className="min-w-[76px] bg-surface-card-strong"
              onClick={() => setPendingRetentionRun(null)}
            >
              {st("memoryGraph.cancel")}
            </Button>
            <Button
              type="button"
              variant="danger"
              className="min-w-[76px]"
              onClick={() => void confirmRetentionCleanup()}
            >
              {st("memoryGraph.runClean")}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-text-subtle">
          {st("memoryGraph.cleanConfirm", { count: pendingRetentionRun ?? 0 })}
        </p>
      </Modal>
    </>
  );

  if (isDashboard) {
    return (
      <div className="flex flex-col gap-4">
        {modals}
        <div className="shrink-0 space-y-4">
          {configStrip}
          {toolbar}
          {alerts}
        </div>
        <div className="flex min-h-[500px] flex-1 gap-3 overflow-hidden">
          <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden">
            {statsBar}
            <div className="min-h-0 flex-1">{canvasArea}</div>
          </div>
          {rightRail}
        </div>
        <div className="min-h-0">{subjectMemoryArea}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-base text-text-subtle">
      {modals}
      {toolbar}
      <div className="min-w-0 space-y-2 px-3 pt-2 empty:hidden">{alerts}</div>
      <div className="min-h-0 flex-1 p-2">{canvasArea}</div>
      <div className="max-h-[42%] space-y-2 overflow-y-auto border-t border-border px-3 py-2">
        <MemoryGraphDetail node={selectedNode} edges={graph.edges} onDeleteEpisode={onDeleteEpisode} />
        {episodes.length > 0 ? (
          <div className="max-h-24 overflow-y-auto text-[10px]">
            <div className="mb-1 font-medium text-text-faint">{st("memoryGraph.timeline")}</div>
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
      <div className="max-h-[38%] min-h-0 overflow-y-auto border-t border-border p-2">
        {subjectMemoryArea}
      </div>
    </div>
  );
}

export const MemoryGraphExplorer = memo(MemoryGraphExplorerInner);
