import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { Taskspace } from "../store";
import { createResizeRafScheduler } from "../utils/resize-raf";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-python";
import "prismjs/components/prism-typescript";
import "prismjs/themes/prism-tomorrow.css";

type TaskspaceFile = {
  name: string;
  type: "file" | "dir";
  path: string;
  size: number;
  modified: number;
};

type Props = {
  sessionId: string;
  activeTaskspaceId: string | null;
  onActiveTaskspaceChange: (taskspaceId: string | null) => void;
  onPickFileForReference?: (path: string) => void;
  autoRefreshKey?: number;
};

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

export function TaskspacePanel({
  sessionId,
  activeTaskspaceId,
  onActiveTaskspaceChange,
  onPickFileForReference,
  autoRefreshKey,
}: Props) {
  const [taskspaces, setTaskspaces] = useState<Taskspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [entriesByDir, setEntriesByDir] = useState<Record<string, TaskspaceFile[]>>({});
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [preview, setPreview] = useState<{ content: string; truncated: boolean; size: number } | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  const [previewHeight, setPreviewHeight] = useState(280);

  const activeTaskspace = useMemo(
    () => taskspaces.find((item) => item.id === activeTaskspaceId) ?? taskspaces[0] ?? null,
    [taskspaces, activeTaskspaceId]
  );

  const loadTaskspaces = async () => {
    if (!sessionId) return;
    setLoading(true);
    const result = await window.agenticxDesktop.listTaskspaces(sessionId);
    if (!result.ok) {
      setErrorText(result.error ?? "加载 Taskspace 失败");
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
      latest.workspaces.find((item) => item.id === activeTaskspaceId) ??
      latest.workspaces[0] ??
      null;
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
      setPreview(null);
      setErrorText("");
      return;
    }
    void loadTaskspaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

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

  useEffect(() => {
    if (!panelHeight) return;
    const maxHeight = Math.floor(panelHeight * 0.75);
    const minHeight = 160;
    setPreviewHeight((prev) => Math.max(minHeight, Math.min(maxHeight, prev)));
  }, [panelHeight]);

  const addTaskspace = async (pathValue: string, labelValue: string) => {
    setAdding(true);
    const result = await window.agenticxDesktop.addTaskspace({
      sessionId,
      path: pathValue.trim() || undefined,
      label: labelValue.trim() || undefined,
    });
    setAdding(false);
    if (!result.ok) {
      setErrorText(result.error ?? "添加 Taskspace 失败");
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
            title: "确认移除 Taskspace",
            message: "确认移除该 Taskspace 吗？",
            detail: "该操作仅移除关联，不会删除本地文件。",
            confirmText: "移除",
            cancelText: "取消",
            destructive: true,
          })
        : { ok: true, confirmed: window.confirm("确认移除该 Taskspace 吗？") };
    const confirmed = !!confirmResult.confirmed;
    if (!confirmed) return;
    const result = await desktop.removeTaskspace({ sessionId, taskspaceId });
    if (!result.ok) {
      setErrorText(result.error ?? "移除 Taskspace 失败");
      return;
    }
    await loadTaskspaces();
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
    setPreview({
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

  const startResizePreview = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeight = previewHeight;
    const maxHeight = panelHeight ? Math.floor(panelHeight * 0.75) : 520;
    const minHeight = 160;
    const onMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      const next = Math.max(minHeight, Math.min(maxHeight, startHeight + delta));
      setPreviewHeight(next);
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
              className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs text-text-muted hover:bg-surface-hover"
              style={{ paddingLeft }}
              onClick={() => void toggleDir(taskspaceId, item.path)}
              title={item.path}
            >
              <span className="inline-block w-3 text-center">{isExpanded ? "▾" : "▸"}</span>
              <span>{item.name}/</span>
            </button>
            {isExpanded ? renderDir(taskspaceId, item.path, depth + 1) : null}
          </div>
        );
      }
      return (
        <div key={item.path} className="flex items-center gap-1">
          <button
            className={`flex-1 rounded px-1 py-0.5 text-left text-xs hover:bg-surface-hover ${
              selectedFilePath === item.path ? "text-cyan-300" : "text-text-subtle"
            }`}
            style={{ paddingLeft }}
            title={item.path}
            onClick={() => void openFile(taskspaceId, item.path)}
          >
            {item.name}
          </button>
          <button
            className="rounded px-1 py-0.5 text-[10px] text-text-faint hover:bg-surface-hover hover:text-cyan-300"
            onClick={() => onPickFileForReference?.(item.path)}
            title="引用到输入框"
          >
            @
          </button>
        </div>
      );
    });
  };

  const highlightedCode = useMemo(() => {
    const content = preview?.content ?? "";
    const language = detectLanguage(selectedFilePath);
    const grammar = Prism.languages[language] ?? Prism.languages.clike;
    return Prism.highlight(content, grammar, language);
  }, [preview?.content, selectedFilePath]);

  return (
    <div ref={panelRef} className="flex h-full min-h-0 w-full flex-col bg-surface-panel">
      <div className="relative flex items-center gap-1 border-b border-border px-2 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {taskspaces.map((item) => (
            <button
              key={item.id}
              className={`shrink-0 rounded px-2 py-1 text-xs ${
                item.id === activeTaskspace?.id
                  ? "bg-cyan-500/20 text-cyan-300"
                  : "bg-surface-hover text-text-subtle hover:text-text-primary"
              }`}
              onClick={() => onActiveTaskspaceChange(item.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                void removeTaskspace(item.id);
              }}
              title={item.path}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button
          className="rounded bg-surface-hover px-2 py-1 text-xs text-text-muted hover:bg-surface-hover"
          onClick={() => {
            setErrorText("");
            void refreshListAndActiveTaskspace();
          }}
          title="刷新 Taskspace 列表与目录"
        >
          刷新
        </button>
        <button
          className="rounded bg-surface-hover px-2 py-1 text-xs text-text-muted hover:bg-surface-hover"
          onClick={() => {
            setShowAddForm((prev) => !prev);
            setErrorText("");
          }}
          title="新增 Taskspace"
        >
          +
        </button>
        {showAddForm ? (
          <div className="absolute right-2 top-10 z-10 w-[280px] rounded-md border border-border bg-surface-panel p-2 shadow-2xl">
            <div className="mb-1 text-[11px] text-text-subtle">新增 Taskspace</div>
            <input
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder="目录绝对路径（可留空用默认）"
              className="mb-1 w-full rounded border border-border bg-surface-panel px-2 py-1 text-[11px] text-text-primary outline-none focus:border-cyan-500/50"
            />
            <div className="mb-1 flex justify-end">
              <button
                type="button"
                className="rounded border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface-hover"
                onClick={() => void chooseDirectoryForTaskspace()}
                title="从系统目录中选择"
              >
                选择目录...
              </button>
            </div>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="显示名称（可选）"
              className="mb-2 w-full rounded border border-border bg-surface-panel px-2 py-1 text-[11px] text-text-primary outline-none focus:border-cyan-500/50"
            />
            <div className="flex items-center justify-end gap-1">
              <button
                className="rounded px-2 py-1 text-[11px] text-text-subtle hover:bg-surface-hover"
                onClick={() => {
                  setShowAddForm(false);
                  setNewPath("");
                  setNewLabel("");
                }}
              >
                取消
              </button>
              <button
                className="rounded bg-cyan-600 px-2 py-1 text-[11px] text-white hover:bg-cyan-500 disabled:opacity-50"
                disabled={adding}
                onClick={() => void addTaskspace(newPath, newLabel)}
              >
                {adding ? "添加中..." : "确认添加"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto border-b border-border px-2 py-2">
        {loading ? <div className="text-xs text-text-faint">加载中...</div> : null}
        {!loading && !activeTaskspace ? <div className="text-xs text-text-faint">暂无 Taskspace</div> : null}
        {!loading && activeTaskspace ? renderDir(activeTaskspace.id, ".", 0) : null}
      </div>
      <div
        className="group relative min-h-[14px] shrink-0 cursor-row-resize px-2 py-2 touch-none"
        onMouseDown={startResizePreview}
        title="拖拽调整代码预览高度"
      >
        <div className="pointer-events-none absolute left-2 right-2 top-1/2 h-[2px] -translate-y-1/2 bg-cyan-500/35 transition group-hover:bg-cyan-400/90" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-2 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-400/70 bg-surface-panel shadow-[0_0_10px_rgba(34,211,238,0.25)]" />
      </div>
      <div className="flex shrink-0 flex-col px-2 py-2" style={{ height: previewHeight }}>
        <div className="mb-1 truncate text-xs text-text-faint">{selectedFilePath || "文件预览"}</div>
        <pre className="min-h-0 flex-1 overflow-auto rounded bg-surface-panel p-2 text-[11px] leading-5">
          <code
            className={`language-${detectLanguage(selectedFilePath)}`}
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
          />
        </pre>
        {preview?.truncated ? (
          <div className="pt-1 text-[10px] text-amber-300">文件过大，已截断显示（{preview.size} bytes）。</div>
        ) : null}
        {errorText ? <div className="pt-1 text-[10px] text-rose-300">{errorText}</div> : null}
      </div>
    </div>
  );
}
