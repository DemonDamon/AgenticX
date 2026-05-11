import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PanelRightClose, Folder, RefreshCcw, Plus } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-python";
import "prismjs/components/prism-typescript";
import "prismjs/themes/prism-tomorrow.css";
import type { Taskspace } from "../store";
import { useAppStore } from "../store";
import { createResizeRafScheduler } from "../utils/resize-raf";
import { ContextMenu } from "./ContextMenu";
import { TerminalEmbed } from "./TerminalEmbed";
import { getRememberedSessionForAvatar } from "../utils/avatar-last-session";
import { isPaneAwaitingFreshSession } from "../utils/pane-fresh-session";

type TaskspaceFile = {
  name: string;
  type: "file" | "dir";
  path: string;
  size: number;
  modified: number;
};

type FilePreview = {
  path: string;
  content: string;
  truncated: boolean;
  size: number;
};

type Props = {
  paneId: string;
  sessionId: string;
  activeTaskspaceId: string | null;
  onActiveTaskspaceChange: (taskspaceId: string | null) => void;
  onPickFileForReference?: (path: string) => void;
  autoRefreshKey?: number;
  onClose?: () => void;
  tintColor?: string;
};

type CtxTarget = { x: number; y: number; taskspace: Taskspace };
type SessionListItem = {
  session_id: string;
  avatar_id: string | null;
  updated_at: number;
  created_at?: number;
  archived?: boolean;
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

function detectLanguage(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".js") || lower.endsWith(".jsx")) return "javascript";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".sh") || lower.endsWith(".bash")) return "bash";
  return "clike";
}

function nodeKey(taskspaceId: string, relPath: string): string {
  return `${taskspaceId}:${relPath || "."}`;
}

