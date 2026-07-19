import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  FilePlus,
  Folder,
  FolderPlus,
  List,
  ListTree,
  MoreHorizontal,
  PanelRight,
  RefreshCw,
  Terminal,
} from "lucide-react";
import { createPortal } from "react-dom";
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import type { Taskspace } from "../store";
import { useAppStore } from "../store";
import { createResizeRafScheduler } from "../utils/resize-raf";
import { ContextMenu } from "./ContextMenu";
import { TerminalEmbed } from "./TerminalEmbed";
import { getRememberedSessionForAvatar } from "../utils/avatar-last-session";
import { isPaneAwaitingFreshSession } from "../utils/pane-fresh-session";
import { shouldKeepWorkspaceVisibleWhenSessionMissing } from "../utils/workspace-session-visibility";
import {
  findTaskspaceForAbsPath,
  parentDirectory,
  relativePathFromRoot,
  absoluteTaskspacePath,
} from "../utils/workspace-file-path";
import { stripLineRangeFromAbsPath } from "../utils/chat-file-mention";
import {
  encodeNearWorkspaceDragEntry,
  NEAR_WORKSPACE_DRAG_MIME,
  type NearWorkspaceDragEntry,
} from "../utils/workspace-drag";
import { WorkspaceFilePreview } from "./workspace/WorkspaceFilePreview";
import {
  mapSystemSearchPreviewToWorkspacePreview,
  mapTaskspaceFileToWorkspacePreview,
  previewCopyText,
  type WorkspacePreviewOpenRequest,
  type WorkspacePreviewQuotePayload,
  type WorkspacePreview,
} from "./workspace/workspace-preview-types";
import {
  formatTaskspaceAddError,
  isTaskspaceAtLimit,
} from "../utils/taskspace-errors";
import { RUNTIME_DEFAULT_TASKSPACES } from "./automation/RuntimeConfigSection";

type TaskspaceFile = {
  name: string;
  type: "file" | "dir";
  path: string;
  size: number;
  modified: number;
};

type Props = {
  paneId: string;
  sessionId: string;
  activeTaskspaceId: string | null;
  onActiveTaskspaceChange: (taskspaceId: string | null) => void;
  onPickFileForReference?: (taskspaceId: string, path: string) => void;
  onPickDirectoryForReference?: (payload: {
    taskspaceId: string;
    relPath: string;
    label: string;
  }) => void;
  autoRefreshKey?: number;
  onClose?: () => void;
  /** Sidebar file-manage mode: replace title with back control (Trae-style). */
  backAction?: { label: string; onClick: () => void };
  tintColor?: string;
  onQuotePreviewSnippet?: (payload: WorkspacePreviewQuotePayload) => void;
  /** Absolute path (+ optional line range) requested from chat (@file chip / path click). */
  previewOpenRequest?: WorkspacePreviewOpenRequest | null;
  onPreviewOpenRequestHandled?: () => void;
  /** Materialize a lazy fresh session before adding workspace dirs (same params as first send). */
  onEnsureSessionForWorkspace?: () => Promise<string | null>;
};

type CtxMenuState =
  | { kind: "taskspace"; x: number; y: number; taskspace: Taskspace }
  | { kind: "entry"; x: number; y: number; taskspace: Taskspace; entry: TaskspaceFile };
type SessionListItem = {
  session_id: string;
  avatar_id: string | null;
  updated_at: number;
  created_at?: number;
  archived?: boolean;
};

type OpenTerminalEventDetail = {
  cwd?: string;
  command?: string;
};

function isSessionAvatarMatch(item: SessionListItem, avatarId?: string | null): boolean {
  const targetAvatarId = (avatarId ?? "").trim();
  const itemAvatarId = String(item.avatar_id ?? "").trim();
  if (!targetAvatarId) return itemAvatarId.length === 0;
  return itemAvatarId === targetAvatarId;
}

function pickMostRecentSessionId(
  sessions: SessionListItem[],
  avatarId?: string | null
): string | undefined {
  const sorted = [...sessions]
    .filter((item) => {
      const sid = String(item.session_id ?? "").trim();
      if (!sid) return false;
      if (item.archived === true) return false;
      return isSessionAvatarMatch(item, avatarId);
    })
    .sort((a, b) => {
      const ua = Number.isFinite(a.updated_at) ? a.updated_at : 0;
      const ub = Number.isFinite(b.updated_at) ? b.updated_at : 0;
      if (ub !== ua) return ub - ua;
      const ca = Number.isFinite(a.created_at ?? Number.NaN) ? (a.created_at as number) : 0;
      const cb = Number.isFinite(b.created_at ?? Number.NaN) ? (b.created_at as number) : 0;
      return cb - ca;
    });
  const sid = sorted[0]?.session_id;
  return sid ? String(sid).trim() : undefined;
}

function nodeKey(taskspaceId: string, relPath: string): string {
  return `${taskspaceId}:${relPath || "."}`;
}

function taskspaceReferenceLabel(taskspace: Taskspace): string {
  if (taskspace.id !== "default") {
    return taskspace.label || taskspace.path.split(/[\\/]/).filter(Boolean).pop() || "工作区";
  }
  return taskspace.path.split(/[\\/]/).filter(Boolean).pop() || taskspace.label || "默认工作区";
}

function startWorkspaceEntryDrag(e: ReactDragEvent, entry: NearWorkspaceDragEntry) {
  e.dataTransfer.effectAllowed = "copy";
  e.dataTransfer.setData(NEAR_WORKSPACE_DRAG_MIME, encodeNearWorkspaceDragEntry(entry));
}

function terminalCwdForEntry(taskspace: Taskspace, entry: TaskspaceFile): string {
  const root = (taskspace.path || "").trim();
  if (!root) return "";
  if (entry.type === "dir") {
    return absoluteTaskspacePath(root, entry.path);
  }
  const rel = entry.path.replace(/\\/g, "/");
  const idx = rel.lastIndexOf("/");
  const parent = idx === -1 ? "." : rel.slice(0, idx);
  return absoluteTaskspacePath(root, parent);
}

