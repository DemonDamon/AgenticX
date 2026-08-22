import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  ChevronDown,
  FolderKanban,
  GitBranch,
  ListChecks,
  ListFilter,
  ListTree,
  ListTodo,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  Smartphone,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";
import { createPortal } from "react-dom";
import { META_AGENT_DISPLAY_NAME } from "../../constants/branding";
import { SHOW_DESKTOP_EXTERNAL_IM } from "../../constants/desktop-feature-visibility";
import { useAppStore, type Message } from "../../store";
import { rememberSessionForAvatar } from "../../utils/avatar-last-session";
import { avatarDotColorForIdentity, groupDotColor } from "../../utils/avatar-color";
import { isAutomationPaneAvatarId } from "../../utils/automation-pane";
import {
  clearPaneLazyInheritParent,
  markPaneAwaitingFreshSession,
} from "../../utils/pane-fresh-session";
import {
  getCachedSessionTail,
  resolveSessionTailForSwitch,
  cacheSessionTail,
} from "../../utils/session-tail-cache";
import { mapLoadedSessionMessage, type LoadedSessionMessage } from "../../utils/session-message-map";
import { LoopReviewCard } from "../session/LoopReviewCard";
import {
  SIDEBAR_HISTORY_COLLAPSE_KEY,
  SIDEBAR_HISTORY_FILTER_KEY,
  SIDEBAR_HISTORY_PAGE_SIZE,
  activeAvatarIdForSidebarRow,
  applySidebarSessionHistoryHints,
  bucketSidebarHistoryRows,
  findPaneForSidebarSession,
  formatSidebarRelativeTime,
  getSidebarSessionActivityTs,
  matchesSidebarAvatarFilter,
  normalizeSidebarSessionRows,
  partitionSidebarSessionRows,
  parseDesktopBoundSessionId,
  resolveSidebarAvatarChipName,
  sidebarSessionHasRenderableMessages,
  sidebarSessionLabel,
  type SidebarSessionRow,
} from "../../utils/sidebar-session-history";
import { HoverTip } from "../ds/HoverTip";
import { SessionGeneratingDots } from "./SessionGeneratingDots";
import { SidebarSessionFileManage } from "./SidebarSessionFileManage";

type MoreMenuState = {
  sessionId: string;
  x: number;
  y: number;
};

type CollapseState = {
  projects: boolean;
  tasks: boolean;
  wechat: boolean;
  feishu: boolean;
  pinned: boolean;
  today: boolean;
  yesterday: boolean;
  recent: boolean;
  earlier: boolean;
};

const DEFAULT_COLLAPSE: CollapseState = {
  projects: false,
  tasks: false,
  wechat: false,
  feishu: false,
  pinned: false,
  today: false,
  yesterday: false,
  recent: false,
  earlier: false,
};

function loadCollapse(): CollapseState {
  try {
    const raw = localStorage.getItem(SIDEBAR_HISTORY_COLLAPSE_KEY);
    if (!raw) return { ...DEFAULT_COLLAPSE };
    const parsed = JSON.parse(raw) as Partial<CollapseState>;
    return { ...DEFAULT_COLLAPSE, ...parsed };
  } catch {
    return { ...DEFAULT_COLLAPSE };
  }
}

function loadFilter(): string {
  try {
    return localStorage.getItem(SIDEBAR_HISTORY_FILTER_KEY) ?? "all";
  } catch {
    return "all";
  }
}

function isPaneStillOnSession(
  panes: Array<{ id: string; sessionId?: string }>,
  paneId: string,
  sessionId: string
): boolean {
  const pane = panes.find((p) => p.id === paneId);
  return String(pane?.sessionId ?? "").trim() === sessionId.trim();
}

/** C1 左边条：Meta 用中性灰，分身/群聊按身份取色（已配置色优先，否则按 id 哈希）。 */
function resolveSidebarChipStripeColor(
  avatarId: string | null | undefined,
  avatars: Array<{ id: string; color?: string | null }>
): string {
  const aid = String(avatarId ?? "").trim();
  if (!aid) return "rgb(156, 163, 175)";
  if (aid.startsWith("group:")) return groupDotColor(aid);
  if (aid.startsWith("automation:")) return "rgb(251, 191, 36)";
  const avatar = avatars.find((a) => a.id === aid);
  return avatarDotColorForIdentity(aid, avatar?.color);
}

