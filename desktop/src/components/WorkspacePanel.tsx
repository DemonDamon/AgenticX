import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-python";
import "prismjs/components/prism-typescript";
import "prismjs/themes/prism-tomorrow.css";
import type { SubAgent, Taskspace } from "../store";
import { SubAgentCard } from "./SubAgentCard";

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
  sessionId: string;
  activeTaskspaceId: string | null;
  onActiveTaskspaceChange: (taskspaceId: string | null) => void;
  onPickFileForReference?: (path: string) => void;
  autoRefreshKey?: number;
  subAgents: SubAgent[];
  selectedSubAgent: string | null;
  onCancel: (agentId: string) => void;
  onRetry: (agentId: string) => void;
  onChat: (agentId: string) => void;
  onSelect: (agentId: string) => void;
  onConfirmResolve?: (agentId: string, approved: boolean) => void;
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

export function WorkspacePanel({
  sessionId,
  activeTaskspaceId,
  onActiveTaskspaceChange,
  onPickFileForReference,
  autoRefreshKey,
  subAgents,
  selectedSubAgent,
  onCancel,
  onRetry,
  onChat,
  onSelect,
  onConfirmResolve,
}: Props) {
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
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  const [spawnsHeight, setSpawnsHeight] = useState(220);

  const activeTaskspace = useMemo(
    () => taskspaces.find((item) => item.id === activeTaskspaceId) ?? taskspaces[0] ?? null,
    [taskspaces, activeTaskspaceId]
  );

  const maxSpawnsHeight = panelHeight > 0 ? Math.floor(panelHeight * 0.7) : 520;
  const minSpawnsHeight = 140;
  const safeSpawnsHeight = Math.max(minSpawnsHeight, Math.min(maxSpawnsHeight, spawnsHeight));

  useEffect(() => {
    setSpawnsHeight((prev) => Math.max(minSpawnsHeight, Math.min(maxSpawnsHeight, prev)));
  }, [maxSpawnsHeight]);

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

  useEffect(() => {
    if (!panelRef.current) return;
    const element = panelRef.current;
    const syncHeight = () => setPanelHeight(element.clientHeight);
    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const addTaskspace = async (pathValue: string, labelValue: string) => {
    setAdding(true);
    const result = await window.agenticxDesktop.addTaskspace({
      sessionId,
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
    const confirmed = window.confirm("确认移除该工作区吗？");
    if (!confirmed) return;
    const result = await window.agenticxDesktop.removeTaskspace({ sessionId, taskspaceId });
    if (!result.ok) {
      setErrorText(result.error ?? "移除工作区失败");
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

  const startResizeSpawns = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = safeSpawnsHeight;
    const onMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      const next = Math.max(minSpawnsHeight, Math.min(maxSpawnsHeight, startHeight + delta));
      setSpawnsHeight(next);
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
            className={`flex-1 rounded px-1 py-0.5 text-left text-xs transition hover:bg-surface-hover ${
              selectedFilePath === item.path ? "text-text-strong" : "text-text-subtle"
            }`}
            style={{ paddingLeft }}
            title={item.path}
            onClick={() => void openFile(taskspaceId, item.path)}
          >
            {item.name}
          </button>
          <button
            className="rounded px-1 py-0.5 text-[10px] text-text-faint transition hover:bg-surface-hover hover:text-text-muted"
            onClick={() => onPickFileForReference?.(item.path)}
            title="引用到输入框"
          >
            @
          </button>
        </div>
      );
    });
  };

  return (
    <div ref={panelRef} className="relative flex h-full min-h-0 w-full flex-col bg-surface-panel">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="relative flex items-center gap-1 border-b border-border px-2 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {taskspaces.map((item) => (
              <button
                key={item.id}
                className={`shrink-0 rounded px-2 py-1 text-xs transition ${
                  item.id === activeTaskspace?.id
                    ? "text-text-strong"
                    : "text-text-subtle hover:text-text-primary hover:bg-surface-hover"
                }`}
                style={item.id === activeTaskspace?.id ? {
                  background: "var(--ui-accent-surface)",
                  color: "var(--ui-accent-text)",
                } : {}}
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
            title="刷新工作区列表与目录"
          >
            刷新
          </button>
          <button
            className="rounded bg-surface-hover px-2 py-1 text-xs text-text-muted hover:bg-surface-hover"
            onClick={() => {
              setShowAddForm((prev) => !prev);
              setErrorText("");
            }}
            title="新增工作区"
          >
            +
          </button>
          {showAddForm ? (
            <div className="absolute right-2 top-10 z-10 w-[280px] rounded-md border border-border bg-surface-panel p-2 shadow-2xl">
              <div className="mb-1 text-[11px] text-text-subtle">新增工作区</div>
              <input
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="目录绝对路径（可留空用默认）"
                className="mb-1 w-full rounded border border-border bg-surface-panel px-2 py-1 text-[11px] text-text-primary outline-none focus:border-border-strong"
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
                className="mb-2 w-full rounded border border-border bg-surface-panel px-2 py-1 text-[11px] text-text-primary outline-none focus:border-border-strong"
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
                  className="rounded px-2 py-1 text-[11px] disabled:opacity-50 transition"
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
          {loading ? <div className="text-xs text-text-faint">加载中...</div> : null}
          {!loading && !activeTaskspace ? <div className="text-xs text-text-faint">暂无工作区</div> : null}
          {!loading && activeTaskspace ? renderDir(activeTaskspace.id, ".", 0) : null}
        </div>
      </div>

      <div
        className="group relative shrink-0 cursor-row-resize px-2"
        onMouseDown={startResizeSpawns}
        title="拖拽调整 Spawns 区域高度"
      >
        <div className="h-px transition" style={{ background: "var(--ui-accent-divider)" }} />
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-surface-panel opacity-60 transition group-hover:opacity-90"
          style={{ borderColor: "var(--ui-accent-divider-hover)" }}
        />
      </div>

      <div className="shrink-0 overflow-y-auto px-2 py-2" style={{ height: safeSpawnsHeight }}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs text-text-subtle">Spawns ({subAgents.length})</span>
          <span className="text-[10px] text-text-faint">仅当前会话</span>
        </div>
        {subAgents.length === 0 ? (
          <div className="rounded-md border border-border bg-surface-card px-2 py-3 text-xs text-text-faint">
            当前工作区还没有派生子智能体
          </div>
        ) : (
          <div className="space-y-2">
            {subAgents.map((subAgent) => (
              <SubAgentCard
                key={subAgent.id}
                subAgent={subAgent}
                selected={selectedSubAgent === subAgent.id}
                onCancel={onCancel}
                onRetry={onRetry}
                onChat={onChat}
                onSelect={onSelect}
                onConfirmResolve={onConfirmResolve}
              />
            ))}
          </div>
        )}
      </div>

      {filePreview ? (
        <div className="absolute inset-2 z-30 flex min-h-0 flex-col rounded-lg border border-border-strong bg-surface-panel shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="truncate text-xs text-text-subtle">{filePreview.path}</div>
            <button
              className="rounded border border-border px-2 py-0.5 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text-strong"
              onClick={() => setFilePreview(null)}
            >
              关闭
            </button>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto px-3 py-2 text-[11px] leading-5">
            <code
              className={`language-${detectLanguage(filePreview.path)}`}
              dangerouslySetInnerHTML={{ __html: highlightedCode }}
            />
          </pre>
          {filePreview.truncated ? (
            <div className="border-t border-border px-3 py-1 text-[10px] text-amber-300">
              文件过大，已截断显示（{filePreview.size} bytes）。
            </div>
          ) : null}
        </div>
      ) : null}

      {errorText ? (
        <div className="border-t border-border px-2 py-1 text-[10px] text-rose-300">{errorText}</div>
      ) : null}
    </div>
  );
}