export function WorkspacePanel({
  paneId,
  sessionId,
  activeTaskspaceId,
  onActiveTaskspaceChange,
  onPickFileForReference,
  onPickDirectoryForReference,
  autoRefreshKey,
  onClose,
  backAction,
  tintColor,
  onQuotePreviewSnippet,
  previewOpenRequest,
  onPreviewOpenRequestHandled,
  onEnsureSessionForWorkspace,
}: Props) {
  const addPaneTerminalTab = useAppStore((s) => s.addPaneTerminalTab);
  const removePaneTerminalTab = useAppStore((s) => s.removePaneTerminalTab);
  const setActivePaneTerminalTab = useAppStore((s) => s.setActivePaneTerminalTab);
  const terminalTabs = useAppStore((s) => s.panes.find((p) => p.id === paneId)?.terminalTabs ?? []);
  const activeTerminalTabId = useAppStore((s) => s.panes.find((p) => p.id === paneId)?.activeTerminalTabId ?? null);
  const paneAvatarId = useAppStore((s) => s.panes.find((p) => p.id === paneId)?.avatarId ?? null);
  const paneAvatarName = useAppStore((s) => s.panes.find((p) => p.id === paneId)?.avatarName ?? "");
  const setPaneSessionId = useAppStore((s) => s.setPaneSessionId);

  const corePreloadAttempted = useAppStore((s) => s.corePreloadAttempted);
  const preloadedTaskspacesBySessionId = useAppStore((s) => s.preloadedTaskspacesBySessionId);

  const [taskspaces, setTaskspaces] = useState<Taskspace[]>([]);
  const [workspaceLoadedOnce, setWorkspaceLoadedOnce] = useState(false);
  // Bumped when the backend signals studio-ready so the no-session recovery
  // effects re-run: on a slow cold start the first listSessions fires before
  // the backend answers, and without this the workspace would stay in its
  // empty state until an unrelated re-render.
  const [recoverTick, setRecoverTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [entriesByDir, setEntriesByDir] = useState<Record<string, TaskspaceFile[]>>({});
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [filePreview, setFilePreview] = useState<WorkspacePreview | null>(null);
  const [previewAnchor, setPreviewAnchor] = useState<{ top: number; bottom: number; left: number } | null>(null);
  const [previewFocusLineRange, setPreviewFocusLineRange] = useState<{ start: number; end: number } | null>(null);
  const [previewCopied, setPreviewCopied] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [maxTaskspaces, setMaxTaskspaces] = useState(RUNTIME_DEFAULT_TASKSPACES);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [hostPlatform, setHostPlatform] = useState<string | null>(null);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"tree" | "list">("tree");
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [viewMenuPos, setViewMenuPos] = useState<{ left: number; top: number } | null>(null);
  const [moreMenuPos, setMoreMenuPos] = useState<{ left: number; top: number } | null>(null);
  const viewBtnRef = useRef<HTMLButtonElement | null>(null);
  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const fallbackBrowseSessionIdRef = useRef<string>("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const awaitingFreshSession = isPaneAwaitingFreshSession(paneId);
  const isSidebarEmbed = !!backAction;
  const getBrowseSessionId = () => {
    const direct = String(sessionId ?? "").trim();
    if (direct) return direct;
    if (awaitingFreshSession) {
      return String(fallbackBrowseSessionIdRef.current ?? "").trim();
    }
    return "";
  };

  const [panelHeight, setPanelHeight] = useState(0);
  const [terminalAreaHeight, setTerminalAreaHeight] = useState(0);
  const terminalUserResized = useRef(false);

  const activeTaskspace = useMemo(
    () => taskspaces.find((item) => item.id === activeTaskspaceId) ?? taskspaces[0] ?? null,
    [taskspaces, activeTaskspaceId]
  );
  const taskspaceAtLimit = useMemo(
    () => isTaskspaceAtLimit(taskspaces, maxTaskspaces),
    [taskspaces, maxTaskspaces],
  );
  /** Conversation-attached folders (sidebar file-manage hides shared default root). */
  const visibleTaskspaces = useMemo(() => {
    if (!isSidebarEmbed) return taskspaces;
    return taskspaces.filter((t) => t.id !== "default");
  }, [isSidebarEmbed, taskspaces]);
  const showConversationEmpty =
    isSidebarEmbed && workspaceLoadedOnce && !loading && visibleTaskspaces.length === 0;

  const listViewFiles = useMemo(() => {
    if (viewMode !== "list" || !isSidebarEmbed) return null;
    const results: { taskspaceId: string; file: TaskspaceFile }[] = [];
    for (const ts of visibleTaskspaces) {
      const entries = entriesByDir[nodeKey(ts.id, ".")] ?? [];
      for (const entry of entries) {
        if (entry.type === "file") {
          results.push({ taskspaceId: ts.id, file: entry });
        }
      }
    }
    return results;
  }, [viewMode, isSidebarEmbed, visibleTaskspaces, entriesByDir]);

  useEffect(() => {
    let disposed = false;
    const loadLimit = async () => {
      try {
        const result = await window.agenticxDesktop.loadRuntimeConfig();
        if (!disposed && result?.ok && Number.isFinite(result.max_taskspaces)) {
          setMaxTaskspaces(result.max_taskspaces);
        }
      } catch {
        // keep default fallback
      }
    };
    void loadLimit();
    return () => {
      disposed = true;
    };
  }, []);

  const previewTaskspaceRoot = useMemo(() => {
    if (!filePreview) return undefined;
    const matched = findTaskspaceForAbsPath(taskspaces, filePreview.absolutePath);
    if (matched) {
      return taskspaces.find((t) => t.id === matched.taskspaceId)?.path;
    }
    return activeTaskspace?.path;
  }, [filePreview, taskspaces, activeTaskspace]);

  const revealInFileManagerLabel = useMemo(() => {
    if (hostPlatform === "darwin") return "在访达中显示";
    if (hostPlatform === "win32") return "在文件资源管理器中显示";
    return "打开所在文件夹";
  }, [hostPlatform]);

  const filteredFiles = useMemo(() => {
    const q = fileSearchQuery.trim().toLowerCase();
    if (!q) return null;
    const results: { taskspaceId: string; file: TaskspaceFile }[] = [];
    for (const [key, entries] of Object.entries(entriesByDir)) {
      const taskspaceId = key.split(":")[0];
      for (const entry of entries) {
        if (entry.type === "file" && entry.name.toLowerCase().includes(q)) {
          results.push({ taskspaceId, file: entry });
        }
      }
    }
    return results;
  }, [fileSearchQuery, entriesByDir]);

  const maxTerminalHeight = panelHeight > 0 ? Math.floor(panelHeight * 0.7) : 520;
  const minTerminalHeight = 140;
  const safeTerminalHeight = Math.max(minTerminalHeight, Math.min(maxTerminalHeight, terminalAreaHeight));

  useEffect(() => {
    if (panelHeight <= 0) return;
    if (!terminalUserResized.current) {
      const initial = Math.floor(panelHeight * 0.42);
      setTerminalAreaHeight(Math.max(minTerminalHeight, Math.min(maxTerminalHeight, initial)));
    } else {
      setTerminalAreaHeight((prev) => Math.max(minTerminalHeight, Math.min(maxTerminalHeight, prev)));
    }
  }, [panelHeight, maxTerminalHeight]);

  // Anchor the floating preview to the left edge of the workspace panel
  // (Codex-style pop-out) so it isn't clipped by the panel's overflow.
  useLayoutEffect(() => {
    if (!filePreview) {
      setPreviewAnchor(null);
      return;
    }
    const recompute = () => {
      const el = panelRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPreviewAnchor({ top: r.top, bottom: r.bottom, left: r.left });
    };
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, [filePreview]);

  useEffect(() => {
    if (!filePreview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFilePreview(null);
        setPreviewFocusLineRange(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filePreview]);

  useEffect(() => {
    setPreviewCopied(false);
  }, [filePreview?.path]);

  const loadTaskspaces = async (): Promise<Taskspace[] | undefined> => {
    const browseSessionId = getBrowseSessionId();
    if (!browseSessionId) return undefined;
    setLoading(true);
    if (corePreloadAttempted && preloadedTaskspacesBySessionId[browseSessionId]) {
      const workspaces = preloadedTaskspacesBySessionId[browseSessionId];
      setTaskspaces(workspaces);
      if (workspaces.length > 0) {
        const active = workspaces.find((item) => item.id === activeTaskspaceId) ?? workspaces[0];
        if (!workspaces.some((item) => item.id === activeTaskspaceId)) {
          onActiveTaskspaceChange(active.id);
        }
      }
      setWorkspaceLoadedOnce(true);
      setLoading(false);
      return workspaces;
    }
    const result = await window.agenticxDesktop.listTaskspaces(browseSessionId);
    if (!result.ok) {
      setErrorText(result.error ?? "加载工作区失败");
      setLoading(false);
      return undefined;
    }
    const workspaces = Array.isArray(result.workspaces) ? result.workspaces : [];
    setTaskspaces(workspaces);
    if (workspaces.length > 0) {
      const active = workspaces.find((item) => item.id === activeTaskspaceId) ?? workspaces[0];
      if (!workspaces.some((item) => item.id === activeTaskspaceId)) {
        onActiveTaskspaceChange(active.id);
      }
    }
    setWorkspaceLoadedOnce(true);
    setLoading(false);
    return workspaces;
  };

  const loadDir = async (taskspaceId: string, relPath = ".", force = false) => {
    const browseSessionId = getBrowseSessionId();
    if (!browseSessionId) return;
    const key = nodeKey(taskspaceId, relPath);
    if (!force && entriesByDir[key]) return;
    const result = await window.agenticxDesktop.listTaskspaceFiles({ sessionId: browseSessionId, taskspaceId, path: relPath });
    if (!result.ok) {
      if ((result.error ?? "").includes("session not found")) return;
      setErrorText(result.error ?? "读取目录失败");
      return;
    }
    setEntriesByDir((prev) => ({ ...prev, [key]: result.files ?? [] }));
  };

  const refreshTaskspace = async (taskspaceId: string) => {
    const prefix = `${taskspaceId}:`;
    const expandedPaths = Array.from(expandedDirs)
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
    const uniquePaths = Array.from(new Set([".", ...expandedPaths]));
    await Promise.all(uniquePaths.map((path) => loadDir(taskspaceId, path, true)));
  };

  const refreshListAndActiveTaskspace = async () => {
    const workspaces = await loadTaskspaces();
    if (!workspaces?.length) return;
    await Promise.all(
      workspaces.map((ts) => {
        const key = nodeKey(ts.id, ".");
        if (expandedDirs.has(key)) {
          return refreshTaskspace(ts.id);
        }
        return Promise.resolve();
      })
    );
  };

  useEffect(() => {
    void window.agenticxDesktop
      .platform()
      .then((p) => setHostPlatform(p))
      .catch(() => setHostPlatform(null));
  }, []);

  // Retry no-session recovery once the backend becomes ready. On a large-data
  // cold start the first recovery attempt can run before agx serve answers;
  // bumping recoverTick re-runs the recovery effects so the workspace self-heals
  // without any manual action.
  useEffect(() => {
    const off = window.agenticxDesktop.onStudioReady?.(() => {
      setRecoverTick((tick) => tick + 1);
    });
    return off;
  }, []);

  useEffect(() => {
    const sid = String(sessionId ?? "").trim();
    if (sid) {
      fallbackBrowseSessionIdRef.current = sid;
    }
  }, [sessionId]);

  useEffect(() => {
    if (sessionId) return;
    if (!awaitingFreshSession) return;
    if (fallbackBrowseSessionIdRef.current) {
      void loadTaskspaces();
      return;
    }
    let cancelled = false;
    void (async () => {
      const listed = await window.agenticxDesktop
        .listSessions(paneAvatarId ?? undefined)
        .catch(() => ({ ok: false, sessions: [] as SessionListItem[] }));
      if (cancelled) return;
      if (!listed.ok || !Array.isArray(listed.sessions)) {
        // Backend not ready / errored: end the skeleton so the panel shows a
        // clear empty state instead of spinning forever. onStudioReady bumps
        // recoverTick to retry once the backend is up.
        setWorkspaceLoadedOnce(true);
        return;
      }
      const rememberedSid = getRememberedSessionForAvatar(paneAvatarId);
      const rememberedValid =
        !!rememberedSid &&
        listed.sessions.some(
          (item) =>
            String(item.session_id ?? "").trim() === rememberedSid &&
            isSessionAvatarMatch(item, paneAvatarId)
        );
      const recentSid = pickMostRecentSessionId(listed.sessions, paneAvatarId);
      const preferredSid = rememberedValid ? rememberedSid ?? undefined : recentSid;
      if (cancelled) return;
      if (!preferredSid) {
        setWorkspaceLoadedOnce(true);
        return;
      }
      fallbackBrowseSessionIdRef.current = preferredSid;
      await loadTaskspaces();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, awaitingFreshSession, paneAvatarId, recoverTick]);

  useEffect(() => {
    if (!sessionId) {
      if (shouldKeepWorkspaceVisibleWhenSessionMissing(sessionId, isPaneAwaitingFreshSession(paneId))) {
        return;
      }
      setTaskspaces([]);
      setExpandedDirs(new Set());
      setEntriesByDir({});
      setSelectedFilePath("");
      setFilePreview(null);
      setErrorText("");
      return;
    }
    // Per-session workspace: clear tree cache when switching conversations.
    setEntriesByDir({});
    setExpandedDirs(new Set());
    setSelectedFilePath("");
    setFileSearchQuery("");
    void loadTaskspaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (!viewMenuOpen && !moreMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (viewBtnRef.current?.contains(t)) return;
      if (moreBtnRef.current?.contains(t)) return;
      const el = t instanceof Element ? t : null;
      if (el?.closest?.("[data-workspace-view-menu],[data-workspace-more-menu]")) return;
      setViewMenuOpen(false);
      setMoreMenuOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setViewMenuOpen(false);
        setMoreMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [viewMenuOpen, moreMenuOpen]);

  useEffect(() => {
    if (!isSidebarEmbed || viewMode !== "list") return;
    for (const ts of visibleTaskspaces) {
      void loadDir(ts.id, ".");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSidebarEmbed, viewMode, visibleTaskspaces.map((t) => t.id).join("|")]);

  useEffect(() => {
    if (sessionId) return;
    // Respect explicit "new topic" intent: user just cleared the pane to get
    // a fresh lazy session; do NOT auto-restore the previous (possibly
    // still-running) session, otherwise the next send would be queued into
    // the old task instead of starting a truly new conversation.
    if (isPaneAwaitingFreshSession(paneId)) return;
    let cancelled = false;
    void (async () => {
      const listed = await window.agenticxDesktop
        .listSessions(paneAvatarId ?? undefined)
        .catch(() => ({ ok: false, sessions: [] as SessionListItem[] }));
      if (cancelled) return;
      if (!listed.ok || !Array.isArray(listed.sessions)) {
        // Backend not ready / errored: end the skeleton so the panel shows a
        // clear empty state instead of spinning forever. onStudioReady bumps
        // recoverTick to retry once the backend is up.
        setWorkspaceLoadedOnce(true);
        return;
      }
      const rememberedSid = getRememberedSessionForAvatar(paneAvatarId);
      const rememberedValid =
        !!rememberedSid &&
        listed.sessions.some(
          (item) =>
            String(item.session_id ?? "").trim() === rememberedSid &&
            isSessionAvatarMatch(item, paneAvatarId)
        );
      const recentSid = pickMostRecentSessionId(listed.sessions, paneAvatarId);
      const preferredSid = rememberedValid ? rememberedSid ?? undefined : recentSid;
      if (cancelled) return;
      if (!preferredSid) {
        // No recoverable session for this pane: end the skeleton and let the
        // render fall through to the "no session" empty state.
        setWorkspaceLoadedOnce(true);
        return;
      }
      if (isPaneAwaitingFreshSession(paneId)) return;
      const latestPane = useAppStore.getState().panes.find((item) => item.id === paneId);
      const latestSid = String(latestPane?.sessionId ?? "").trim();
      if (!latestSid) {
        setPaneSessionId(paneId, preferredSid);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, paneAvatarId, paneId, setPaneSessionId, recoverTick]);


  useEffect(() => {
    const browseSessionId = getBrowseSessionId();
    if (!browseSessionId) return;
    const timer = window.setInterval(() => {
      taskspaces.forEach((ts) => {
        const key = nodeKey(ts.id, ".");
        if (expandedDirs.has(key)) {
          void refreshTaskspace(ts.id);
        }
      });
    }, 3000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, awaitingFreshSession, taskspaces, expandedDirs]);

  useEffect(() => {
    const browseSessionId = getBrowseSessionId();
    if (!browseSessionId) return;
    if (typeof autoRefreshKey !== "number" || autoRefreshKey <= 0) return;
    void refreshListAndActiveTaskspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefreshKey, sessionId, awaitingFreshSession]);

  useLayoutEffect(() => {
    const element = panelRef.current;
    if (!element) return;
    const syncHeight = () => setPanelHeight(element.clientHeight);
    const { schedule, cancel } = createResizeRafScheduler(syncHeight);
    syncHeight();
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    return () => {
      cancel();
      observer.disconnect();
    };
  }, []);

  const addTaskspace = async (pathValue: string, labelValue: string) => {
    setAdding(true);
    let effectiveSessionId = sessionId;
    if (!effectiveSessionId) {
      const isGroupOrAutomationPane =
        !!paneAvatarId && (paneAvatarId.startsWith("group:") || paneAvatarId.startsWith("automation:"));
      if (isGroupOrAutomationPane) {
        setAdding(false);
        setErrorText("会话正在初始化，请稍候再试");
        return;
      }
      if (isPaneAwaitingFreshSession(paneId)) {
        if (typeof onEnsureSessionForWorkspace === "function") {
          try {
            const ensured = await onEnsureSessionForWorkspace();
            if (!ensured) {
              setAdding(false);
              setErrorText("创建会话失败，无法添加工作区");
              return;
            }
            effectiveSessionId = ensured;
          } catch (err) {
            setAdding(false);
            setErrorText(`创建会话失败：${String(err)}`);
            return;
          }
        } else {
          setAdding(false);
          setErrorText("请先发送一条消息，再添加工作区目录");
          return;
        }
      } else {
        try {
          const createPayload: { avatar_id?: string; name?: string } = {};
          if (paneAvatarId) createPayload.avatar_id = paneAvatarId;
          if (paneAvatarName) createPayload.name = paneAvatarName;
          const created = await window.agenticxDesktop.createSession(createPayload);
          if (!created.ok || !created.session_id) {
            setAdding(false);
            setErrorText(created.error ?? "创建会话失败，无法添加工作区");
            return;
          }
          effectiveSessionId = created.session_id;
          setPaneSessionId(paneId, effectiveSessionId);
        } catch (err) {
          setAdding(false);
          setErrorText(`创建会话失败：${String(err)}`);
          return;
        }
      }
    }
    const result = await window.agenticxDesktop.addTaskspace({
      sessionId: effectiveSessionId,
      path: pathValue.trim() || undefined,
      label: labelValue.trim() || undefined,
    });
    setAdding(false);
    if (!result.ok) {
      setErrorText(formatTaskspaceAddError(result.error, maxTaskspaces));
      return;
    }
    setErrorText("");
    setShowAddForm(false);
    setNewPath("");
    setNewLabel("");
    await loadTaskspaces();
  };

  const removeTaskspace = async (taskspaceId: string) => {
    const desktop = window.agenticxDesktop;
    const confirmResult =
      typeof desktop.confirmDialog === "function"
        ? await desktop.confirmDialog({
            title: "确认移除工作区",
            message: "确认移除该工作区吗？",
            detail: "该操作仅移除关联，不会删除本地文件。",
            confirmText: "移除",
            cancelText: "取消",
            destructive: true,
          })
        : { ok: true, confirmed: window.confirm("确认移除该工作区吗？") };
    const confirmed = !!confirmResult.confirmed;
    if (!confirmed) return;
    const result = await desktop.removeTaskspace({ sessionId, taskspaceId });
    if (!result.ok) {
      setErrorText(result.error ?? "移除工作区失败");
      return;
    }
    await loadTaskspaces();
  };

  const openTerminalForPath = (absPath: string, labelHint?: string) => {
    const p = (absPath || "").trim();
    if (!p) {
      setErrorText("无法打开终端：目录路径无效");
      return;
    }
    setErrorText("");
    addPaneTerminalTab(paneId, p, labelHint);
  };

  useEffect(() => {
    const onOpenTerminalEvent = (event: Event) => {
      const custom = event as CustomEvent<OpenTerminalEventDetail>;
      const detail = custom.detail ?? {};
      const candidate = String(detail.cwd ?? "").trim();
      const fallback = String(activeTaskspace?.path ?? taskspaces[0]?.path ?? "").trim();
      const cwd = candidate || fallback;
      if (!cwd) {
        setErrorText("无法打开终端：未提供可用目录");
        return;
      }
      openTerminalForPath(cwd, "授权");
    };
    window.addEventListener("agx:open-terminal", onOpenTerminalEvent as EventListener);
    return () => {
      window.removeEventListener("agx:open-terminal", onOpenTerminalEvent as EventListener);
    };
  }, [activeTaskspace?.path, paneId, taskspaces]);

  const revealInFileManager = async (absPath: string) => {
    const p = (absPath || "").trim();
    if (!p) {
      setErrorText("无法在文件管理器中显示：路径无效");
      return;
    }
    setErrorText("");
    const api = window.agenticxDesktop;
    if (typeof api.shellShowItemInFolder !== "function") {
      setErrorText("当前客户端不支持在文件管理器中显示");
      return;
    }
    const res = await api.shellShowItemInFolder(p);
    if (!res.ok) {
      setErrorText(res.error ?? "无法在文件管理器中显示");
    }
  };

  const chooseDirectoryForTaskspace = async () => {
    try {
      const picker = window.agenticxDesktop.chooseDirectory;
      if (typeof picker !== "function") {
        setErrorText("当前客户端不支持目录选择，请重启桌面端后重试。");
        return;
      }
      const picked = await picker();
      if (!picked.ok) {
        if (!picked.canceled) {
          setErrorText(picked.error ?? "目录选择失败，请重试。");
        }
        return;
      }
      if (!picked.path) {
        setErrorText("目录选择失败：未返回有效路径。");
        return;
      }
      setErrorText("");
      setNewPath(picked.path);
      if (!newLabel.trim()) {
        const bits = picked.path.split("/").filter(Boolean);
        setNewLabel(bits[bits.length - 1] || "");
      }
    } catch (err) {
      setErrorText(`目录选择失败：${String(err)}`);
    }
  };

  const pickAndAttachDirectory = async () => {
    setMoreMenuOpen(false);
    if (taskspaceAtLimit) {
      setErrorText(formatTaskspaceAddError(`taskspace limit reached (${maxTaskspaces})`, maxTaskspaces));
      return;
    }
    try {
      const picker = window.agenticxDesktop.chooseDirectory;
      if (typeof picker !== "function") {
        setErrorText("当前客户端不支持目录选择，请重启桌面端后重试。");
        return;
      }
      const picked = await picker();
      if (!picked.ok || !picked.path) {
        if (!picked.canceled) setErrorText(picked.error ?? "目录选择失败");
        return;
      }
      const label = picked.path.split(/[\\/]/).filter(Boolean).pop() || "folder";
      await addTaskspace(picked.path, label);
    } catch (err) {
      setErrorText(`目录选择失败：${String(err)}`);
    }
  };

  const pickAndAttachFiles = async () => {
    setMoreMenuOpen(false);
    if (taskspaceAtLimit) {
      setErrorText(formatTaskspaceAddError(`taskspace limit reached (${maxTaskspaces})`, maxTaskspaces));
      return;
    }
    try {
      const picker = window.agenticxDesktop.chooseFiles;
      if (typeof picker !== "function") {
        setErrorText("当前客户端不支持文件选择，请完全重启桌面端后重试。");
        return;
      }
      const picked = await picker();
      if (!picked.ok || !picked.paths?.length) {
        if (!picked.canceled) setErrorText(picked.error ?? "文件选择失败");
        return;
      }
      const parents = new Map<string, string>();
      for (const filePath of picked.paths) {
        const normalized = filePath.replace(/\\/g, "/");
        const idx = normalized.lastIndexOf("/");
        const parent = idx > 0 ? normalized.slice(0, idx) : normalized;
        if (!parent || parents.has(parent)) continue;
        const label = parent.split("/").filter(Boolean).pop() || "folder";
        parents.set(parent, label);
      }
      for (const [dir, label] of parents) {
        await addTaskspace(dir, label);
      }
    } catch (err) {
      setErrorText(`文件选择失败：${String(err)}`);
    }
  };

  const openFile = async (taskspaceId: string, relPath: string) => {
    const browseSessionId = getBrowseSessionId();
    if (!browseSessionId) return;
    if (activeTaskspaceId !== taskspaceId) {
      onActiveTaskspaceChange(taskspaceId);
    }
    const result = await window.agenticxDesktop.readTaskspaceFile({ sessionId: browseSessionId, taskspaceId, path: relPath });
    if (!result.ok) {
      if ((result.error ?? "").includes("session not found")) return;
      setErrorText(result.error ?? "读取文件失败");
      return;
    }
    setSelectedFilePath(relPath);
    const ts = taskspaces.find((t) => t.id === taskspaceId);
    const preview = mapTaskspaceFileToWorkspacePreview(result, relPath, ts?.path);
    if (!preview) {
      setErrorText(result.error ?? "读取文件失败");
      return;
    }
    setFilePreview(preview);
  };

  const handlePreviewCopy = (text?: string) => {
    if (!filePreview) return;
    void navigator.clipboard.writeText(text ?? previewCopyText(filePreview));
    setPreviewCopied(true);
    window.setTimeout(() => setPreviewCopied(false), 1800);
  };

  const openFileByAbsolutePath = async (absPathRaw: string) => {
    const absPath = stripLineRangeFromAbsPath(String(absPathRaw || "").trim());
    if (!absPath) return;
    setErrorText("");

    const directPreview = await window.agenticxDesktop.systemSearchPreview(absPath);
    if (directPreview.ok) {
      const mapped = mapSystemSearchPreviewToWorkspacePreview(absPath, directPreview);
      if (mapped && (mapped.kind === "text" || mapped.kind === "markdown" || mapped.kind === "code")) {
        setSelectedFilePath("");
        setFilePreview(mapped);
        const match = findTaskspaceForAbsPath(taskspaces, absPath);
        if (match && activeTaskspaceId !== match.taskspaceId) {
          onActiveTaskspaceChange(match.taskspaceId);
        }
        return;
      }
      if (mapped && mapped.kind === "image") {
        setSelectedFilePath("");
        setFilePreview(mapped);
        return;
      }
    }

    const resolved = await window.agenticxDesktop.resolveLocalPath(absPath);
    if (resolved.ok && resolved.isDirectory && resolved.resolvedPath) {
      setErrorText("引用目标应是文件，不是文件夹");
      return;
    }
    if (resolved.ok === false && resolved.error === "path not found") {
      setErrorText("路径不存在");
      return;
    }

    const targetPath =
      resolved.ok && resolved.resolvedPath
        ? stripLineRangeFromAbsPath(resolved.resolvedPath)
        : absPath;
    const browseSessionId = getBrowseSessionId();
    if (!browseSessionId) {
      setErrorText("请先发送一条消息创建会话后再预览文件");
      return;
    }
    let workspaces = taskspaces;
    if (workspaces.length === 0) {
      const loaded = await loadTaskspaces();
      workspaces = loaded ?? [];
    }
    let match = findTaskspaceForAbsPath(workspaces, targetPath);
    if (!match) {
      const parent = parentDirectory(targetPath);
      const addResult = await window.agenticxDesktop.addTaskspace({
        sessionId: browseSessionId,
        path: parent,
        label: parent.split(/[\\/]/).pop() || "workspace",
      });
      if (!addResult.ok || !addResult.workspace?.id) {
        setErrorText(addResult.error ?? directPreview.error ?? "无法预览该文件");
        return;
      }
      const reloaded = await loadTaskspaces();
      workspaces = reloaded ?? workspaces;
      match = findTaskspaceForAbsPath(workspaces, targetPath);
      if (!match && addResult.workspace) {
        match = {
          taskspaceId: addResult.workspace.id,
          relPath: relativePathFromRoot(addResult.workspace.path, targetPath),
        };
      }
    }
    if (!match) {
      setErrorText(directPreview.error ?? "无法在工作区中定位该文件");
      return;
    }
    await openFile(match.taskspaceId, match.relPath);
  };

  useEffect(() => {
    const request = previewOpenRequest;
    const path = String(request?.absolutePath ?? "").trim();
    if (!path) return;
    setPreviewFocusLineRange(request?.lineRange ?? null);
    void openFileByAbsolutePath(path).finally(() => {
      onPreviewOpenRequestHandled?.();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewOpenRequest]);

  const toggleDir = async (taskspaceId: string, relPath: string) => {
    if (activeTaskspaceId !== taskspaceId) {
      onActiveTaskspaceChange(taskspaceId);
    }
    const key = nodeKey(taskspaceId, relPath);
    if (expandedDirs.has(key)) {
      const next = new Set(expandedDirs);
      next.delete(key);
      setExpandedDirs(next);
      return;
    }
    await loadDir(taskspaceId, relPath);
    const next = new Set(expandedDirs);
    next.add(key);
    setExpandedDirs(next);
  };

  const startResizeTerminal = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    terminalUserResized.current = true;
    const startY = event.clientY;
    const startHeight = safeTerminalHeight;
    const onMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      const next = Math.max(minTerminalHeight, Math.min(maxTerminalHeight, startHeight + delta));
      setTerminalAreaHeight(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const renderDir = (taskspaceId: string, relPath: string, depth: number) => {
    const key = nodeKey(taskspaceId, relPath);
    const rows = entriesByDir[key] ?? [];
    if (rows.length === 0) return null;
    return rows.map((item) => {
      const itemKey = nodeKey(taskspaceId, item.path);
      const isExpanded = expandedDirs.has(itemKey);
      const paddingLeft = 8 + depth * 14;
      if (item.type === "dir") {
        return (
          <div key={item.path}>
            <div
              className="flex min-w-0 items-center gap-1"
              draggable
              onDragStart={(e) =>
                startWorkspaceEntryDrag(e, {
                  type: "dir",
                  taskspaceId,
                  relPath: item.path,
                  label: item.name,
                })
              }
            >
              <button
                className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-1 text-left text-[13px] text-text-muted hover:bg-surface-hover"
                style={{ paddingLeft }}
                onClick={() => void toggleDir(taskspaceId, item.path)}
                title={item.path}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const ts = taskspaces.find((t) => t.id === taskspaceId);
                  if (!ts) return;
                  setCtxMenu({ kind: "entry", x: e.clientX, y: e.clientY, taskspace: ts, entry: item });
                }}
              >
                <span className="inline-block w-3 shrink-0 text-center">{isExpanded ? "▾" : "▸"}</span>
                <span className="min-w-0 truncate">{item.name}/</span>
              </button>
              <button
                className="rounded px-1.5 py-0.5 text-xs text-text-faint transition hover:bg-surface-hover hover:text-text-muted"
                onClick={() =>
                  onPickDirectoryForReference?.({
                    taskspaceId,
                    relPath: item.path,
                    label: item.name,
                  })
                }
                title="引用到输入框"
              >
                @
              </button>
            </div>
            {isExpanded ? renderDir(taskspaceId, item.path, depth + 1) : null}
          </div>
        );
      }
      return (
        <div
          key={item.path}
          className="flex min-w-0 items-center gap-1"
          draggable
          onDragStart={(e) =>
            startWorkspaceEntryDrag(e, {
              type: "file",
              taskspaceId,
              relPath: item.path,
              label: item.name,
            })
          }
          onContextMenu={(e) => {
            e.preventDefault();
            const ts = taskspaces.find((t) => t.id === taskspaceId);
            if (!ts) return;
            setCtxMenu({ kind: "entry", x: e.clientX, y: e.clientY, taskspace: ts, entry: item });
          }}
        >
          <button
            className={`min-w-0 flex-1 truncate rounded px-1 py-1 text-left text-[13px] transition hover:bg-surface-hover ${
              selectedFilePath === item.path ? "text-text-strong" : "text-text-subtle"
            }`}
            style={{ paddingLeft: paddingLeft + 16 }}
            title={item.path}
            onClick={() => void openFile(taskspaceId, item.path)}
          >
            {item.name}
          </button>
          <button
            className="rounded px-1.5 py-0.5 text-xs text-text-faint transition hover:bg-surface-hover hover:text-text-muted"
            onClick={() => onPickFileForReference?.(taskspaceId, item.path)}
            title="引用到输入框"
          >
            @
          </button>
        </div>
      );
    });
  };

  const activeTab = terminalTabs.find((t) => t.id === activeTerminalTabId) ?? terminalTabs[0] ?? null;

  const addSameCwdTerminal = () => {
    const cwd = (activeTaskspace?.path ?? "").trim();
    if (!cwd) {
      setErrorText("请先选择工作区或添加带目录的工作区");
      return;
    }
    addPaneTerminalTab(paneId, cwd, activeTaskspace?.label);
  };

  return (
    <div
      ref={panelRef}
      className={`relative flex h-full min-h-0 w-full flex-col ${
        isSidebarEmbed ? "bg-surface-sidebar" : "bg-surface-card"
      }`}
      style={!isSidebarEmbed && tintColor ? { backgroundColor: tintColor } : undefined}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-col">
          <div className="flex items-center justify-between gap-1 px-2 py-2">
            {backAction ? (
              <button
                type="button"
                className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-text-faint transition-colors hover:bg-surface-hover hover:text-text-strong"
                onClick={backAction.onClick}
                aria-label={backAction.label}
              >
                <ArrowLeft className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                <span className="truncate">{backAction.label}</span>
              </button>
            ) : (
              <div className="flex items-center gap-1.5 px-1 text-[13px] font-medium text-text-strong">
                工作区
              </div>
            )}
            {isSidebarEmbed ? (
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  ref={viewBtnRef}
                  type="button"
                  className="agx-topbar-btn !px-[5px]"
                  title={viewMode === "list" ? "列表视图" : "树形视图"}
                  aria-label="切换视图"
                  onClick={() => {
                    const rect = viewBtnRef.current?.getBoundingClientRect();
                    if (rect) {
                      setViewMenuPos({ left: Math.max(8, rect.right - 160), top: rect.bottom + 4 });
                    }
                    setMoreMenuOpen(false);
                    setViewMenuOpen((v) => !v);
                  }}
                >
                  {viewMode === "list" ? (
                    <List className="h-4 w-4" strokeWidth={1.8} />
                  ) : (
                    <ListTree className="h-4 w-4" strokeWidth={1.8} />
                  )}
                </button>
                <div className="mx-0.5 h-3.5 w-px bg-border" />
                <button
                  ref={moreBtnRef}
                  type="button"
                  className="agx-topbar-btn !px-[5px]"
                  title="更多"
                  aria-label="更多"
                  onClick={() => {
                    const rect = moreBtnRef.current?.getBoundingClientRect();
                    if (rect) {
                      setMoreMenuPos({ left: Math.max(8, rect.right - 180), top: rect.bottom + 4 });
                    }
                    setViewMenuOpen(false);
                    setMoreMenuOpen((v) => !v);
                  }}
                >
                  <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} />
                </button>
              </div>
            ) : (
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  className="agx-topbar-btn !px-[5px]"
                  onClick={() => {
                    setErrorText("");
                    void refreshListAndActiveTaskspace();
                  }}
                  title="刷新工作区列表与目录"
                >
                  <RefreshCw className="h-4 w-4" strokeWidth={1.8} />
                </button>
                <button
                  className={`agx-topbar-btn !px-[5px] ${showAddForm ? "agx-topbar-btn--active" : ""}`}
                  onClick={() => {
                    if (taskspaceAtLimit) {
                      setErrorText(
                        formatTaskspaceAddError(`taskspace limit reached (${maxTaskspaces})`, maxTaskspaces)
                      );
                      return;
                    }
                    setShowAddForm((prev) => !prev);
                    setErrorText("");
                  }}
                  title={
                    taskspaceAtLimit
                      ? `已达工作区上限（${taskspaces.length}/${maxTaskspaces}）`
                      : "新增工作区"
                  }
                  disabled={taskspaceAtLimit}
                >
                  <FolderPlus className="h-4 w-4" strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  className="agx-topbar-btn !px-[5px]"
                  onClick={() => {
                    setErrorText("");
                    addSameCwdTerminal();
                  }}
                  title="打开内嵌终端（当前选中的工作区目录）；也可右键工作区节点选「在此目录下打开终端」"
                >
                  <Terminal className="h-4 w-4" strokeWidth={1.8} />
                </button>
                {onClose ? (
                  <button
                    className="agx-topbar-btn !px-[5px]"
                    onClick={onClose}
                    title="关闭工作区面板"
                  >
                    <PanelRight className="h-4 w-4" strokeWidth={1.8} />
                  </button>
                ) : null}
              </div>
            )}
          </div>
          {!showConversationEmpty ? (
            <div className="px-2 pb-1.5">
              <input
                type="search"
                value={fileSearchQuery}
                onChange={(e) => setFileSearchQuery(e.target.value)}
                placeholder="搜索文件…"
                autoComplete="off"
                spellCheck={false}
                aria-label="搜索工作区文件"
                className="w-full rounded-md border border-border bg-surface-hover px-2 py-2 text-[13px] text-text-primary placeholder:text-text-faint focus:border-[var(--ui-btn-primary-border,#3b82f6)] focus:outline-none focus:ring-1 focus:ring-[var(--ui-btn-primary-border,#3b82f6)]"
              />
            </div>
          ) : null}
          {showAddForm ? (
            <div
              className="border-b border-border px-3 py-2"
              style={tintColor ? { backgroundColor: tintColor } : undefined}
            >
              <div className="mb-2 flex items-center justify-between gap-2 text-[13px] font-medium text-text-subtle">
                <span>新增工作区</span>
                <span className="text-[11px] font-normal tabular-nums text-text-faint">
                  已用 {taskspaces.length}/{maxTaskspaces}
                </span>
              </div>
              <input
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="目录绝对路径（可留空用默认）"
                className="mb-1.5 w-full rounded border border-border bg-surface-hover px-2 py-1.5 text-[13px] text-text-primary outline-none focus:border-border-strong"
              />
              <div className="mb-1.5 flex justify-end">
                <button
                  type="button"
                  className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[13px] text-text-muted hover:bg-surface-hover"
                  onClick={() => void chooseDirectoryForTaskspace()}
                  title="从系统目录中选择"
                >
                  <Folder className="h-3.5 w-3.5" strokeWidth={1.8} />
                  选择目录
                </button>
              </div>
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="显示名称（可选）"
                className="mb-2 w-full rounded border border-border bg-surface-hover px-2 py-1.5 text-[13px] text-text-primary outline-none focus:border-border-strong"
              />
              <div className="flex items-center justify-end gap-1.5">
                <button
                  className="rounded px-2 py-1 text-[13px] text-text-subtle hover:bg-surface-hover"
                  onClick={() => {
                    setShowAddForm(false);
                    setNewPath("");
                    setNewLabel("");
                  }}
                >
                  取消
                </button>
                <button
                  className="rounded px-2 py-1 text-[13px] transition disabled:opacity-50"
                  style={{ background: "var(--ui-btn-primary-bg)", color: "var(--ui-btn-primary-text)" }}
                  disabled={adding || taskspaceAtLimit}
                  onClick={() => void addTaskspace(newPath, newLabel)}
                >
                  {adding ? "添加中..." : taskspaceAtLimit ? "已达上限" : "确认添加"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {loading || !workspaceLoadedOnce ? (
            <div className="space-y-2 py-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-7 animate-pulse rounded-md bg-surface-hover" />
              ))}
            </div>
          ) : null}
          {showConversationEmpty ? (
            <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-hover text-text-faint">
                <FilePlus className="h-7 w-7" strokeWidth={1.5} />
              </div>
              <div className="space-y-1">
                <div className="text-[14px] font-medium text-text-primary">工作区为空</div>
                <div className="text-[12px] leading-relaxed text-text-faint">
                  添加文件或文件夹到当前对话的可见工作区
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-border bg-surface-hover px-3.5 py-1.5 text-[13px] text-text-primary transition-colors hover:bg-surface-card-strong disabled:opacity-50"
                  disabled={taskspaceAtLimit}
                  onClick={() => void pickAndAttachFiles()}
                >
                  添加文件
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-border bg-surface-hover px-3.5 py-1.5 text-[13px] text-text-primary transition-colors hover:bg-surface-card-strong disabled:opacity-50"
                  disabled={taskspaceAtLimit}
                  onClick={() => void pickAndAttachDirectory()}
                >
                  添加文件夹
                </button>
              </div>
            </div>
          ) : null}
          {!isSidebarEmbed && workspaceLoadedOnce && !loading && taskspaces.length === 0 ? (
            getBrowseSessionId() ? (
              <div className="px-2 py-4 text-[13px] text-text-faint">暂无工作区</div>
            ) : (
              <div className="px-2 py-4 text-[13px] text-text-faint">
                选择或新建一个对话后，这里会显示工作区文件
              </div>
            )
          ) : null}
          {!showConversationEmpty && !loading && filteredFiles !== null ? (
            filteredFiles.length === 0 ? (
              <div className="text-[13px] text-text-faint">无匹配文件</div>
            ) : (
              filteredFiles.map(({ taskspaceId, file }) => {
                const ts = taskspaces.find((t) => t.id === taskspaceId);
                return (
                <div
                  key={`${taskspaceId}:${file.path}`}
                  className="flex min-w-0 items-center gap-1"
                  draggable
                  onDragStart={(e) =>
                    startWorkspaceEntryDrag(e, {
                      type: "file",
                      taskspaceId,
                      relPath: file.path,
                      label: file.name,
                    })
                  }
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (!ts) return;
                    setCtxMenu({ kind: "entry", x: e.clientX, y: e.clientY, taskspace: ts, entry: file });
                  }}
                >
                  <button
                    className={`min-w-0 flex-1 truncate rounded px-1 py-1 text-left text-[13px] transition hover:bg-surface-hover ${
                      selectedFilePath === file.path ? "text-text-strong" : "text-text-subtle"
                    }`}
                    title={file.path}
                    onClick={() => void openFile(taskspaceId, file.path)}
                  >
                    {file.name}
                    <span className="ml-1 text-[11px] text-text-faint">{file.path}</span>
                  </button>
                  <button
                    className="rounded px-1.5 py-0.5 text-xs text-text-faint transition hover:bg-surface-hover hover:text-text-muted"
                    onClick={() => onPickFileForReference?.(taskspaceId, file.path)}
                    title="引用到输入框"
                  >
                    @
                  </button>
                </div>
              );
              })
            )
          ) : null}
          {!showConversationEmpty && !loading && filteredFiles === null && listViewFiles ? (
            listViewFiles.length === 0 ? (
              <div className="px-1 py-2 text-[13px] text-text-faint">当前目录暂无文件</div>
            ) : (
              listViewFiles.map(({ taskspaceId, file }) => (
                <div key={`${taskspaceId}:${file.path}`} className="flex min-w-0 items-center gap-1">
                  <button
                    className={`min-w-0 flex-1 truncate rounded px-1 py-1 text-left text-[13px] transition hover:bg-surface-hover ${
                      selectedFilePath === file.path ? "text-text-strong" : "text-text-subtle"
                    }`}
                    title={file.path}
                    onClick={() => void openFile(taskspaceId, file.path)}
                  >
                    {file.name}
                  </button>
                  <button
                    className="rounded px-1.5 py-0.5 text-xs text-text-faint transition hover:bg-surface-hover hover:text-text-muted"
                    onClick={() => onPickFileForReference?.(taskspaceId, file.path)}
                    title="引用到输入框"
                  >
                    @
                  </button>
                </div>
              ))
            )
          ) : null}
          {!showConversationEmpty && !loading && filteredFiles === null && !listViewFiles && visibleTaskspaces.map((ts) => {
            const key = nodeKey(ts.id, ".");
            const isExpanded = expandedDirs.has(key);
            const isActive = activeTaskspaceId === ts.id;
            
            return (
              <div key={ts.id} className="mb-0.5">
                <div
                  className="flex min-w-0 items-center gap-1"
                  draggable
                  onDragStart={(e) =>
                    startWorkspaceEntryDrag(e, {
                      type: "dir",
                      taskspaceId: ts.id,
                      relPath: ".",
                      label: taskspaceReferenceLabel(ts),
                    })
                  }
                >
                  <button
                    className={`flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1.5 text-left text-[13px] font-medium transition ${
                      isActive ? "bg-surface-hover text-text-strong" : "text-text-subtle hover:bg-surface-hover hover:text-text-primary"
                    }`}
                    onClick={() => {
                      onActiveTaskspaceChange(ts.id);
                      const next = new Set(expandedDirs);
                      if (next.has(key)) {
                        next.delete(key);
                      } else {
                        next.add(key);
                        void loadDir(ts.id, ".");
                      }
                      setExpandedDirs(next);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setCtxMenu({ kind: "taskspace", x: e.clientX, y: e.clientY, taskspace: ts });
                    }}
                    title={ts.id === "default" ? (ts.path || ts.label) : ts.path}
                  >
                    <span className="inline-block w-3 shrink-0 text-center text-text-faint">{isExpanded ? "▾" : "▸"}</span>
                    <Folder className="h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={1.8} />
                    <span className="min-w-0 flex-1 truncate">{ts.id !== "default" ? ts.label : (ts.path || ts.label || "默认工作区")}</span>
                  </button>
                  <button
                    className="rounded px-1.5 py-0.5 text-xs text-text-faint transition hover:bg-surface-hover hover:text-text-muted"
                    onClick={() =>
                      onPickDirectoryForReference?.({
                        taskspaceId: ts.id,
                        relPath: ".",
                        label: taskspaceReferenceLabel(ts),
                      })
                    }
                    title="引用到输入框"
                  >
                    @
                  </button>
                </div>
                {isExpanded ? renderDir(ts.id, ".", 1) : null}
              </div>
            );
          })}
        </div>
      </div>

      {!isSidebarEmbed && terminalTabs.length > 0 ? (
        <>
          <div
            className="group relative min-h-[14px] shrink-0 cursor-row-resize px-2 py-2 touch-none"
            onMouseDown={startResizeTerminal}
            title="拖拽调整终端区域高度"
          >
            <div className="pointer-events-none absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-[var(--border-strong)] transition-all duration-200 group-hover:h-[2px] group-hover:bg-[var(--ui-btn-primary-bg)]" />
          </div>

          <div className="flex min-h-0 shrink-0 flex-col border-t border-border" style={{ height: safeTerminalHeight }}>
            <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
              <span className="text-xs text-text-faint">终端</span>
              <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
                {terminalTabs.map((tab) => (
                  <div key={tab.id} className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      className={`max-w-[120px] truncate rounded px-2 py-1 text-[13px] transition ${
                        tab.id === activeTerminalTabId
                          ? "bg-surface-hover text-text-strong"
                          : "text-text-subtle hover:bg-surface-hover"
                      }`}
                      onClick={() => setActivePaneTerminalTab(paneId, tab.id)}
                      title={tab.cwd}
                    >
                      {tab.label}
                    </button>
                    <button
                      type="button"
                      className="rounded px-1.5 py-0.5 text-xs text-text-faint hover:bg-surface-hover hover:text-rose-300"
                      onClick={() => removePaneTerminalTab(paneId, tab.id)}
                      title="关闭终端"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="shrink-0 rounded bg-surface-hover px-2 py-1 text-[13px] text-text-muted hover:bg-surface-hover"
                onClick={addSameCwdTerminal}
                title="在当前工作区目录下新开终端"
              >
                +
              </button>
            </div>
            <div className="relative min-h-0 flex-1 bg-surface-card">
              {terminalTabs.map((tab) => {
                const isVisible = activeTab && tab.id === activeTab.id;
                return (
                  <div
                    key={tab.id}
                    className={`absolute inset-0 flex min-h-0 flex-col ${
                      isVisible ? "z-10" : "invisible pointer-events-none z-0"
                    }`}
                    aria-hidden={!isVisible}
                  >
                    <TerminalEmbed tabId={tab.id} cwd={tab.cwd} ccBridgePty={tab.ccBridgePty} />
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : null}

      <ContextMenu
        open={!!ctxMenu}
        x={ctxMenu?.x ?? 0}
        y={ctxMenu?.y ?? 0}
        onClose={() => setCtxMenu(null)}
        items={
          ctxMenu
            ? ctxMenu.kind === "taskspace"
              ? [
                  {
                    label: "引用到输入框",
                    onSelect: () =>
                      onPickDirectoryForReference?.({
                        taskspaceId: ctxMenu.taskspace.id,
                        relPath: ".",
                        label: taskspaceReferenceLabel(ctxMenu.taskspace),
                      }),
                  },
                  {
                    label: revealInFileManagerLabel,
                    onSelect: () => {
                      const rootPath = (ctxMenu.taskspace.path || "").trim();
                      if (!rootPath) {
                        setErrorText("该工作区没有可打开的磁盘路径");
                        return;
                      }
                      void revealInFileManager(rootPath);
                    },
                  },
                  {
                    label: "在此目录下打开终端",
                    onSelect: () => openTerminalForPath(ctxMenu.taskspace.path, ctxMenu.taskspace.label),
                  },
                  {
                    label: "移除工作区",
                    danger: true,
                    onSelect: () => void removeTaskspace(ctxMenu.taskspace.id),
                  },
                ]
              : [
                  {
                    label: "引用到输入框",
                    onSelect: () => {
                      if (ctxMenu.entry.type === "dir") {
                        onPickDirectoryForReference?.({
                          taskspaceId: ctxMenu.taskspace.id,
                          relPath: ctxMenu.entry.path,
                          label: ctxMenu.entry.name,
                        });
                        return;
                      }
                      onPickFileForReference?.(ctxMenu.taskspace.id, ctxMenu.entry.path);
                    },
                  },
                  {
                    label: revealInFileManagerLabel,
                    onSelect: () => {
                      const abs = absoluteTaskspacePath(ctxMenu.taskspace.path, ctxMenu.entry.path);
                      void revealInFileManager(abs);
                    },
                  },
                  {
                    label: "在此目录下打开终端",
                    onSelect: () => {
                      const cwd = terminalCwdForEntry(ctxMenu.taskspace, ctxMenu.entry);
                      openTerminalForPath(cwd, ctxMenu.entry.name);
                    },
                  },
                ]
            : []
        }
      />

      {filePreview && previewAnchor ? (
        <WorkspaceFilePreview
          preview={filePreview}
          anchor={previewAnchor}
          copied={previewCopied}
          onCopy={handlePreviewCopy}
          onClose={() => {
            setFilePreview(null);
            setPreviewFocusLineRange(null);
          }}
          initialLineRange={previewFocusLineRange ?? undefined}
          onQuoteSnippet={onQuotePreviewSnippet}
          onRevealInFileManager={revealInFileManager}
          revealInFileManagerLabel={revealInFileManagerLabel}
          taskspaceRoot={previewTaskspaceRoot}
        />
      ) : null}

      {errorText ? (
        <div className="border-t border-border px-3 py-1.5 text-xs text-rose-300">{errorText}</div>
      ) : null}

      {viewMenuOpen && viewMenuPos
        ? createPortal(
            <div
              data-workspace-view-menu
              className="fixed z-[240] w-[160px] rounded-xl border border-border bg-surface-base p-1 shadow-2xl"
              style={{ left: viewMenuPos.left, top: viewMenuPos.top }}
              onClick={(e) => e.stopPropagation()}
            >
              {(
                [
                  { id: "list" as const, label: "列表视图", icon: List },
                  { id: "tree" as const, label: "树形视图", icon: ListTree },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                const active = viewMode === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-text-primary hover:bg-surface-hover"
                    onClick={() => {
                      setViewMode(item.id);
                      setViewMenuOpen(false);
                    }}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {active ? <Check className="h-3.5 w-3.5 shrink-0 text-text-strong" strokeWidth={2} /> : null}
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}

      {moreMenuOpen && moreMenuPos
        ? createPortal(
            <div
              data-workspace-more-menu
              className="fixed z-[240] w-[180px] rounded-xl border border-border bg-surface-base p-1 shadow-2xl"
              style={{ left: moreMenuPos.left, top: moreMenuPos.top }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-text-primary hover:bg-surface-hover"
                onClick={() => void pickAndAttachFiles()}
              >
                <FilePlus className="h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={1.75} />
                <span>添加文件</span>
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-text-primary hover:bg-surface-hover"
                onClick={() => void pickAndAttachDirectory()}
              >
                <FolderPlus className="h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={1.75} />
                <span>添加文件夹</span>
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-text-primary hover:bg-surface-hover"
                onClick={() => {
                  setMoreMenuOpen(false);
                  setErrorText("");
                  void refreshListAndActiveTaskspace();
                }}
              >
                <RefreshCw className="h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={1.75} />
                <span>刷新</span>
              </button>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