export function SidebarSessionHistory() {
  const avatars = useAppStore((s) => s.avatars);
  const groups = useAppStore((s) => s.groups);
  const panes = useAppStore((s) => s.panes);
  const activePaneId = useAppStore((s) => s.activePaneId);
  const sessionCatalogRevision = useAppStore((s) => s.sessionCatalogRevision);
  const sessionHistoryHints = useAppStore((s) => s.sessionHistoryHints);
  const clearSessionHistoryHint = useAppStore((s) => s.clearSessionHistoryHint);
  const addPane = useAppStore((s) => s.addPane);
  const setActivePaneId = useAppStore((s) => s.setActivePaneId);
  const setActiveAvatarId = useAppStore((s) => s.setActiveAvatarId);
  const setPaneSessionId = useAppStore((s) => s.setPaneSessionId);
  const setPaneSessionMode = useAppStore((s) => s.setPaneSessionMode);
  const setActiveTaskspace = useAppStore((s) => s.setActiveTaskspace);
  const setPaneMessages = useAppStore((s) => s.setPaneMessages);
  const setPaneLoadingMessages = useAppStore((s) => s.setPaneLoadingMessages);
  const setPaneMessagePaging = useAppStore((s) => s.setPaneMessagePaging);
  const resetPaneMessagePaging = useAppStore((s) => s.resetPaneMessagePaging);
  const getCachedSessionMessages = useAppStore((s) => s.getCachedSessionMessages);
  const cacheSessionMessages = useAppStore((s) => s.cacheSessionMessages);
  const dropCachedSessionMessages = useAppStore((s) => s.dropCachedSessionMessages);
  const bumpSessionCatalogRevision = useAppStore((s) => s.bumpSessionCatalogRevision);
  const setMainView = useAppStore((s) => s.setMainView);

  const [sessions, setSessions] = useState<SidebarSessionRow[]>([]);
  const [feishuBoundId, setFeishuBoundId] = useState("");
  const [wechatBoundId, setWechatBoundId] = useState("");
  const [collapse, setCollapse] = useState<CollapseState>(() => loadCollapse());
  const [avatarFilter, setAvatarFilter] = useState<string>(() => loadFilter());
  const [visibleLimit, setVisibleLimit] = useState(SIDEBAR_HISTORY_PAGE_SIZE);
  const [filterOpen, setFilterOpen] = useState(false);
  const [loopReviewScores, setLoopReviewScores] = useState<Record<string, number>>({});
  const [loopReviewFor, setLoopReviewFor] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [moreMenu, setMoreMenu] = useState<MoreMenuState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  /** Trae-style: history list → per-session file manage view. */
  const [fileManageTarget, setFileManageTarget] = useState<{
    sessionId: string;
    paneId: string;
  } | null>(null);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [filterMenuPos, setFilterMenuPos] = useState<{ left: number; top: number } | null>(null);

  const avatarNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of avatars) map.set(a.id, a.name);
    for (const g of groups) map.set(`group:${g.id}`, g.name);
    return map;
  }, [avatars, groups]);

  const filterOptions = useMemo(() => {
    const opts: Array<{ id: string; label: string }> = [
      { id: "all", label: "全部" },
      { id: "__meta__", label: META_AGENT_DISPLAY_NAME },
    ];
    for (const a of avatars) {
      opts.push({ id: a.id, label: a.name });
    }
    for (const g of groups) {
      opts.push({ id: `group:${g.id}`, label: g.name });
    }
    return opts;
  }, [avatars, groups]);

  const filterLabel =
    filterOptions.find((o) => o.id === avatarFilter)?.label ?? "全部";

  const loadSessions = useCallback(async () => {
    try {
      const listed = await window.agenticxDesktop.listSessions();
      if (listed.ok && Array.isArray(listed.sessions)) {
        const rows = normalizeSidebarSessionRows(listed.sessions);
        setSessions(rows);
        for (const row of rows) {
          const hint = useAppStore.getState().sessionHistoryHints[row.session_id];
          if (!hint) continue;
          const apiActivity = Number(row.updated_at ?? 0);
          // Backend caught up → drop optimistic hint; UI then trusts API execution_state.
          if (apiActivity >= hint.activityAt - 2) {
            clearSessionHistoryHint(row.session_id);
          }
        }
        // Best-effort batch fetch of loop-review scores; failures stay silent.
        // Sessions without tool observations carry no real signal — their score
        // is a floor imposed by missing evidence, so we show no badge at all.
        void Promise.allSettled(
          rows.map(async (row) => {
            const r = await window.agenticxDesktop.getSessionLoopReview(row.session_id);
            return r.ok && r.review && r.review.observations_available !== false
              ? { id: row.session_id, score: r.review.overall }
              : null;
          }),
        ).then((results) => {
          const next: Record<string, number> = {};
          for (const res of results) {
            if (res.status === "fulfilled" && res.value) next[res.value.id] = res.value.score;
          }
          setLoopReviewScores(next);
        });
      }
    } catch (err) {
      console.warn("[SidebarSessionHistory] listSessions failed", err);
    }
  }, [clearSessionHistoryHint]);

  const loadBindings = useCallback(async () => {
    try {
      const [feishu, wechat] = await Promise.all([
        window.agenticxDesktop.loadFeishuBinding(),
        window.agenticxDesktop.loadWechatBinding(),
      ]);
      setFeishuBoundId(parseDesktopBoundSessionId(feishu.bindings));
      setWechatBoundId(parseDesktopBoundSessionId(wechat.bindings));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadSessions();
    void loadBindings();
  }, [loadSessions, loadBindings, sessionCatalogRevision]);

  useEffect(() => {
    const listTimer = window.setInterval(() => void loadSessions(), 5000);
    const bindTimer = window.setInterval(() => void loadBindings(), 3000);
    return () => {
      window.clearInterval(listTimer);
      window.clearInterval(bindTimer);
    };
  }, [loadSessions, loadBindings]);

  useEffect(() => {
    if (!fileManageTarget) return;
    if (sessions.length === 0) return;
    const stillExists = sessions.some((s) => s.session_id === fileManageTarget.sessionId);
    if (!stillExists) setFileManageTarget(null);
  }, [fileManageTarget, sessions]);

  useEffect(() => {
    if (!fileManageTarget) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFileManageTarget(null);
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [fileManageTarget]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_HISTORY_COLLAPSE_KEY, JSON.stringify(collapse));
    } catch {
      /* ignore */
    }
  }, [collapse]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_HISTORY_FILTER_KEY, avatarFilter);
    } catch {
      /* ignore */
    }
  }, [avatarFilter]);

  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (filterBtnRef.current?.contains(t)) return;
      if (filterMenuRef.current?.contains(t)) return;
      setFilterOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFilterOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [filterOpen]);

  useEffect(() => {
    if (!moreMenu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (moreMenuRef.current?.contains(t)) return;
      setMoreMenu(null);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreMenu(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [moreMenu]);

  useEffect(() => {
    if (!moreMenu || !moreMenuRef.current) return;
    const el = moreMenuRef.current;
    const pad = 8;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = moreMenu.x;
    let top = moreMenu.y;
    if (left + rect.width > vw - pad) left = Math.max(pad, vw - rect.width - pad);
    if (top + rect.height > vh - pad) top = Math.max(pad, vh - rect.height - pad);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = "visible";
  }, [moreMenu]);

  useEffect(() => {
    if (!editingId) return;
    const t = window.setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [editingId]);

  const sessionsWithHints = useMemo(
    () => applySidebarSessionHistoryHints(sessions, sessionHistoryHints),
    [sessions, sessionHistoryHints]
  );

  const wechatRow = useMemo(() => {
    return sessionsWithHints.find((s) => s.session_id === wechatBoundId) ?? null;
  }, [sessionsWithHints, wechatBoundId]);
  const feishuRow = useMemo(() => {
    return sessionsWithHints.find((s) => s.session_id === feishuBoundId) ?? null;
  }, [sessionsWithHints, feishuBoundId]);

  const specialIds = useMemo(() => {
    const ids = new Set<string>();
    if (wechatBoundId) ids.add(wechatBoundId);
    if (feishuBoundId) ids.add(feishuBoundId);
    return ids;
  }, [wechatBoundId, feishuBoundId]);

  const filteredForBuckets = useMemo(
    () => sessionsWithHints.filter((row) => matchesSidebarAvatarFilter(row, avatarFilter)),
    [sessionsWithHints, avatarFilter]
  );

  // A pane can have a newer local workspace selection than the last persisted
  // turn. Prefer that signal for the current session so the row moves between
  // 项目 / 任务 immediately; historical rows keep the backend metadata.
  const rowsWithLiveWorkspace = useMemo(() => {
    const liveWorkspaceBySession = new Map<string, string>();
    for (const pane of panes) {
      const sid = String(pane.sessionId ?? "").trim();
      const active = String(pane.activeTaskspaceId ?? "").trim();
      if (!sid || !active) continue;
      liveWorkspaceBySession.set(sid, active);
    }
    if (liveWorkspaceBySession.size === 0) return filteredForBuckets;
    return filteredForBuckets.map((row) => {
      const active = liveWorkspaceBySession.get(row.session_id);
      return active ? { ...row, active_taskspace_id: active } : row;
    });
  }, [filteredForBuckets, panes]);

  const { projects: projectRows, tasks: taskRows } = useMemo(() => {
    // Bound IM sessions have dedicated rows inside 任务 and must never also
    // appear in 项目 even if a connector happened to carry workspace metadata.
    const regularRows = rowsWithLiveWorkspace.filter((row) => !specialIds.has(row.session_id));
    return partitionSidebarSessionRows(regularRows);
  }, [rowsWithLiveWorkspace, specialIds]);

  const taskBuckets = useMemo(
    () => bucketSidebarHistoryRows(taskRows, specialIds),
    [taskRows, specialIds]
  );

  const taskChronological = useMemo(
    () => [
      ...taskBuckets.today,
      ...taskBuckets.yesterday,
      ...taskBuckets.recent,
      ...taskBuckets.earlier,
    ],
    [taskBuckets.today, taskBuckets.yesterday, taskBuckets.recent, taskBuckets.earlier]
  );
  const visibleProjectRows = projectRows.slice(0, visibleLimit);
  const taskVisibleLimit = Math.max(0, visibleLimit - visibleProjectRows.length);
  const visibleTaskChrono = taskChronological.slice(0, taskVisibleLimit);
  const taskTodayVisible = visibleTaskChrono.filter((r) => taskBuckets.today.includes(r));
  const taskYesterdayVisible = visibleTaskChrono.filter((r) => taskBuckets.yesterday.includes(r));
  const taskRecentVisible = visibleTaskChrono.filter((r) => taskBuckets.recent.includes(r));
  const taskEarlierVisible = visibleTaskChrono.filter((r) => taskBuckets.earlier.includes(r));
  const specialTaskRows = SHOW_DESKTOP_EXTERNAL_IM
    ? [wechatRow, feishuRow].filter((row): row is SidebarSessionRow => !!row)
    : [];
  const taskRowCount =
    specialTaskRows.length +
    taskBuckets.pinned.length +
    taskChronological.length;
  const hasMore = projectRows.length + taskBuckets.pinned.length + taskChronological.length > visibleLimit;
  const hasStandardHistory = projectRows.length > 0 || taskRowCount > 0;

  const selectableRows = useMemo(() => {
    const map = new Map<string, SidebarSessionRow>();
    if (SHOW_DESKTOP_EXTERNAL_IM && wechatRow) map.set(wechatRow.session_id, wechatRow);
    if (SHOW_DESKTOP_EXTERNAL_IM && feishuRow) map.set(feishuRow.session_id, feishuRow);
    for (const row of projectRows) map.set(row.session_id, row);
    for (const row of taskBuckets.pinned) map.set(row.session_id, row);
    for (const row of taskChronological) map.set(row.session_id, row);
    return Array.from(map.values());
  }, [wechatRow, feishuRow, projectRows, taskBuckets.pinned, taskChronological]);

  const selectableIds = useMemo(
    () => selectableRows.map((r) => r.session_id),
    [selectableRows]
  );

  const allSelectableSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedSessionIds.includes(id));

  const activeSessionId = useMemo(() => {
    const pane = panes.find((p) => p.id === activePaneId);
    return String(pane?.sessionId ?? "").trim();
  }, [panes, activePaneId]);

  const toggleSection = (key: keyof CollapseState) => {
    setCollapse((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleSelectSession = (sessionId: string) => {
    setSelectedSessionIds((prev) =>
      prev.includes(sessionId) ? prev.filter((id) => id !== sessionId) : [...prev, sessionId]
    );
  };

  const toggleSelectAll = () => {
    if (allSelectableSelected) {
      setSelectedSessionIds([]);
      return;
    }
    setSelectedSessionIds(selectableIds);
  };

  const clearDeletedSessionRefsInPanes = (deletedIds: Iterable<string>) => {
    const idSet = new Set<string>();
    for (const sid of deletedIds) {
      const trimmed = String(sid || "").trim();
      if (trimmed) idSet.add(trimmed);
    }
    if (idSet.size === 0) return;
    for (const p of useAppStore.getState().panes) {
      const psid = String(p.sessionId || "").trim();
      if (psid && idSet.has(psid)) {
        markPaneAwaitingFreshSession(p.id);
        clearPaneLazyInheritParent(p.id);
        setPaneSessionId(p.id, "");
        setPaneMessages(p.id, []);
      }
    }
  };

  const deleteSelectedSessions = async () => {
    const api = window.agenticxDesktop;
    if (typeof api.deleteSession !== "function") return;
    const targets = selectedSessionIds.filter(Boolean);
    if (targets.length === 0) return;
    const confirmResult =
      typeof api.confirmDialog === "function"
        ? await api.confirmDialog({
            title: "确认删除会话",
            message: `确认删除已选择的 ${targets.length} 个会话？`,
            detail: "删除后不可恢复。",
            confirmText: "删除",
            cancelText: "取消",
            destructive: true,
          })
        : {
            ok: true,
            confirmed: window.confirm(
              `确认删除已选择的 ${targets.length} 个会话？删除后不可恢复。`
            ),
          };
    if (!confirmResult.confirmed) return;

    const prevSessions = sessions;
    const targetSet = new Set(targets);
    setSessions((curr) => curr.filter((row) => !targetSet.has(row.session_id)));
    setSelectedSessionIds([]);
    setBatchDeleting(true);
    try {
      let pending = [...targets];
      for (let round = 0; round < 3 && pending.length > 0; round += 1) {
        let failedRound: string[] = [];
        const canBatch = typeof api.deleteSessionsBatch === "function";
        if (canBatch) {
          const result = await api.deleteSessionsBatch(pending);
          if (!result?.ok) {
            for (const sessionId of pending) {
              try {
                const single = await api.deleteSession(sessionId);
                if (!single?.ok) failedRound.push(sessionId);
              } catch {
                failedRound.push(sessionId);
              }
            }
          } else {
            failedRound = Array.isArray(result.failed) ? result.failed : [];
          }
        } else {
          for (const sessionId of pending) {
            try {
              const result = await api.deleteSession(sessionId);
              if (!result?.ok) failedRound.push(sessionId);
            } catch {
              failedRound.push(sessionId);
            }
          }
        }
        const refresh = await api.listSessions();
        const remainSet = new Set(
          refresh.ok ? normalizeSidebarSessionRows(refresh.sessions).map((r) => r.session_id) : []
        );
        const stillThere = pending.filter((sid) => remainSet.has(sid));
        pending = Array.from(new Set([...failedRound, ...stillThere]));
      }

      const failed = pending;
      if (failed.length > 0) {
        const failedSet = new Set(failed);
        setSessions((curr) => {
          const existing = new Set(curr.map((row) => row.session_id));
          const toRestore = prevSessions.filter(
            (row) => failedSet.has(row.session_id) && !existing.has(row.session_id)
          );
          return normalizeSidebarSessionRows([...curr, ...toRestore]);
        });
        window.alert(`有 ${failed.length} 个会话删除失败，已自动保留。你可以再次尝试删除。`);
      }
      const failedSet = new Set(failed);
      const successfullyDeleted = targets.filter((sid) => !failedSet.has(sid));
      clearDeletedSessionRefsInPanes(successfullyDeleted);
      dropCachedSessionMessages(successfullyDeleted);
      bumpSessionCatalogRevision();
      window.setTimeout(() => bumpSessionCatalogRevision(), 450);
      await loadSessions();
      setSelectMode(false);
    } finally {
      setBatchDeleting(false);
    }
  };

  const openFilterMenu = () => {
    const el = filterBtnRef.current;
    if (!el) {
      setFilterOpen((v) => !v);
      return;
    }
    const rect = el.getBoundingClientRect();
    setFilterMenuPos({ left: Math.max(8, rect.right - 140), top: rect.bottom + 4 });
    setFilterOpen((v) => !v);
  };

  const openSession = useCallback(
    async (row: SidebarSessionRow, forcePaneId?: string): Promise<string | null> => {
      setMainView("chat");
      const avatarId = String(row.avatar_id ?? "").trim() || null;
      const avatarName = resolveSidebarAvatarChipName(row, avatarNameById);
      const state = useAppStore.getState();
      const matched = findPaneForSidebarSession(state.panes, row, forcePaneId);
      let paneId = matched?.id ?? "";
      if (!matched) {
        paneId = addPane(avatarId, avatarName, "");
      }
      const pane = useAppStore.getState().panes.find((p) => p.id === paneId);
      if (!paneId || !pane) return null;

      setActivePaneId(paneId);
      setActiveAvatarId(activeAvatarIdForSidebarRow(avatarId));
      rememberSessionForAvatar(avatarId, row.session_id);

      const previousSessionId = String(pane.sessionId ?? "").trim();
      const isSameSession = previousSessionId === row.session_id;
      const existingMessages = pane.messages ?? [];

      setPaneSessionId(paneId, row.session_id, {
        provider: row.provider,
        model: row.model,
      });
      if (Object.prototype.hasOwnProperty.call(row, "active_taskspace_id")) {
        setActiveTaskspace(paneId, row.active_taskspace_id ?? null);
      }
      if (row.session_mode === "code_dev" || row.session_mode === "daily_office") {
        setPaneSessionMode(paneId, row.session_mode);
      }

      // Do not trust raw messages.length: owner-mismatched / untagged rows render blank.
      if (isSameSession && sidebarSessionHasRenderableMessages(existingMessages, row.session_id)) {
        setPaneLoadingMessages(paneId, false);
        return paneId;
      }

      const paneStillOn = (sid: string) =>
        isPaneStillOnSession(useAppStore.getState().panes, paneId, sid);

      const applyTailEntry = (
        targetId: string,
        entry: { messages: typeof existingMessages; startIndex: number; hasOlder: boolean }
      ) => {
        setPaneMessages(targetId, entry.messages);
        setPaneLoadingMessages(targetId, false);
        setPaneMessagePaging(targetId, {
          oldestLoadedIndex: entry.startIndex,
          hasOlderMessages: entry.hasOlder,
          loadingOlderMessages: false,
        });
      };

      const cached = getCachedSessionMessages(row.session_id);
      if (cached && cached.length > 0) {
        setPaneMessages(paneId, cached);
        setPaneLoadingMessages(paneId, false);
        resetPaneMessagePaging(paneId);
        return paneId;
      }

      const tailCached = getCachedSessionTail(row.session_id);
      if (tailCached && tailCached.messages.length > 0) {
        applyTailEntry(paneId, tailCached);
        return paneId;
      }

      setPaneLoadingMessages(paneId, true);
      setPaneMessages(paneId, []);
      resetPaneMessagePaging(paneId);
      try {
        const entry = await resolveSessionTailForSwitch(row.session_id);
        if (entry && entry.messages.length > 0) {
          cacheSessionTail(row.session_id, entry);
          if (!entry.hasOlder) {
            cacheSessionMessages(row.session_id, entry.messages);
          }
          if (paneStillOn(row.session_id)) applyTailEntry(paneId, entry);
          return paneId;
        }
      } catch {
        /* fallback below */
      }

      try {
        const result = await window.agenticxDesktop.loadSessionMessages(row.session_id);
        if (!paneStillOn(row.session_id)) return paneId;
        if (result.ok && Array.isArray(result.messages)) {
          const mapped: Message[] = result.messages.map((item, index) =>
            mapLoadedSessionMessage(item as LoadedSessionMessage, row.session_id, index)
          );
          cacheSessionMessages(row.session_id, mapped);
          setPaneMessages(paneId, mapped);
          resetPaneMessagePaging(paneId);
          return paneId;
        }
      } catch (err) {
        console.warn("[SidebarSessionHistory] openSession load failed", err);
      } finally {
        if (paneStillOn(row.session_id)) setPaneLoadingMessages(paneId, false);
      }
      if (paneStillOn(row.session_id)) setPaneMessages(paneId, []);
      return paneId;
    },
    [
      addPane,
      avatarNameById,
      cacheSessionMessages,
      getCachedSessionMessages,
      resetPaneMessagePaging,
      setActiveAvatarId,
      setActivePaneId,
      setMainView,
      setPaneLoadingMessages,
      setPaneMessagePaging,
      setPaneMessages,
      setPaneSessionId,
      setPaneSessionMode,
      setActiveTaskspace,
    ]
  );

  /** Fast path: bind pane/session without waiting for message load (card can slide immediately). */
  const ensurePaneForRow = (row: SidebarSessionRow): string | null => {
    setMainView("chat");
    const avatarId = String(row.avatar_id ?? "").trim() || null;
    const avatarName = resolveSidebarAvatarChipName(row, avatarNameById);
    const state = useAppStore.getState();
    let pane = findPaneForSidebarSession(state.panes, row);
    let paneId = pane?.id ?? "";
    if (!pane) {
      paneId = addPane(avatarId, avatarName, "");
      pane = useAppStore.getState().panes.find((p) => p.id === paneId);
    }
    if (!paneId || !pane) return null;
    setActivePaneId(paneId);
    setActiveAvatarId(activeAvatarIdForSidebarRow(avatarId));
    rememberSessionForAvatar(avatarId, row.session_id);
    setPaneSessionId(paneId, row.session_id, {
      provider: row.provider,
      model: row.model,
    });
    if (Object.prototype.hasOwnProperty.call(row, "active_taskspace_id")) {
      setActiveTaskspace(paneId, row.active_taskspace_id ?? null);
    }
    if (row.session_mode === "code_dev" || row.session_mode === "daily_office") {
      setPaneSessionMode(paneId, row.session_mode);
    }
    return paneId;
  };

  const openFileManage = (row: SidebarSessionRow) => {
    setMoreMenu(null);
    const paneId = ensurePaneForRow(row);
    if (!paneId) return;
    // Slide card first; hydrate chat history in the background.
    setFileManageTarget({ sessionId: row.session_id, paneId });
    void openSession(row, paneId);
  };

  const commitRename = async (row: SidebarSessionRow) => {
    const next = editingName.trim();
    const prev = sidebarSessionLabel(row);
    setEditingId(null);
    if (!next || next === prev) return;
    const api = window.agenticxDesktop;
    if (typeof api.renameSession !== "function") return;
    const result = await api.renameSession({ sessionId: row.session_id, name: next });
    if (result.ok) {
      setSessions((curr) =>
        curr.map((item) =>
          item.session_id === row.session_id ? { ...item, session_name: next } : item
        )
      );
      bumpSessionCatalogRevision();
      await loadSessions();
    }
  };

  const togglePinSession = async (row: SidebarSessionRow) => {
    const api = window.agenticxDesktop;
    if (typeof api.pinSession !== "function") return;
    const result = await api.pinSession({ sessionId: row.session_id, pinned: !row.pinned });
    if (result.ok) {
      bumpSessionCatalogRevision();
      await loadSessions();
    }
  };

  const openSessionInNewPane = (row: SidebarSessionRow) => {
    const avatarId = String(row.avatar_id ?? "").trim() || null;
    const avatarName = resolveSidebarAvatarChipName(row, avatarNameById);
    const paneId = addPane(avatarId, avatarName, "");
    void openSession(row, paneId);
  };

  const deleteOneSession = async (row: SidebarSessionRow) => {
    const api = window.agenticxDesktop;
    if (typeof api.deleteSession !== "function") return;
    const confirmResult =
      typeof api.confirmDialog === "function"
        ? await api.confirmDialog({
            title: "确认删除会话",
            message: "确认删除该会话？",
            detail: "删除后不可恢复。",
            confirmText: "删除",
            cancelText: "取消",
            destructive: true,
          })
        : { ok: true, confirmed: window.confirm("确认删除该会话？删除后不可恢复。") };
    if (!confirmResult.confirmed) return;
    const result = await api.deleteSession(row.session_id);
    if (!result.ok) return;
    if (fileManageTarget?.sessionId === row.session_id) {
      setFileManageTarget(null);
    }
    clearDeletedSessionRefsInPanes([row.session_id]);
    dropCachedSessionMessages(row.session_id);
    bumpSessionCatalogRevision();
    window.setTimeout(() => bumpSessionCatalogRevision(), 450);
    await loadSessions();
  };

  const openMoreMenu = (row: SidebarSessionRow, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    setMoreMenu({
      sessionId: row.session_id,
      x: Math.max(8, rect.right - 180),
      y: rect.bottom + 4,
    });
  };

  const runMoreAction = async (action: string, row: SidebarSessionRow) => {
    setMoreMenu(null);
    if (action === "rename") {
      setEditingId(row.session_id);
      setEditingName(sidebarSessionLabel(row));
      return;
    }
    if (action === "toggle_pin") {
      await togglePinSession(row);
      return;
    }
    if (action === "fork") {
      const api = window.agenticxDesktop;
      if (typeof api.forkSession !== "function") return;
      const result = await api.forkSession({ sessionId: row.session_id });
      if (result.ok) {
        bumpSessionCatalogRevision();
        await loadSessions();
      }
      return;
    }
    if (action === "toggle_feishu_binding") {
      if (isAutomationPaneAvatarId(row.avatar_id)) return;
      const target = row.session_id;
      if (feishuBoundId === target) {
        await window.agenticxDesktop.saveFeishuDesktopBinding({ sessionId: null });
        setFeishuBoundId("");
      } else {
        const aid = String(row.avatar_id ?? "").trim();
        await window.agenticxDesktop.saveFeishuDesktopBinding({
          sessionId: target,
          avatarId: aid.startsWith("group:") ? null : aid || null,
          avatarName: row.avatar_name || null,
          provider: row.provider || null,
          model: row.model || null,
        });
        if (wechatBoundId === target) {
          await window.agenticxDesktop.saveWechatDesktopBinding({ sessionId: null });
          setWechatBoundId("");
        }
        setFeishuBoundId(target);
      }
      await loadBindings();
      return;
    }
    if (action === "toggle_wechat_binding") {
      if (isAutomationPaneAvatarId(row.avatar_id)) return;
      const target = row.session_id;
      if (wechatBoundId === target) {
        await window.agenticxDesktop.saveWechatDesktopBinding({ sessionId: null });
        setWechatBoundId("");
      } else {
        const aid = String(row.avatar_id ?? "").trim();
        await window.agenticxDesktop.saveWechatDesktopBinding({
          sessionId: target,
          avatarId: aid.startsWith("group:") ? null : aid || null,
          avatarName: row.avatar_name || null,
          provider: row.provider || null,
          model: row.model || null,
        });
        if (feishuBoundId === target) {
          await window.agenticxDesktop.saveFeishuDesktopBinding({ sessionId: null });
          setFeishuBoundId("");
        }
        setWechatBoundId(target);
      }
      await loadBindings();
      return;
    }
    if (action === "file_manage") {
      void openFileManage(row);
      return;
    }
    if (action === "delete") {
      void deleteOneSession(row);
      return;
    }
    if (action === "archive_prior") {
      const api = window.agenticxDesktop;
      if (typeof api.archiveSessions !== "function") return;
      const confirmResult =
        typeof api.confirmDialog === "function"
          ? await api.confirmDialog({
              title: "归档此前会话",
              message: "确认归档当前会话之前的历史会话吗？",
              confirmText: "归档",
              cancelText: "取消",
            })
          : { ok: true, confirmed: window.confirm("确认归档当前会话之前的历史会话吗？") };
      if (!confirmResult.confirmed) return;
      const result = await api.archiveSessions({
        sessionId: row.session_id,
        avatarId: row.avatar_id ?? null,
      });
      if (result.ok) {
        bumpSessionCatalogRevision();
        await loadSessions();
      }
    }
  };

  const renderRow = (row: SidebarSessionRow) => {
    const active = row.session_id === activeSessionId;
    const chip = resolveSidebarAvatarChipName(row, avatarNameById);
    const stripeColor = resolveSidebarChipStripeColor(row.avatar_id, avatars);
    const title = sidebarSessionLabel(row);
    const checked = selectedSessionIds.includes(row.session_id);
    const relative = formatSidebarRelativeTime(getSidebarSessionActivityTs(row));
    const menuOpen = moreMenu?.sessionId === row.session_id;
    const isEditing = editingId === row.session_id;
    const showHoverActions = !selectMode && !isEditing;
    const isRunning = row.execution_state === "running";
    const isInterrupted = row.execution_state === "interrupted";
    const loopScore = loopReviewScores[row.session_id];

    return (
      <div
        key={row.session_id}
        className={`group/row flex w-full items-center gap-1 rounded-md px-2 py-1.5 transition-colors ${
          active || checked || menuOpen ? "bg-surface-hover" : "hover:bg-surface-hover"
        }`}
      >
        {selectMode ? (
          <input
            type="checkbox"
            className="h-3.5 w-3.5 shrink-0 accent-[rgb(var(--theme-color-rgb,59,130,246))]"
            checked={checked}
            onChange={() => toggleSelectSession(row.session_id)}
            title="点击勾选"
            aria-label={`选择 ${title}`}
          />
        ) : null}
        {isEditing ? (
          <>
            <span
              className="relative shrink-0 overflow-hidden rounded px-1.5 py-px pl-2 text-[10px] font-medium leading-tight text-text-primary bg-surface-card"
              title={chip}
            >
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-[2px]"
                style={{ backgroundColor: stripeColor }}
              />
              {chip}
            </span>
            <input
              ref={renameInputRef}
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={() => void commitRename(row)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commitRename(row);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setEditingId(null);
                }
              }}
              className="min-w-0 flex-1 rounded border border-border bg-surface-card px-1.5 py-0.5 text-[12px] text-text-primary outline-none focus:border-[rgba(var(--theme-color-rgb,59,130,246),0.55)]"
              aria-label="重命名会话"
            />
          </>
        ) : (
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left text-[12px] text-text-primary"
            onClick={() => {
              if (selectMode) {
                toggleSelectSession(row.session_id);
                return;
              }
              void openSession(row);
            }}
            title={
              selectMode
                ? "点击勾选"
                : isRunning
                  ? `${chip} · ${title} · 正在生成`
                  : isInterrupted
                    ? `${chip} · ${title} · 已中断`
                    : `${chip} · ${title}`
            }
            aria-label={
              isRunning
                ? `${chip} ${title} · 正在生成`
                : isInterrupted
                  ? `${chip} ${title} · 已中断`
                  : `${chip} ${title}`
            }
          >
            <span
              className="relative shrink-0 overflow-hidden rounded px-1.5 py-px pl-2 text-[10px] font-medium leading-tight text-text-primary bg-surface-card"
            >
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-[2px]"
                style={{ backgroundColor: stripeColor }}
              />
              {chip}
            </span>
            {isRunning ? (
              <span
                className="flex h-4 w-4 shrink-0 items-center justify-center text-text-muted"
                title="正在生成"
                aria-label="正在生成"
              >
                <SessionGeneratingDots />
              </span>
            ) : null}
            {isInterrupted && !isRunning ? (
              <span
                className="inline-flex shrink-0 rounded-sm px-1 py-px text-[10px] font-medium leading-tight text-amber-300"
                title="该会话已收到中断请求"
              >
                已中断
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate">{title}</span>
            {loopScore !== undefined ? (
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  if (selectMode) return;
                  setLoopReviewFor(row.session_id);
                }}
                className={`inline-flex shrink-0 cursor-pointer items-center rounded-sm px-1 py-px text-[10px] font-semibold leading-tight tabular-nums ${
                  loopScore >= 80
                    ? "text-emerald-400"
                    : loopScore >= 60
                      ? "text-text-muted"
                      : "text-amber-400"
                }`}
                title={`会话体检 ${loopScore} / 100 · 点击查看`}
                aria-label={`会话体检 ${loopScore}`}
              >
                {loopScore}
              </span>
            ) : null}
          </button>
        )}
        {showHoverActions ? (
          <>
            <span
              className={`shrink-0 text-[11px] text-text-faint tabular-nums ${
                menuOpen ? "hidden" : "inline group-hover/row:hidden"
              }`}
            >
              {isRunning ? "" : relative}
            </span>
            <div
              className={`shrink-0 items-center gap-0.5 ${
                menuOpen ? "flex" : "hidden group-hover/row:flex"
              }`}
            >
              <HoverTip label="更多">
                <button
                  type="button"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-surface-card hover:text-text-strong"
                  onClick={(e) => {
                    e.stopPropagation();
                    openMoreMenu(row, e.currentTarget);
                  }}
                  aria-label="更多"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.8} />
                </button>
              </HoverTip>
              <HoverTip label="在新标签页打开">
                <button
                  type="button"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-[color,transform,background-color] duration-100 ease-out hover:bg-surface-card hover:text-text-strong active:scale-[0.96]"
                  onClick={(e) => {
                    e.stopPropagation();
                    openSessionInNewPane(row);
                  }}
                  aria-label="在新标签页打开"
                >
                  <SquareArrowOutUpRight className="h-3.5 w-3.5" strokeWidth={1.8} />
                </button>
              </HoverTip>
              <HoverTip label="文件管理">
                <button
                  type="button"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-surface-card hover:text-text-strong"
                  onClick={(e) => {
                    e.stopPropagation();
                    void openFileManage(row);
                  }}
                  aria-label="文件管理"
                >
                  <ListTree className="h-3.5 w-3.5" strokeWidth={1.8} />
                </button>
              </HoverTip>
            </div>
          </>
        ) : null}
      </div>
    );
  };

  const moreMenuRow = moreMenu
    ? sessions.find((s) => s.session_id === moreMenu.sessionId) ?? null
    : null;

  const sectionHeader = (
    key: keyof CollapseState,
    label: string,
    opts?: {
      accentClass?: string;
      badge?: { text: string; className: string };
      icon?: ReactNode;
      trailing?: ReactNode;
    }
  ) => (
    <div className="flex items-center gap-1 px-2 py-1">
      <button
        type="button"
        className={`flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] font-semibold tracking-[0.06em] ${
          opts?.accentClass ?? "text-text-faint"
        }`}
        onClick={() => toggleSection(key)}
      >
        {opts?.icon ? <span className="shrink-0">{opts.icon}</span> : null}
        <ChevronDown
          className={`h-3 w-3 shrink-0 transition-transform ${collapse[key] ? "-rotate-90" : ""}`}
          strokeWidth={2}
        />
        <span className="truncate uppercase">{label}</span>
        {opts?.badge ? (
          <span className={`inline-flex shrink-0 rounded-sm px-1 py-px text-[10px] font-medium ${opts.badge.className}`}>
            {opts.badge.text}
          </span>
        ) : null}
      </button>
      {opts?.trailing}
    </div>
  );

  const showFileManage = !!fileManageTarget;

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
      style={{ borderTop: "1px solid var(--border-muted)" }}
    >
      <div
        className={`absolute inset-0 flex min-h-0 flex-col transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${
          showFileManage ? "-translate-x-full pointer-events-none" : "translate-x-0"
        }`}
        aria-hidden={showFileManage}
      >
      <div className="flex items-center justify-end gap-1 px-2 pb-1 pt-2">
        {!selectMode ? (
          <>
            <button
              type="button"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-strong"
              onClick={() => {
                setSelectMode(true);
                setSelectedSessionIds([]);
                setFilterOpen(false);
              }}
              title="多选会话"
              aria-label="多选会话"
            >
              <ListChecks className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
            <button
              ref={filterBtnRef}
              type="button"
              className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors ${
                avatarFilter !== "all"
                  ? "bg-[rgba(var(--theme-color-rgb,59,130,246),0.14)] text-[rgb(var(--theme-color-fg-rgb,59,130,246))]"
                  : "text-text-muted hover:bg-surface-hover hover:text-text-strong"
              }`}
              onClick={openFilterMenu}
              title={`筛选历史（当前：${filterLabel}）`}
              aria-label="筛选历史对话"
            >
              <ListFilter className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text-strong disabled:opacity-50"
              onClick={toggleSelectAll}
              disabled={batchDeleting || selectableIds.length === 0}
              title="全选或取消全选"
            >
              {allSelectableSelected ? "取消全选" : "全选"}
            </button>
            <button
              type="button"
              className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-rose-400 hover:bg-surface-hover hover:text-rose-500 disabled:opacity-50"
              onClick={() => void deleteSelectedSessions()}
              disabled={batchDeleting || selectedSessionIds.length === 0}
              title={
                selectedSessionIds.length > 0
                  ? `删除 ${selectedSessionIds.length} 个会话`
                  : "先勾选会话"
              }
            >
              {batchDeleting
                ? "删除中..."
                : `删除${selectedSessionIds.length > 0 ? ` (${selectedSessionIds.length})` : ""}`}
            </button>
            <button
              type="button"
              className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text-strong disabled:opacity-50"
              onClick={() => {
                setSelectMode(false);
                setSelectedSessionIds([]);
              }}
              disabled={batchDeleting}
              title="取消多选"
            >
              取消
            </button>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3">
        {/* Projects stay above tasks. A project means the user selected a
            non-default workspace for that session; the default root remains a task. */}
        {projectRows.length > 0 ? (
          <>
            {sectionHeader("projects", "项目", {
              accentClass: "text-[rgb(var(--theme-color-fg-rgb,59,130,246))]",
              icon: <FolderKanban className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />,
              badge: {
                text: String(projectRows.length),
                className: "bg-[rgba(var(--theme-color-rgb,59,130,246),0.14)] text-[rgb(var(--theme-color-fg-rgb,59,130,246))]",
              },
            })}
            {!collapse.projects ? (
              <div className="mb-2">
                {visibleProjectRows.map((row) => renderRow(row))}
              </div>
            ) : null}
          </>
        ) : null}

        {taskRowCount > 0 ? (
          <>
            {sectionHeader("tasks", "任务", {
              accentClass: "text-text-faint",
              icon: <ListTodo className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />,
              badge: {
                text: String(taskRowCount),
                className: "bg-surface-card text-text-faint",
              },
            })}
            {!collapse.tasks ? (
              <div>
                {SHOW_DESKTOP_EXTERNAL_IM && wechatRow ? (
                  <>
                    {sectionHeader("wechat", "微信 IM", {
                      accentClass: "text-[#25D366]",
                      badge: wechatBoundId
                        ? {
                            text: "已绑定",
                            className: "bg-[rgba(37,211,102,0.15)] text-[#25D366]",
                          }
                        : undefined,
                    })}
                    {!collapse.wechat ? (
                      <div className="mb-1">{renderRow(wechatRow)}</div>
                    ) : null}
                  </>
                ) : null}

                {SHOW_DESKTOP_EXTERNAL_IM && feishuRow ? (
                  <>
                    {sectionHeader("feishu", "飞书 IM", {
                      accentClass: "text-[#3370FF]",
                      badge: feishuBoundId
                        ? {
                            text: "已绑定",
                            className: "bg-[rgba(51,112,255,0.15)] text-[#3370FF]",
                          }
                        : undefined,
                    })}
                    {!collapse.feishu ? (
                      <div className="mb-1">{renderRow(feishuRow)}</div>
                    ) : null}
                  </>
                ) : null}

                {taskBuckets.pinned.length > 0 ? sectionHeader("pinned", "置顶") : null}
                {taskBuckets.pinned.length > 0 && !collapse.pinned ? (
                  <div className="mb-1">
                    {taskBuckets.pinned.map((row) => renderRow(row))}
                  </div>
                ) : null}

                {taskTodayVisible.length > 0 ? sectionHeader("today", "今天") : null}
                {taskTodayVisible.length > 0 && !collapse.today ? (
                  <div className="mb-1">
                    {taskTodayVisible.map((row) => renderRow(row))}
                  </div>
                ) : null}

                {taskYesterdayVisible.length > 0 ? sectionHeader("yesterday", "昨天") : null}
                {taskYesterdayVisible.length > 0 && !collapse.yesterday ? (
                  <div className="mb-1">
                    {taskYesterdayVisible.map((row) => renderRow(row))}
                  </div>
                ) : null}

                {taskRecentVisible.length > 0 ? sectionHeader("recent", "过去 7 天") : null}
                {taskRecentVisible.length > 0 && !collapse.recent ? (
                  <div className="mb-1">
                    {taskRecentVisible.map((row) => renderRow(row))}
                  </div>
                ) : null}

                {taskEarlierVisible.length > 0 ? sectionHeader("earlier", "更早") : null}
                {taskEarlierVisible.length > 0 && !collapse.earlier ? (
                  <div className="mb-1">
                    {taskEarlierVisible.map((row) => renderRow(row))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        {!hasStandardHistory ? (
          <div className="px-2 py-3 text-[11px] text-text-faint">暂无历史对话</div>
        ) : null}

        {hasMore ? (
          <button
            type="button"
            className="mx-2 mt-1 w-[calc(100%-1rem)] rounded-md px-2 py-1.5 text-left text-[12px] text-[rgb(var(--theme-color-fg-rgb,59,130,246))] hover:bg-surface-hover"
            onClick={() => setVisibleLimit((n) => n + SIDEBAR_HISTORY_PAGE_SIZE)}
          >
            显示更多
          </button>
        ) : null}
      </div>
      </div>

      <div
        className={`absolute inset-0 flex min-h-0 flex-col transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${
          showFileManage ? "translate-x-0" : "translate-x-full pointer-events-none"
        }`}
        aria-hidden={!showFileManage}
      >
        {fileManageTarget ? (
          <SidebarSessionFileManage
            paneId={fileManageTarget.paneId}
            sessionId={fileManageTarget.sessionId}
            onBack={() => setFileManageTarget(null)}
          />
        ) : null}
      </div>

      {filterOpen && filterMenuPos
        ? createPortal(
            <div
              ref={filterMenuRef}
              className="fixed z-[220] max-h-64 w-[140px] overflow-y-auto rounded-md border border-border bg-surface-base py-1 shadow-2xl"
              style={{ left: filterMenuPos.left, top: filterMenuPos.top }}
            >
              {filterOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`w-full truncate px-3 py-1.5 text-left text-[12px] transition ${
                    avatarFilter === opt.id
                      ? "bg-surface-hover text-text-strong"
                      : "text-text-muted hover:bg-surface-hover"
                  }`}
                  onClick={() => {
                    setAvatarFilter(opt.id);
                    setVisibleLimit(SIDEBAR_HISTORY_PAGE_SIZE);
                    setFilterOpen(false);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}

      {moreMenu && moreMenuRow
        ? createPortal(
            <div
              ref={moreMenuRef}
              className="fixed z-[230] w-[200px] rounded-xl border border-border bg-surface-base p-1 shadow-2xl"
              style={{ left: moreMenu.x, top: moreMenu.y, visibility: "hidden" }}
              onClick={(e) => e.stopPropagation()}
            >
              {(
                [
                  { id: "rename" as const, label: "重命名", icon: Pencil, danger: false },
                  {
                    id: "toggle_pin" as const,
                    label: moreMenuRow.pinned ? "取消置顶" : "置顶",
                    icon: Pin,
                    danger: false,
                  },
                  { id: "file_manage" as const, label: "文件管理", icon: ListTree, danger: false },
                  { id: "fork" as const, label: "分叉会话", icon: GitBranch, danger: false },
                  ...(!isAutomationPaneAvatarId(moreMenuRow.avatar_id)
                    ? [
                        {
                          id: "toggle_feishu_binding" as const,
                          label:
                            feishuBoundId === moreMenuRow.session_id
                              ? "取消绑定飞书"
                              : "绑定为飞书会话",
                          icon: MessageSquare,
                          danger: false,
                        },
                        {
                          id: "toggle_wechat_binding" as const,
                          label:
                            wechatBoundId === moreMenuRow.session_id
                              ? "取消绑定微信"
                              : "绑定为微信会话",
                          icon: Smartphone,
                          danger: false,
                        },
                      ]
                    : []),
                  { id: "archive_prior" as const, label: "归档此前会话", icon: Archive, danger: false },
                  { id: "delete" as const, label: "删除会话", icon: Trash2, danger: true },
                ]
              ).map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-surface-hover ${
                      item.danger ? "text-rose-400 hover:text-rose-500" : "text-text-primary"
                    }`}
                    onClick={() => void runMoreAction(item.id, moreMenuRow)}
                  >
                    <Icon
                      className={`h-3.5 w-3.5 shrink-0 ${
                        item.danger
                          ? "text-rose-400"
                          : item.id === "toggle_pin" && moreMenuRow.pinned
                            ? "text-amber-400"
                            : "text-text-faint"
                      }`}
                      strokeWidth={1.75}
                    />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}

      {loopReviewFor
        ? createPortal(
            <div
              className="fixed inset-0 z-[240] flex items-start justify-center bg-black/70 pt-[12vh] backdrop-blur-none"
              onClick={() => setLoopReviewFor(null)}
            >
              <div onClick={(e) => e.stopPropagation()}>
                <LoopReviewCard sessionId={loopReviewFor} onClose={() => setLoopReviewFor(null)} />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