export function WorkspacePanel({
  paneId,
  sessionId,
  activeTaskspaceId,
  onActiveTaskspaceChange,
  onPickFileForReference,
  autoRefreshKey,
  onClose,
  tintColor,
}: Props) {
  const addPaneTerminalTab = useAppStore((s) => s.addPaneTerminalTab);
  const removePaneTerminalTab = useAppStore((s) => s.removePaneTerminalTab);
  const setActivePaneTerminalTab = useAppStore((s) => s.setActivePaneTerminalTab);
  const terminalTabs = useAppStore((s) => s.panes.find((p) => p.id === paneId)?.terminalTabs ?? []);
  const activeTerminalTabId = useAppStore((s) => s.panes.find((p) => p.id === paneId)?.activeTerminalTabId ?? null);
  const paneAvatarId = useAppStore((s) => s.panes.find((p) => p.id === paneId)?.avatarId ?? null);
  const paneAvatarName = useAppStore((s) => s.panes.find((p) => p.id === paneId)?.avatarName ?? "");
  const setPaneSessionId = useAppStore((s) => s.setPaneSessionId);

  const [taskspaces, setTaskspaces] = useState<Taskspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [entriesByDir, setEntriesByDir] = useState<Record<string, TaskspaceFile[]>>({});
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxTarget | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  const [terminalAreaHeight, setTerminalAreaHeight] = useState(0);
  const terminalUserResized = useRef(false);

  const activeTaskspace = useMemo(
    () => taskspaces.find((item) => item.id === activeTaskspaceId) ?? taskspaces[0] ?? null,
    [taskspaces, activeTaskspaceId]
  );

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

  const highlightedCode = useMemo(() => {
    if (!filePreview) return "";
    const language = detectLanguage(filePreview.path);
    const grammar = Prism.languages[language] ?? Prism.languages.clike;
    return Prism.highlight(filePreview.content, grammar, language);
  }, [filePreview]);

  const loadTaskspaces = async () => {
    if (!sessionId) return;
    setLoading(true);
    const result = await window.agenticxDesktop.listTaskspaces(sessionId);
    if (!result.ok) {
      setErrorText(result.error ?? "加载工作区失败");
      setLoading(false);
      return;
    }
    const workspaces = Array.isArray(result.workspaces) ? result.workspaces : [];
    setTaskspaces(workspaces);
    if (workspaces.length > 0 && !workspaces.some((item) => item.id === activeTaskspaceId)) {
      onActiveTaskspaceChange(workspaces[0].id);
    }
    setLoading(false);
  };

  const loadDir = async (taskspaceId: string, relPath = ".", force = false) => {
    if (!sessionId) return;
    const key = nodeKey(taskspaceId, relPath);
    if (!force && entriesByDir[key]) return;
    const result = await window.agenticxDesktop.listTaskspaceFiles({ sessionId, taskspaceId, path: relPath });
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
    await loadTaskspaces();
    const latest = await window.agenticxDesktop.listTaskspaces(sessionId);
    if (!latest.ok || !Array.isArray(latest.workspaces)) return;
    const refreshedActive =
      latest.workspaces.find((item) => item.id === activeTaskspaceId) ?? latest.workspaces[0] ?? null;
    if (refreshedActive) {
      onActiveTaskspaceChange(refreshedActive.id);
      await refreshTaskspace(refreshedActive.id);
    }
  };

  useEffect(() => {
    if (!sessionId) {
      setTaskspaces([]);
      setExpandedDirs(new Set());
      setEntriesByDir({});
      setSelectedFilePath("");
      setFilePreview(null);
      setErrorText("");
      return;
    }
    void loadTaskspaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

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
      if (!listed.ok || !Array.isArray(listed.sessions)) return;
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
      if (!preferredSid || cancelled) return;
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
  }, [sessionId, paneAvatarId, paneId, setPaneSessionId]);

  useEffect(() => {
    if (!activeTaskspace) return;
    void loadDir(activeTaskspace.id, ".");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTaskspace?.id]);

  useEffect(() => {
    if (!sessionId || !activeTaskspace) return;
    const timer = window.setInterval(() => {
      void refreshTaskspace(activeTaskspace.id);
    }, 3000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, activeTaskspace?.id, expandedDirs]);

  useEffect(() => {
    if (!sessionId) return;
    if (typeof autoRefreshKey !== "number" || autoRefreshKey <= 0) return;
    void refreshListAndActiveTaskspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefreshKey, sessionId]);

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
    const result = await window.agenticxDesktop.addTaskspace({
      sessionId: effectiveSessionId,
      path: pathValue.trim() || undefined,
      label: labelValue.trim() || undefined,
    });
    setAdding(false);
    if (!result.ok) {
      setErrorText(result.error ?? "添加工作区失败");
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

  const openFile = async (taskspaceId: string, relPath: string) => {
    if (!sessionId) return;
    const result = await window.agenticxDesktop.readTaskspaceFile({ sessionId, taskspaceId, path: relPath });
    if (!result.ok) {
      if ((result.error ?? "").includes("session not found")) return;
      setErrorText(result.error ?? "读取文件失败");
      return;
    }
    setSelectedFilePath(relPath);
    setFilePreview({
      path: relPath,
      content: result.content ?? "",
      truncated: !!result.truncated,
      size: Number(result.size ?? 0),
    });
  };

  const toggleDir = async (taskspaceId: string, relPath: string) => {
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
            <button
              className="flex w-full min-w-0 items-center gap-1 rounded px-1 py-1 text-left text-[13px] text-text-muted hover:bg-surface-hover"
              style={{ paddingLeft }}
              onClick={() => void toggleDir(taskspaceId, item.path)}
              title={item.path}
            >
              <span className="inline-block w-3 shrink-0 text-center">{isExpanded ? "▾" : "▸"}</span>
              <span className="min-w-0 truncate">{item.name}/</span>
            </button>
            {isExpanded ? renderDir(taskspaceId, item.path, depth + 1) : null}
          </div>
        );
      }
      return (
        <div key={item.path} className="flex min-w-0 items-center gap-1">
          <button
            className={`min-w-0 flex-1 truncate rounded px-1 py-1 text-left text-[13px] transition hover:bg-surface-hover ${
              selectedFilePath === item.path ? "text-text-strong" : "text-text-subtle"
            }`}
            style={{ paddingLeft }}
            title={item.path}
            onClick={() => void openFile(taskspaceId, item.path)}
          >
            {item.name}
          </button>
          <button
            className="rounded px-1.5 py-0.5 text-xs text-text-faint transition hover:bg-surface-hover hover:text-text-muted"
            onClick={() => onPickFileForReference?.(item.path)}
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
    <div ref={panelRef} className="relative flex h-full min-h-0 w-full flex-col bg-surface-card" style={tintColor ? { backgroundColor: tintColor } : undefined}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-col border-b border-border">
          <div className="flex items-center gap-1 px-2 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              {taskspaces.map((item) => (
                <button
                  key={item.id}
                  className={`shrink-0 rounded px-2 py-1.5 text-[13px] transition ${
                    item.id === activeTaskspace?.id
                      ? "text-text-strong"
                      : "text-text-subtle hover:bg-surface-hover hover:text-text-primary"
                  }`}
                  style={
                    item.id === activeTaskspace?.id
                      ? {
                          background: "var(--ui-accent-surface)",
                          color: "var(--ui-accent-text)",
                        }
                      : {}
                  }
                  onClick={() => onActiveTaskspaceChange(item.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCtxMenu({ x: e.clientX, y: e.clientY, taskspace: item });
                  }}
                  title={item.id === "default" ? (item.path || item.label) : undefined}
                >
                  <span className="flex items-center gap-1">
                    <Folder className="h-3 w-3 shrink-0 opacity-70" strokeWidth={1.8} />
                    {item.id !== "default" && item.label}
                  </span>
                </button>
              ))}
            </div>
            <button
              className="rounded border border-border p-1 text-text-muted hover:bg-surface-hover"
              onClick={() => {
                setErrorText("");
                void refreshListAndActiveTaskspace();
              }}
              title="刷新工作区列表与目录"
            >
              <RefreshCcw className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </button>
            <button
              className={`rounded border border-border p-1 text-text-muted transition hover:bg-surface-hover ${showAddForm ? "bg-surface-active" : ""}`}
              onClick={() => {
                setShowAddForm((prev) => !prev);
                setErrorText("");
              }}
              title="新增工作区"
            >
              <Plus className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </button>
            {onClose ? (
              <button
                className="rounded p-1 text-text-faint hover:bg-surface-hover hover:text-text-muted"
                onClick={onClose}
                title="关闭工作区面板"
              >
                <PanelRightClose className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>
            ) : null}
          </div>
          {showAddForm ? (
            <div
              className="border-t border-border px-3 py-2"
              style={tintColor ? { backgroundColor: tintColor } : undefined}
            >
              <div className="mb-2 text-[13px] font-medium text-text-subtle">新增工作区</div>
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
                  disabled={adding}
                  onClick={() => void addTaskspace(newPath, newLabel)}
                >
                  {adding ? "添加中..." : "确认添加"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-b border-border px-2 py-2">
          {loading ? <div className="text-[13px] text-text-faint">加载中...</div> : null}
          {!loading && !activeTaskspace ? <div className="text-[13px] text-text-faint">暂无工作区</div> : null}
          {!loading && activeTaskspace ? renderDir(activeTaskspace.id, ".", 0) : null}
        </div>
      </div>

      <div
        className="group relative min-h-[14px] shrink-0 cursor-row-resize px-2 py-2 touch-none"
        onMouseDown={startResizeTerminal}
        title="拖拽调整终端区域高度"
      >
        <div
          className="pointer-events-none absolute left-2 right-2 top-1/2 h-px -translate-y-1/2 transition"
          style={{ background: "var(--ui-accent-divider)" }}
        />
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-2 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-surface-panel opacity-60 transition group-hover:opacity-90"
          style={{ borderColor: "var(--ui-accent-divider-hover)" }}
        />
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
          {terminalTabs.length === 0 ? (
            <div className="flex h-full items-center justify-center overflow-hidden px-3 text-center text-[13px] leading-relaxed text-text-faint">
              <span className="break-words">右键工作区标签选择「在此目录下打开终端」，或点击 + 使用当前工作区目录</span>
            </div>
          ) : (
            terminalTabs.map((tab) => {
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
            })
          )}
        </div>
      </div>

      <ContextMenu
        open={!!ctxMenu}
        x={ctxMenu?.x ?? 0}
        y={ctxMenu?.y ?? 0}
        onClose={() => setCtxMenu(null)}
        items={
          ctxMenu
            ? [
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
            : []
        }
      />

      {filePreview ? (
        <div className="absolute inset-2 z-30 flex min-h-0 flex-col rounded-lg border border-border-strong bg-surface-panel shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="truncate text-[13px] text-text-subtle">{filePreview.path}</div>
            <button
              className="rounded border border-border px-2 py-1 text-[13px] text-text-muted hover:bg-surface-hover hover:text-text-strong"
              onClick={() => setFilePreview(null)}
            >
              关闭
            </button>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto px-3 py-2 text-[13px] leading-relaxed">
            <code
              className={`language-${detectLanguage(filePreview.path)}`}
              dangerouslySetInnerHTML={{ __html: highlightedCode }}
            />
          </pre>
          {filePreview.truncated ? (
            <div className="border-t border-border px-3 py-1.5 text-xs text-amber-300">
              文件过大，已截断显示（{filePreview.size} bytes）。
            </div>
          ) : null}
        </div>
      ) : null}

      {errorText ? (
        <div className="border-t border-border px-3 py-1.5 text-xs text-rose-300">{errorText}</div>
      ) : null}
    </div>
  );
}
