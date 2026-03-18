import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ErrorInfo, ReactNode, MouseEvent as ReactMouseEvent } from "react";
import { useAppStore, type Message, type MessageAttachment } from "../store";
import { startRecording, stopRecording } from "../voice/stt";
import { SessionHistoryPanel } from "./SessionHistoryPanel";
import { WorkspacePanel } from "./WorkspacePanel";
import { MessageRenderer } from "./messages/MessageRenderer";
import { WorkingIndicator } from "./messages/WorkingIndicator";
import { ImBubble } from "./messages/ImBubble";
import { TerminalLine } from "./messages/TerminalLine";
import { CleanBlock } from "./messages/CleanBlock";

const NEW_TOPIC_PREF_KEY = "agx:newTopicInherit";

function NewTopicButton({ onNewTopic }: { onNewTopic: (inherit: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [inherit, setInherit] = useState(() => {
    try { return localStorage.getItem(NEW_TOPIC_PREF_KEY) === "1"; } catch { return false; }
  });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const pick = (val: boolean) => {
    setInherit(val);
    try { localStorage.setItem(NEW_TOPIC_PREF_KEY, val ? "1" : "0"); } catch { /* noop */ }
    setOpen(false);
    onNewTopic(val);
  };

  return (
    <div ref={ref} className="relative flex shrink-0">
      <button
        className="h-9 rounded-l-lg border border-r-0 border-border px-2.5 text-xs text-text-muted transition hover:bg-surface-hover"
        onClick={() => onNewTopic(inherit)}
        title={inherit ? "新对话（继承上下文）" : "新对话（全新开始）"}
      >
        新对话
      </button>
      <button
        className="h-9 rounded-r-lg border border-border px-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
        onClick={() => setOpen((prev) => !prev)}
        title="切换默认模式"
      >
        ▾
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 z-50 mb-1 min-w-[170px] rounded-md border border-border bg-surface-panel p-1 shadow-2xl backdrop-blur-xl">
          <button
            className="flex w-full items-center gap-1.5 rounded px-2.5 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onClick={() => pick(false)}
          >
            <span className="w-4 text-center text-cyan-400">{inherit ? "" : "✓"}</span>
            <span>全新对话</span>
            <span className="ml-auto text-[10px] text-text-faint">不继承</span>
          </button>
          <button
            className="flex w-full items-center gap-1.5 rounded px-2.5 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onClick={() => pick(true)}
          >
            <span className="w-4 text-center text-cyan-400">{inherit ? "✓" : ""}</span>
            <span>继承上下文</span>
            <span className="ml-auto text-[10px] text-text-faint">携带摘要</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

class HistoryPanelBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; retryCount: number }
> {
  state = { hasError: false, retryCount: 0 };
  private _retryTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("[HistoryPanelBoundary]", error.message, info.componentStack?.slice(0, 200));
    if (this.state.retryCount < 2) {
      this._retryTimer = setTimeout(() => {
        this.setState((prev) => ({ hasError: false, retryCount: prev.retryCount + 1 }));
      }, 300);
    }
  }

  componentWillUnmount() {
    if (this._retryTimer) clearTimeout(this._retryTimer);
  }

  render() {
    if (this.state.hasError) {
      if (this.state.retryCount < 2) return null;
      return (
        <div className="h-full w-[220px] shrink-0 border-l border-border bg-surface-panel flex items-center justify-center">
          <button
            className="rounded px-3 py-2 text-xs text-text-subtle hover:bg-surface-hover hover:text-text-strong"
            onClick={() => this.setState({ hasError: false, retryCount: 0 })}
          >
            历史面板出错，点击重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function PaneModelPicker() {
  const settings = useAppStore((s) => s.settings);
  const activeProvider = useAppStore((s) => s.activeProvider);
  const activeModel = useAppStore((s) => s.activeModel);
  const setActiveModel = useAppStore((s) => s.setActiveModel);
  const [open, setOpen] = useState(false);

  const handleSelect = (provider: string, model: string) => {
    setActiveModel(provider, model);
    setOpen(false);
    // Persist selected provider/model so it survives app restarts
    void window.agenticxDesktop.saveConfig({ activeProvider: provider, activeModel: model });
  };

  const options = useMemo(() => {
    const result: { provider: string; model: string; label: string }[] = [];
    for (const [provName, entry] of Object.entries(settings.providers)) {
      if (!entry.apiKey) continue;
      if (entry.models.length > 0) {
        for (const m of entry.models) result.push({ provider: provName, model: m, label: `${provName}/${m}` });
      } else if (entry.model) {
        result.push({ provider: provName, model: entry.model, label: `${provName}/${entry.model}` });
      }
    }
    return result;
  }, [settings.providers]);

  const currentLabel = activeModel ? `${activeProvider}/${activeModel}` : "未选模型";

  return (
    <div className="relative">
      <button
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
        onClick={() => setOpen((v) => !v)}
        title="切换模型"
      >
        <span className="max-w-[180px] truncate">{currentLabel}</span>
        <span className="text-[9px]">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-40 mb-1 max-h-[220px] w-[240px] overflow-y-auto rounded-lg border border-border bg-surface-panel shadow-xl backdrop-blur-xl">
            {options.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs text-text-faint">
                请先在设置中配置模型
              </div>
            ) : (
              options.map((opt) => {
                const isActive = opt.provider === activeProvider && opt.model === activeModel;
                return (
                  <button
                    key={`${opt.provider}:${opt.model}`}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-surface-hover hover:text-text-strong ${
                      isActive ? "text-cyan-300 bg-cyan-500/10" : "text-text-muted"
                    }`}
                    onClick={() => handleSelect(opt.provider, opt.model)}
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? "bg-cyan-400" : "bg-surface-hover"}`} />
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <rect x="9" y="2" width="6" height="13" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <line x1="8" y1="21" x2="16" y2="21" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}

type ActionCircleButtonProps = {
  hasInput: boolean;
  streaming: boolean;
  recording: boolean;
  onSend: () => void;
  onMic: () => void;
  onStop: () => void;
};

function ActionCircleButton({ hasInput, streaming, recording, onSend, onMic, onStop }: ActionCircleButtonProps) {
  let onClick: () => void;
  let title: string;
  let icon: ReactNode;
  let filled: boolean;

  if (streaming) {
    onClick = onStop;
    title = "中断生成";
    icon = <StopIcon />;
    filled = false;
  } else if (hasInput) {
    onClick = onSend;
    title = "发送";
    icon = <SendIcon />;
    filled = true;
  } else if (recording) {
    onClick = onMic;
    title = "停止录音";
    icon = (
      <span className="flex gap-0.5 items-end h-4">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="w-0.5 rounded-full animate-pulse"
            style={{
              background: "currentColor",
              height: `${[8, 14, 10, 12][i]}px`,
              animationDelay: `${i * 0.12}s`,
            }}
          />
        ))}
      </span>
    );
    filled = false;
  } else {
    onClick = onMic;
    title = "语音输入";
    icon = <MicIcon />;
    filled = false;
  }

  return (
    <button
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all duration-150 active:scale-95 ${
        filled ? "" : "text-text-faint hover:text-text-muted"
      }`}
      style={
        filled
          ? { background: "var(--ui-btn-primary-bg)", color: "var(--ui-btn-primary-text)" }
          : undefined
      }
      onClick={onClick}
      title={title}
    >
      {icon}
    </button>
  );
}

function AttachmentChip({ file, onRemove }: { file: AttachedFile; onRemove: () => void }) {
  const isImage = !!file.dataUrl || file.mimeType.startsWith("image/");
  return (
    <div className="inline-flex max-w-[260px] items-center gap-2 rounded-lg border border-border bg-surface-panel px-2 py-1 text-xs">
      {isImage && file.dataUrl ? (
        <img src={file.dataUrl} alt={file.name} className="h-8 w-8 shrink-0 rounded object-cover" />
      ) : (
        <span className="text-sm text-text-faint">{file.status === "error" ? "⚠️" : "📄"}</span>
      )}
      <div className="min-w-0">
        <div className="truncate text-text-muted">{file.name}</div>
        {file.status === "parsing" ? (
          <div className="text-[10px] text-text-faint animate-pulse">解析中...</div>
        ) : file.status === "error" ? (
          <div className="text-[10px] text-status-error">{file.errorText || "解析失败"}</div>
        ) : (
          <div className="text-[10px] text-text-faint">{formatFileSize(file.size)}</div>
        )}
      </div>
      <button
        className="shrink-0 rounded px-1 text-text-faint transition hover:bg-surface-hover hover:text-text-muted"
        onClick={onRemove}
        title="移除附件"
      >
        ✕
      </button>
    </div>
  );
}

type Props = {
  paneId: string;
  focused: boolean;
  onFocus: () => void;
  onOpenConfirm: (
    requestId: string,
    question: string,
    diff?: string,
    agentId?: string,
    context?: Record<string, unknown>
  ) => Promise<boolean>;
};

function ModelBadge({ provider, model }: { provider?: string; model?: string }) {
  if (!model) return null;
  const label = provider ? `${provider}/${model}` : model;
  return (
    <span className="mb-1 inline-block rounded bg-surface-card-strong px-1.5 py-0.5 text-[10px] text-text-faint">
      {label}
    </span>
  );
}

function isThinkingPlaceholderText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return /^[\s⏳….·.]+$/.test(trimmed);
}

function formatToolResultMessage(toolNameRaw: unknown, resultRaw: unknown): { content: string; silent: boolean } {
  const toolName = String(toolNameRaw ?? "tool");
  const resultText = String(resultRaw ?? "");
  if (toolName === "spawn_subagent") {
    try {
      const parsed = JSON.parse(resultText) as Record<string, unknown>;
      const agentId = String(parsed.agent_id ?? "").trim();
      const name = String(parsed.name ?? (agentId || "subagent"));
      const role = String(parsed.role ?? "worker");
      const provider = String(parsed.provider ?? "").trim();
      const model = String(parsed.model ?? "").trim();
      const task = String(parsed.task ?? "").replace(/\s+/g, " ").trim();
      const modelLabel = provider && model ? ` · ${provider}/${model}` : "";
      const taskPreview = task ? `\n任务: ${task.slice(0, 140)}${task.length > 140 ? "…" : ""}` : "";
      return {
        content: `🚀 已启动子智能体: ${name} (${role})${modelLabel}${agentId ? `\nID: ${agentId}` : ""}${taskPreview}`,
        silent: false,
      };
    } catch {
      // Fall through to generic formatter.
    }
  }
  if (toolName === "todo_write") {
    const cleaned = resultText.replace(/\s+\n/g, "\n").trim();
    if (/^\[[ xX]\]/m.test(cleaned)) {
      return { content: `🗂 任务清单更新\n${cleaned}`, silent: false };
    }
  }
  if (toolName === "query_subagent_status") {
    if (/【已阻止】/.test(resultText)) {
      return { content: "", silent: true };
    }
    try {
      const parsed = JSON.parse(resultText) as Record<string, unknown>;
      const one = parsed?.subagent as Record<string, unknown> | undefined;
      if (one) {
        const name = String(one.name ?? one.agent_id ?? "subagent");
        const status = String(one.status ?? "unknown");
        const action = String(one.current_action ?? "").trim();
        return {
          content: `📡 状态快照: ${name} = ${status}${action ? ` · ${action}` : ""}`,
          silent: false,
        };
      }
      const rows = Array.isArray(parsed?.subagents) ? (parsed.subagents as Array<Record<string, unknown>>) : [];
      if (rows.length > 0) {
        const counts = rows.reduce<Record<string, number>>(
          (acc, row) => {
            const s = String(row.status ?? "unknown");
            acc[s] = (acc[s] ?? 0) + 1;
            return acc;
          },
          {}
        );
        const summary = Object.entries(counts)
          .map(([k, v]) => `${k}:${v}`)
          .join(" ");
        return { content: `📡 状态快照: ${rows.length} 个子智能体 (${summary})`, silent: false };
      }
    } catch {
      // Fall through to generic formatter.
    }
  }
  const compact = resultText.slice(0, 500);
  const isError = /^\s*ERROR:/i.test(resultText);
  const isBenignTodoConflict =
    toolName === "todo_write" && /only one task can be in_progress/i.test(resultText);

  if (isBenignTodoConflict) {
    return {
      content: "🧭 任务清单同步中：系统会自动收敛为单一进行中任务，无需操作。",
      silent: false,
    };
  }
  if (isError) {
    return { content: `⚠️ ${toolName} 提示: ${compact}`, silent: false };
  }
  return { content: `✅ ${toolName} 结果: ${compact}`, silent: false };
}

function isSetTaskspaceToolSuccess(resultRaw: unknown): boolean {
  if (resultRaw && typeof resultRaw === "object") {
    return (resultRaw as { ok?: unknown }).ok === true;
  }
  if (typeof resultRaw !== "string") return false;
  const text = resultRaw.trim();
  if (!text) return false;
  try {
    const parsed = JSON.parse(text) as { ok?: unknown };
    return parsed?.ok === true;
  } catch {
    return false;
  }
}

function buildToolCallLivePreview(toolNameRaw: unknown, argsRaw: unknown): string | null {
  const toolName = String(toolNameRaw ?? "").trim();
  const args = (argsRaw ?? {}) as Record<string, unknown>;
  if (toolName === "file_write") {
    const path = String(args.path ?? "").trim();
    const content = String(args.content ?? "");
    if (!content.trim()) return null;
    const preview = content.slice(0, 1200);
    return `# file_write: ${path || "(unknown path)"}\n${preview}${content.length > 1200 ? "\n... (truncated)" : ""}`;
  }
  if (toolName === "file_edit") {
    const path = String(args.path ?? "").trim();
    const newText = String(args.new_text ?? "");
    if (!newText.trim()) return null;
    const preview = newText.slice(0, 1200);
    return `# file_edit: ${path || "(unknown path)"}\n${preview}${newText.length > 1200 ? "\n... (truncated)" : ""}`;
  }
  return null;
}

const TASKSPACE_WIDTH_STORAGE_KEY = "agenticx:taskspace-panel-width";
const TEXT_ATTACHMENT_LIMIT = 32000;

type AttachedFileStatus = "parsing" | "ready" | "error";

type AttachedFile = {
  name: string;
  size: number;
  mimeType: string;
  status: AttachedFileStatus;
  content: string;
  dataUrl?: string;
  errorText?: string;
};

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

function isLikelyTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  const lower = file.name.toLowerCase();
  return [
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".json",
    ".md",
    ".txt",
    ".yaml",
    ".yml",
    ".sh",
    ".bash",
    ".toml",
    ".xml",
    ".csv",
    ".sql",
  ].some((ext) => lower.endsWith(ext));
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
}

type AtCandidate =
  | {
      kind: "file";
      taskspaceId: string;
      path: string;
      label: string;
    }
  | {
      kind: "taskspace";
      taskspaceId: string;
      path: string;
      label: string;
      alias: string;
    };

export function ChatPane({ paneId, focused, onFocus, onOpenConfirm }: Props) {
  const pane = useAppStore((s) => s.panes.find((item) => item.id === paneId));
  const removePane = useAppStore((s) => s.removePane);
  const togglePaneHistory = useAppStore((s) => s.togglePaneHistory);
  const toggleTaskspacePanel = useAppStore((s) => s.toggleTaskspacePanel);
  const setActiveTaskspace = useAppStore((s) => s.setActiveTaskspace);
  const addPaneMessage = useAppStore((s) => s.addPaneMessage);
  const clearPaneMessages = useAppStore((s) => s.clearPaneMessages);
  const setPaneSessionId = useAppStore((s) => s.setPaneSessionId);
  const setPaneContextInherited = useAppStore((s) => s.setPaneContextInherited);
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);
  const activeProvider = useAppStore((s) => s.activeProvider);
  const activeModel = useAppStore((s) => s.activeModel);
  const selectedSubAgent = useAppStore((s) => s.selectedSubAgent);
  const setSelectedSubAgent = useAppStore((s) => s.setSelectedSubAgent);
  const addSubAgent = useAppStore((s) => s.addSubAgent);
  const updateSubAgent = useAppStore((s) => s.updateSubAgent);
  const addSubAgentEvent = useAppStore((s) => s.addSubAgentEvent);
  const subAgents = useAppStore((s) => s.subAgents);
  const avatars = useAppStore((s) => s.avatars);
  const chatStyle = useAppStore((s) => s.chatStyle);

  const paneAvatarMeta = useMemo(() => {
    const aid = pane?.avatarId;
    if (!aid || aid.startsWith("group:")) return { name: pane?.avatarName || "AI", url: undefined };
    const found = avatars.find((a) => a.id === aid);
    return {
      name: found?.name || pane?.avatarName || "AI",
      url: found?.avatarUrl || undefined,
    };
  }, [pane?.avatarId, pane?.avatarName, avatars]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [recording, setRecording] = useState(false);
  const [streamedAssistantText, setStreamedAssistantText] = useState("");
  const [streamingModel, setStreamingModel] = useState<{ provider: string; model: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamTextRef = useRef("");
  const streamCommittedRef = useRef(false);
  const streamRafRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const imeComposingRef = useRef(false);
  const [atOpen, setAtOpen] = useState(false);
  const [atQuery, setAtQuery] = useState("");
  const [atCandidates, setAtCandidates] = useState<AtCandidate[]>([]);
  const [contextFiles, setContextFiles] = useState<Record<string, AttachedFile>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [taskspaceAutoRefreshKey, setTaskspaceAutoRefreshKey] = useState(0);
  const [taskspaceWidth, setTaskspaceWidth] = useState(() => {
    try {
      const raw = window.localStorage.getItem(TASKSPACE_WIDTH_STORAGE_KEY);
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    } catch {
      // ignore storage access failures
    }
    return 340;
  });
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [paneWidth, setPaneWidth] = useState(0);

  const visibleMessages = useMemo(
    () => (pane?.messages ?? []).filter((item) => !item.agentId || item.agentId === "meta"),
    [pane?.messages]
  );
  const paneSubAgents = useMemo(() => {
    const sid = (pane?.sessionId ?? "").trim();
    if (!sid) return [];
    return subAgents.filter((item) => (item.sessionId ?? "").trim() === sid);
  }, [pane?.sessionId, subAgents]);
  const attachmentEntries = useMemo(() => Object.entries(contextFiles), [contextFiles]);
  const readyAttachments = useMemo(
    () => attachmentEntries.filter(([, file]) => file.status === "ready").map(([, file]) => file),
    [attachmentEntries]
  );

  useEffect(() => {
    requestAnimationFrame(() => {
      if (listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      }
    });
  }, [visibleMessages, streamedAssistantText]);

  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, []);

  useEffect(() => {
    if (!paneRef.current) return;
    const target = paneRef.current;
    const update = () => setPaneWidth(target.clientWidth);
    update();
    const observer = new ResizeObserver(() => update());
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  if (!pane) return null;

  const cancelStreamRenderFrame = () => {
    if (streamRafRef.current !== null) {
      window.cancelAnimationFrame(streamRafRef.current);
      streamRafRef.current = null;
    }
  };

  const searchAtCandidates = async (queryText: string) => {
    if (!pane.sessionId) return;
    const wsResp = await window.agenticxDesktop.listTaskspaces(pane.sessionId);
    if (!wsResp.ok || !Array.isArray(wsResp.workspaces) || wsResp.workspaces.length === 0) {
      setAtCandidates([]);
      return;
    }
    const activeId = pane.activeTaskspaceId && wsResp.workspaces.some((item) => item.id === pane.activeTaskspaceId)
      ? pane.activeTaskspaceId
      : wsResp.workspaces[0].id;
    if (!pane.activeTaskspaceId) setActiveTaskspace(pane.id, activeId);
    const rootResp = await window.agenticxDesktop.listTaskspaceFiles({
      sessionId: pane.sessionId,
      taskspaceId: activeId,
      path: ".",
    });
    if (!rootResp.ok || !Array.isArray(rootResp.files)) {
      setAtCandidates([]);
      return;
    }
    const flatRows: AtCandidate[] = [];
    const folderRows: Extract<AtCandidate, { kind: "taskspace" }>[] = wsResp.workspaces.map((item) => ({
      kind: "taskspace",
      taskspaceId: item.id,
      path: item.path,
      label: item.label || item.path.split("/").filter(Boolean).pop() || "taskspace",
      alias: item.label || item.path.split("/").filter(Boolean).pop() || "taskspace",
    }));
    const queue: string[] = ["."];
    const visited = new Set<string>();
    while (queue.length > 0 && flatRows.length < 200) {
      const current = queue.shift() || ".";
      if (visited.has(current)) continue;
      visited.add(current);
      const listResp =
        current === "."
          ? rootResp
          : await window.agenticxDesktop.listTaskspaceFiles({
              sessionId: pane.sessionId,
              taskspaceId: activeId,
              path: current,
            });
      if (!listResp.ok || !Array.isArray(listResp.files)) continue;
      for (const row of listResp.files) {
        if (row.type === "file") {
          flatRows.push({ kind: "file", taskspaceId: activeId, path: row.path, label: row.name });
          continue;
        }
        if (row.type === "dir" && !visited.has(row.path) && queue.length < 200) {
          queue.push(row.path);
        }
      }
    }
    const lowered = queryText.trim().toLowerCase();
    const filteredFiles = !lowered
      ? flatRows.slice(0, 20)
      : flatRows.filter((item) => item.path.toLowerCase().includes(lowered)).slice(0, 20);
    const filteredFolders = !lowered
      ? folderRows.slice(0, 8)
      : folderRows
          .filter(
            (item) =>
              item.alias.toLowerCase().includes(lowered) ||
              item.path.toLowerCase().includes(lowered)
          )
          .slice(0, 8);
    setAtCandidates([...filteredFolders, ...filteredFiles].slice(0, 24));
  };

  const addContextFile = async (taskspaceId: string, relPath: string) => {
    if (!pane.sessionId || !relPath) return;
    const fileResp = await window.agenticxDesktop.readTaskspaceFile({
      sessionId: pane.sessionId,
      taskspaceId,
      path: relPath,
    });
    if (!fileResp.ok || typeof fileResp.content !== "string") return;
    const key = String(fileResp.absolute_path || relPath);
    const content = (fileResp.content ?? "").slice(0, TEXT_ATTACHMENT_LIMIT);
    setContextFiles((prev) => ({
      ...prev,
      [key]: {
        name: key.split("/").pop() || key,
        size: content.length,
        mimeType: "text/plain",
        status: "ready",
        content,
      },
    }));
  };

  const addTaskspaceAliasReference = async (taskspaceId: string, alias: string, absolutePath: string) => {
    if (!pane.sessionId) return;
    const queue: string[] = ["."];
    const visited = new Set<string>();
    const lines: string[] = [];
    let fileCount = 0;
    const maxFiles = 160;
    while (queue.length > 0 && fileCount < maxFiles) {
      const current = queue.shift() || ".";
      if (visited.has(current)) continue;
      visited.add(current);
      const listResp = await window.agenticxDesktop.listTaskspaceFiles({
        sessionId: pane.sessionId,
        taskspaceId,
        path: current,
      });
      if (!listResp.ok || !Array.isArray(listResp.files)) continue;
      for (const row of listResp.files) {
        if (row.type === "dir") {
          if (!visited.has(row.path)) queue.push(row.path);
          continue;
        }
        lines.push(`- ${row.path}`);
        fileCount += 1;
        if (fileCount >= maxFiles) break;
      }
    }
    const summary = [
      `# directory_alias: ${alias}`,
      `path: ${absolutePath}`,
      "",
      "files:",
      ...lines,
      fileCount >= maxFiles ? "- ... (truncated)" : "",
    ]
      .filter(Boolean)
      .join("\n");
    const key = `@dir:${alias}:${absolutePath}`;
    const content = summary.slice(0, 16000);
    setContextFiles((prev) => ({
      ...prev,
      [key]: {
        name: key,
        size: content.length,
        mimeType: "text/plain",
        status: "ready",
        content,
      },
    }));
  };

  const revealFileInTaskspace = useCallback(async (absPath: string) => {
    if (!pane.sessionId) return;
    const cleanPath = String(absPath || "").trim();
    if (!cleanPath) return;
    const dirPath = cleanPath.includes("/") ? cleanPath.slice(0, cleanPath.lastIndexOf("/")) : cleanPath;
    const result = await window.agenticxDesktop.addTaskspace({
      sessionId: pane.sessionId,
      path: dirPath,
      label: dirPath.split("/").pop() || "taskspace",
    });
    if (result.ok && result.workspace?.id) {
      setActiveTaskspace(pane.id, result.workspace.id);
      if (!pane.taskspacePanelOpen) toggleTaskspacePanel(pane.id);
    }
  }, [pane.id, pane.sessionId, pane.taskspacePanelOpen, setActiveTaskspace, toggleTaskspacePanel]);

  const renderedMessages = useMemo(() => (
    <>
      {visibleMessages.map((message) => (
        <MessageRenderer
          key={message.id}
          message={message}
          assistantBadge={message.role === "assistant" ? <ModelBadge provider={message.provider} model={message.model} /> : undefined}
          onRevealPath={(path) => void revealFileInTaskspace(path)}
          assistantName={paneAvatarMeta.name}
          assistantAvatarUrl={paneAvatarMeta.url}
        />
      ))}
      {streaming ? (
        streamedAssistantText && !isThinkingPlaceholderText(streamedAssistantText) ? (
          chatStyle === "terminal" ? (
            <TerminalLine
              message={{ id: "__stream__", role: "assistant", content: streamedAssistantText }}
              badge={streamingModel ? <ModelBadge provider={streamingModel.provider} model={streamingModel.model} /> : undefined}
            />
          ) : chatStyle === "clean" ? (
            <CleanBlock
              message={{ id: "__stream__", role: "assistant", content: streamedAssistantText }}
              badge={streamingModel ? <ModelBadge provider={streamingModel.provider} model={streamingModel.model} /> : undefined}
            />
          ) : (
            <ImBubble
              message={{ id: "__stream__", role: "assistant", content: streamedAssistantText }}
              badge={streamingModel ? <ModelBadge provider={streamingModel.provider} model={streamingModel.model} /> : undefined}
              assistantName={paneAvatarMeta.name}
              assistantAvatarUrl={paneAvatarMeta.url}
            />
          )
        ) : (
          chatStyle === "terminal" ? (
            <div className="font-mono text-[13px] leading-6">
              <div className="flex items-start gap-2">
                <span className="mt-[2px] select-none text-xs" style={{ color: "var(--chat-terminal-meta)" }}>
                  ┃
                </span>
                <div className="min-w-0 flex-1">
                  {streamingModel ? <ModelBadge provider={streamingModel.provider} model={streamingModel.model} /> : null}
                  <WorkingIndicator text="Thinking..." />
                </div>
              </div>
            </div>
          ) : chatStyle === "clean" ? (
            <div
              className="w-full rounded-md border px-3 py-2"
              style={{
                background: "var(--chat-clean-assistant-bg)",
                borderColor: "var(--chat-clean-assistant-border)",
              }}
            >
              {streamingModel ? <ModelBadge provider={streamingModel.provider} model={streamingModel.model} /> : null}
              <WorkingIndicator text="Thinking..." />
            </div>
          ) : (
            <div className="mr-8 min-w-0 overflow-hidden rounded-xl rounded-tl-sm border border-border bg-surface-bubble px-3 py-2 text-sm">
              {streamingModel ? <ModelBadge provider={streamingModel.provider} model={streamingModel.model} /> : null}
              <div className="mt-1">
                <WorkingIndicator text="Thinking..." />
              </div>
            </div>
          )
        )
      ) : null}
    </>
  ), [chatStyle, paneAvatarMeta, revealFileInTaskspace, streamedAssistantText, streaming, streamingModel, visibleMessages]);

  const removeAttachment = useCallback((key: string) => {
    setContextFiles((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const parseLocalFile = useCallback((file: File, key: string) => {
    setContextFiles((prev) => ({
      ...prev,
      [key]: {
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        status: "parsing",
        content: "",
      },
    }));

    if (isImageFile(file)) {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : "";
        setContextFiles((prev) => ({
          ...prev,
          [key]: {
            name: file.name,
            size: file.size,
            mimeType: file.type || "image/*",
            status: "ready",
            content: `[图片: ${file.name}]`,
            dataUrl,
          },
        }));
      };
      reader.onerror = () => {
        setContextFiles((prev) => ({
          ...prev,
          [key]: {
            name: file.name,
            size: file.size,
            mimeType: file.type || "image/*",
            status: "error",
            content: "",
            errorText: "图片解析失败",
          },
        }));
      };
      reader.readAsDataURL(file);
      return;
    }

    if (isLikelyTextFile(file)) {
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === "string" ? reader.result : "";
        setContextFiles((prev) => ({
          ...prev,
          [key]: {
            name: file.name,
            size: file.size,
            mimeType: file.type || "text/plain",
            status: "ready",
            content: text.slice(0, TEXT_ATTACHMENT_LIMIT),
          },
        }));
      };
      reader.onerror = () => {
        setContextFiles((prev) => ({
          ...prev,
          [key]: {
            name: file.name,
            size: file.size,
            mimeType: file.type || "text/plain",
            status: "error",
            content: "",
            errorText: "文本解析失败",
          },
        }));
      };
      reader.readAsText(file);
      return;
    }

    setContextFiles((prev) => ({
      ...prev,
      [key]: {
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        status: "error",
        content: "",
        errorText: "不支持的文件格式",
      },
    }));
  }, []);

  const onMicClick = () => {
    if (recording) {
      stopRecording();
      setRecording(false);
      return;
    }
    setRecording(true);
    void startRecording(
      async (text) => {
        setRecording(false);
        await sendChat(text);
      },
      () => {
        // Keep UI simple in pane mode: no interim transcript rendering.
      }
    );
    window.setTimeout(() => {
      stopRecording();
      setRecording(false);
    }, 5000);
  };

  const sendChat = async (userText: string) => {
    const text = userText.trim();
    if (!text || !apiBase || !pane.sessionId) return;
    if (streaming) return;
    const requestSessionId = pane.sessionId;
    const userAttachments: MessageAttachment[] = readyAttachments.map((file) => ({
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      dataUrl: file.dataUrl,
    }));

    const selectedIsPaneSubagent =
      !!selectedSubAgent && paneSubAgents.some((item) => item.id === selectedSubAgent);
    const targetAgentId = selectedIsPaneSubagent ? selectedSubAgent : "meta";
    if (targetAgentId === "meta") {
      addPaneMessage(pane.id, "user", text, "meta", undefined, undefined, userAttachments);
    } else {
      addSubAgentEvent(targetAgentId, { type: "user", content: text });
      addPaneMessage(pane.id, "tool", `🗣 发送给 ${targetAgentId}: ${text}`, "meta");
    }
    setInput("");
    setStreaming(true);
    cancelStreamRenderFrame();
    setStreamedAssistantText("");
    setStreamingModel(activeModel ? { provider: activeProvider, model: activeModel } : null);
    streamTextRef.current = "";
    streamCommittedRef.current = false;
    const abortController = new AbortController();
    abortRef.current = abortController;
    const commitCurrentStreamIfNeeded = () => {
      const partial = streamTextRef.current.trim();
      if (!partial || isThinkingPlaceholderText(partial) || streamCommittedRef.current) return false;
      addPaneMessage(pane.id, "assistant", streamTextRef.current, "meta", activeProvider, activeModel);
      streamCommittedRef.current = true;
      return true;
    };
    const scheduleStreamTextUpdate = (nextText: string) => {
      streamTextRef.current = nextText;
      if (abortController.signal.aborted) return;
      if (streamRafRef.current !== null) return;
      streamRafRef.current = window.requestAnimationFrame(() => {
        streamRafRef.current = null;
        if (!abortController.signal.aborted) setStreamedAssistantText(streamTextRef.current);
      });
    };

    try {
      const body: Record<string, unknown> = { session_id: requestSessionId, user_input: text };
      if (activeProvider) body.provider = activeProvider;
      if (activeModel) body.model = activeModel;
      if (targetAgentId !== "meta") body.agent_id = targetAgentId;
      if (attachmentEntries.length > 0) {
        const contextFilePayload: Record<string, string> = {};
        for (const [, file] of attachmentEntries) {
          if (file.status !== "ready") continue;
          if (file.dataUrl || file.mimeType.startsWith("image/")) {
            contextFilePayload[file.name] = "[图片文件]";
          } else {
            contextFilePayload[file.name] = file.content;
          }
        }
        if (Object.keys(contextFilePayload).length > 0) {
          body.context_files = contextFilePayload;
        }
      }
      const resp = await fetch(`${apiBase}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      let full = "";
      let cumulativeFull = "";
      let buffer = "";
      while (true) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((item) => item.startsWith("data: "));
          if (!line) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            const eventAgentId = payload.data?.agent_id ?? "meta";
            if (payload.type === "token") {
              if (eventAgentId === "meta") {
                const tokenText = String(payload.data?.text ?? "");
                full += tokenText;
                cumulativeFull += tokenText;
                scheduleStreamTextUpdate(full);
              } else {
                const tok = String(payload.data?.text ?? "");
                if (tok) {
                  const sub = useAppStore.getState().subAgents.find((item) => item.id === eventAgentId);
                  const prev = sub?.liveOutput ?? "";
                  const next = (prev + tok).slice(-4000);
                  updateSubAgent(eventAgentId, { liveOutput: next });
                }
              }
            }
            if (payload.type === "tool_call") {
              const toolName = payload.data?.name ?? "tool";
              const toolArgs = payload.data?.arguments ?? payload.data?.args ?? {};
              // Filter out internal housekeeping tools that add no user-visible signal
              const SILENT_TOOLS = new Set(["check_resources"]);
              if (!SILENT_TOOLS.has(toolName)) {
                const content = `🔧 ${toolName}: ${JSON.stringify(
                  toolArgs
                ).slice(0, 120)}`;
                if (eventAgentId === "meta") {
                  commitCurrentStreamIfNeeded();
                  full = "";
                  streamTextRef.current = "";
                  cancelStreamRenderFrame();
                  setStreamedAssistantText("");
                  streamCommittedRef.current = false;
                  addPaneMessage(pane.id, "tool", content, "meta");
                } else {
                  addSubAgentEvent(eventAgentId, { type: "tool_call", content });
                  const livePreview = buildToolCallLivePreview(toolName, toolArgs);
                  if (livePreview) {
                    const sub = useAppStore.getState().subAgents.find((item) => item.id === eventAgentId);
                    const prev = sub?.liveOutput ?? "";
                    const next = `${prev}${prev ? "\n\n" : ""}${livePreview}`.slice(-12000);
                    updateSubAgent(eventAgentId, { liveOutput: next });
                  }
                }
              }
            }
            if (payload.type === "tool_result") {
              const toolName = String(payload.data?.name ?? "");
              const formatted = formatToolResultMessage(toolName, payload.data?.result);
              if (formatted.silent) continue;
              if (eventAgentId === "meta") addPaneMessage(pane.id, "tool", formatted.content, "meta");
              else {
                addSubAgentEvent(eventAgentId, { type: "tool_result", content: formatted.content });
                if (toolName === "file_write" || toolName === "file_edit") {
                  const sub = useAppStore.getState().subAgents.find((item) => item.id === eventAgentId);
                  const prev = sub?.liveOutput ?? "";
                  const marker = `\n\n# ${toolName} applied`;
                  updateSubAgent(eventAgentId, { liveOutput: `${prev}${marker}`.slice(-12000) });
                }
              }
              if (toolName === "spawn_subagent" && eventAgentId === "meta") {
                try {
                  const spawnResult = typeof payload.data?.result === "string"
                    ? JSON.parse(payload.data.result)
                    : payload.data?.result;
                  const spawnId = spawnResult?.agent_id;
                  if (spawnId) {
                    console.debug("[ChatPane] spawn_subagent tool_result fallback addSubAgent", spawnId);
                    addSubAgent({
                      id: spawnId,
                      name: spawnResult.name ?? spawnId,
                      role: spawnResult.role ?? "worker",
                      provider: spawnResult.provider ?? undefined,
                      model: spawnResult.model ?? undefined,
                      task: spawnResult.task ?? "",
                      sessionId: requestSessionId || undefined,
                    });
                  }
                } catch { /* ignore parse errors */ }
              }
              if (
                eventAgentId === "meta" &&
                toolName === "set_taskspace" &&
                isSetTaskspaceToolSuccess(payload.data?.result)
              ) {
                setTaskspaceAutoRefreshKey((prev) => prev + 1);
              }
            }
            if (payload.type === "confirm_required") {
              if (eventAgentId !== "meta") {
                const confirmReqId = String(payload.data?.id ?? "");
                updateSubAgent(eventAgentId, {
                  status: "awaiting_confirm",
                  currentAction: "等待你的确认",
                  pendingConfirm: confirmReqId
                    ? {
                        requestId: confirmReqId,
                        question: payload.data?.question ?? "是否确认执行？",
                        agentId: eventAgentId,
                        sessionId: requestSessionId,
                        context: payload.data?.context,
                      }
                    : undefined,
                });
                addSubAgentEvent(eventAgentId, {
                  type: "confirm_required",
                  content: payload.data?.question ?? "等待确认",
                });
              }
              const ok = await onOpenConfirm(
                payload.data?.id ?? "",
                payload.data?.question ?? "是否确认执行？",
                payload.data?.context?.diff,
                eventAgentId,
                payload.data?.context
              );
              await fetch(`${apiBase}/api/confirm`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
                body: JSON.stringify({
                  session_id: requestSessionId,
                  request_id: payload.data?.id,
                  approved: ok,
                  agent_id: eventAgentId,
                }),
              });
            }
            if (payload.type === "confirm_response") {
              if (eventAgentId !== "meta") {
                const approved = !!payload.data?.approved;
                updateSubAgent(eventAgentId, {
                  status: approved ? "running" : "cancelled",
                  currentAction: approved ? "确认通过，继续执行" : "确认拒绝，执行终止",
                  pendingConfirm: undefined,
                });
                addSubAgentEvent(eventAgentId, {
                  type: "confirm_response",
                  content: approved ? "确认通过" : "确认拒绝",
                });
              }
            }
            if (payload.type === "subagent_started") {
              const subId = payload.data?.agent_id;
              console.debug("[ChatPane] SSE subagent_started", subId, "sessionId:", requestSessionId);
              if (subId) {
                addSubAgent({
                  id: subId,
                  name: payload.data?.name ?? subId,
                  role: payload.data?.role ?? "worker",
                  provider: payload.data?.provider ?? undefined,
                  model: payload.data?.model ?? undefined,
                  task: payload.data?.task ?? "",
                  sessionId: requestSessionId || undefined,
                });
                addSubAgentEvent(subId, { type: "started", content: "已启动" });
              }
            }
            if (payload.type === "subagent_progress") {
              const subId = payload.data?.agent_id;
              if (subId) {
                const text = payload.data?.text ?? "执行中";
                updateSubAgent(subId, { currentAction: text });
                // Keep heartbeat visible in status line, but avoid flooding detail logs.
                if (!/^执行中（\d+s）/.test(text)) {
                  addSubAgentEvent(subId, { type: "progress", content: text });
                }
              }
            }
            if (payload.type === "subagent_checkpoint") {
              const subId = payload.data?.agent_id;
              if (subId) {
                const text = payload.data?.text ?? "阶段检查点";
                updateSubAgent(subId, { status: "running", currentAction: text });
                addSubAgentEvent(subId, { type: "checkpoint", content: text });
              }
            }
            if (payload.type === "subagent_paused") {
              const subId = payload.data?.agent_id;
              if (subId) {
                const text = payload.data?.text ?? "已暂停，等待指令";
                updateSubAgent(subId, { status: "running", currentAction: text });
                addSubAgentEvent(subId, { type: "paused", content: text });
              }
            }
            if (payload.type === "subagent_completed") {
              const subId = payload.data?.agent_id;
              if (subId) {
                updateSubAgent(subId, {
                  status: "completed",
                  currentAction: "已完成（查看摘要）",
                  resultSummary:
                    typeof payload.data?.summary === "string" ? payload.data.summary : undefined,
                });
                addSubAgentEvent(subId, { type: "completed", content: payload.data?.summary ?? "完成" });
              }
            }
            if (payload.type === "subagent_error") {
              const subId = payload.data?.agent_id;
              if (subId) {
                const text = payload.data?.text ?? "执行异常";
                updateSubAgent(subId, {
                  status: payload.data?.status === "cancelled" ? "cancelled" : "failed",
                  currentAction: text,
                });
                addSubAgentEvent(subId, { type: "error", content: text });
              }
            }
            if (payload.type === "final") {
              if (eventAgentId === "meta") {
                const finalText = String(payload.data?.text ?? "");
                if (finalText) {
                  if (finalText.startsWith(cumulativeFull)) {
                    const delta = finalText.slice(cumulativeFull.length);
                    if (delta) {
                      full += delta;
                      cumulativeFull += delta;
                    }
                  } else if (finalText.startsWith(full)) {
                    const delta = finalText.slice(full.length);
                    if (delta) {
                      full += delta;
                      cumulativeFull += delta;
                    }
                  } else if (
                    finalText !== full &&
                    finalText !== cumulativeFull &&
                    !full.includes(finalText) &&
                    !cumulativeFull.includes(finalText)
                  ) {
                    const merged = full.trim() ? `\n\n${finalText}` : finalText;
                    full += merged;
                    cumulativeFull += merged;
                  }
                }
                scheduleStreamTextUpdate(full);
              } else {
                updateSubAgent(eventAgentId, { status: "completed", currentAction: "已完成" });
                addSubAgentEvent(eventAgentId, { type: "final", content: payload.data?.text ?? "" });
              }
            }
            if (payload.type === "error") {
              addPaneMessage(pane.id, "tool", `❌ ${payload.data?.text ?? "未知错误"}`, "meta");
            }
          } catch {
            // Ignore malformed frame.
          }
        }
      }

      if (full.trim() && !isThinkingPlaceholderText(full) && !streamCommittedRef.current) {
        addPaneMessage(pane.id, "assistant", full, "meta", activeProvider, activeModel);
        streamCommittedRef.current = true;
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        addPaneMessage(pane.id, "tool", `❌ 请求失败: ${String(error)}`, "meta");
      }
    } finally {
      abortRef.current = null;
      cancelStreamRenderFrame();
      streamTextRef.current = "";
      streamCommittedRef.current = false;
      setStreaming(false);
      setStreamedAssistantText("");
      setStreamingModel(null);
      setContextFiles({});
    }
  };

  const initSession = async (inherit = false, prevSessionId?: string) => {
    const avatarId =
      pane.avatarId && pane.avatarId.startsWith("group:") ? undefined : pane.avatarId ?? undefined;
    try {
      const result = await window.agenticxDesktop.createSession({
        avatar_id: avatarId,
        ...(inherit && prevSessionId ? { inherit_from_session_id: prevSessionId } : {}),
      });
      if (result.ok && result.session_id) {
        setPaneSessionId(pane.id, result.session_id);
        if (result.inherited) {
          setPaneContextInherited(pane.id, true);
        }
        return;
      }
      console.error("[ChatPane] createSession returned error:", result.error);
    } catch (err) {
      console.error("[ChatPane] createSession threw:", err);
    }
    if (prevSessionId) {
      setPaneSessionId(pane.id, prevSessionId);
      setPaneContextInherited(pane.id, false);
    }
    addPaneMessage(pane.id, "tool", "⚠️ 会话创建失败，已恢复上一会话。请检查后端服务是否正常。", "meta");
  };

  const createNewTopic = (inherit = true) => {
    const prevSessionId = pane.sessionId;
    clearPaneMessages(pane.id);
    setPaneSessionId(pane.id, "");
    setPaneContextInherited(pane.id, false);
    void initSession(inherit, prevSessionId);
  };

  const maxTaskspaceWidth = paneWidth > 0 ? Math.max(240, Math.floor(paneWidth * 0.45)) : 520;
  const minTaskspaceWidth = 220;

  useEffect(() => {
    setTaskspaceWidth((prev) => Math.min(maxTaskspaceWidth, Math.max(minTaskspaceWidth, prev)));
  }, [maxTaskspaceWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(TASKSPACE_WIDTH_STORAGE_KEY, String(taskspaceWidth));
    } catch {
      // ignore storage access failures
    }
  }, [taskspaceWidth]);

  const startResizeTaskspace = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = taskspaceWidth;
    const onMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const next = Math.max(minTaskspaceWidth, Math.min(maxTaskspaceWidth, startWidth + delta));
      setTaskspaceWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const cancelPaneSubAgent = async (agentId: string) => {
    if (!apiBase || !apiToken || !pane.sessionId) return;
    const sub = subAgents.find((item) => item.id === agentId);
    const targetSessionId = (sub?.sessionId ?? pane.sessionId).trim() || pane.sessionId;
    updateSubAgent(agentId, { status: "cancelled", currentAction: "用户请求中断..." });
    try {
      const resp = await fetch(`${apiBase}/api/subagent/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({ session_id: targetSessionId, agent_id: agentId }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      addSubAgentEvent(agentId, { type: "cancel", content: "已发送中断请求" });
    } catch (err) {
      updateSubAgent(agentId, { status: "cancelled", currentAction: "中断请求失败（后端未找到该任务）" });
      addSubAgentEvent(agentId, { type: "error", content: `中断请求失败: ${String(err)}` });
    }
  };

  const retryPaneSubAgent = async (agentId: string) => {
    if (!apiBase || !apiToken || !pane.sessionId) return;
    const sub = subAgents.find((item) => item.id === agentId);
    const targetSessionId = (sub?.sessionId ?? pane.sessionId).trim() || pane.sessionId;
    updateSubAgent(agentId, { status: "pending", currentAction: "正在重试..." });
    try {
      const resp = await fetch(`${apiBase}/api/subagent/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({ session_id: targetSessionId, agent_id: agentId }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      addSubAgentEvent(agentId, { type: "retry", content: "已发送重试请求" });
    } catch (err) {
      updateSubAgent(agentId, { status: "failed", currentAction: "重试失败" });
      addSubAgentEvent(agentId, { type: "error", content: `重试失败: ${String(err)}` });
    }
  };

  const resolvePaneSubAgentConfirm = async (agentId: string, approved: boolean) => {
    if (!apiBase || !apiToken || !pane.sessionId) return;
    const sub = subAgents.find((item) => item.id === agentId);
    if (!sub?.pendingConfirm) return;
    const targetSessionId = (sub.pendingConfirm.sessionId ?? pane.sessionId).trim() || pane.sessionId;
    updateSubAgent(agentId, {
      status: approved ? "running" : "cancelled",
      currentAction: approved ? "确认通过，继续执行" : "确认拒绝，执行终止",
      pendingConfirm: undefined,
    });
    addSubAgentEvent(agentId, {
      type: "confirm_response",
      content: approved ? "用户确认通过" : "用户确认拒绝",
    });
    try {
      await fetch(`${apiBase}/api/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({
          session_id: targetSessionId,
          request_id: sub.pendingConfirm.requestId,
          approved,
          agent_id: agentId,
        }),
      });
    } catch {
      // confirm POST failure is non-fatal for UI
    }
  };

  return (
    <div
      ref={paneRef}
      className="flex h-full min-w-0 flex-1"
      onMouseDown={onFocus}
    >
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-text-strong">{pane.avatarName}</div>
            <div className="flex items-center gap-1.5 truncate text-[10px] text-text-faint">
              <span>session: {pane.sessionId ? pane.sessionId.slice(0, 8) + "…" : "-"}</span>
              {visibleMessages.length > 0 && (
                <span className="rounded bg-surface-card px-1 text-text-subtle">{visibleMessages.length} 条</span>
              )}
              {pane.contextInherited && (
                <span className="rounded bg-emerald-500/20 px-1 text-emerald-400">已继承</span>
              )}
            </div>
          </div>
          <div className="no-drag flex items-center gap-1">
            <button
              className={`rounded px-2 py-0.5 text-[11px] transition ${
                pane.taskspacePanelOpen
                  ? "bg-surface-card-strong text-text-strong"
                  : "text-text-faint hover:bg-surface-hover hover:text-text-strong"
              }`}
              onClick={() => toggleTaskspacePanel(pane.id)}
              title="切换工作区面板"
            >
              工作区
            </button>
            <button
              className="rounded px-2 py-0.5 text-[11px] text-text-faint transition hover:bg-surface-hover hover:text-text-strong"
              onClick={() => togglePaneHistory(pane.id)}
              title="切换历史面板"
            >
              历史
            </button>
            <button
              className="rounded px-2 py-0.5 text-[11px] text-text-faint transition hover:bg-surface-hover hover:text-status-error"
              onClick={() => removePane(pane.id)}
              title="关闭窗格"
            >
              关闭
            </button>
          </div>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto px-6 py-3">
          {!pane.sessionId ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-xs text-text-faint">
              <span className="animate-pulse">正在初始化会话...</span>
              <button
                className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
                onClick={() => void initSession(false)}
              >
                重试
              </button>
            </div>
          ) : visibleMessages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-text-faint">暂无消息</div>
          ) : (
            <div className="space-y-2">
              {renderedMessages}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border bg-surface-composer px-4 py-2.5 backdrop-blur-md">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-text-faint">
            <span className="rounded border border-border bg-surface-card px-2 py-0.5">
              Context Files: {attachmentEntries.length}
            </span>
            <span className="rounded border border-border bg-surface-card px-2 py-0.5">
              Session: {pane.sessionId ? `${pane.sessionId.slice(0, 8)}...` : "-"}
            </span>
            {activeProvider && activeModel ? (
              <span className="rounded border border-border bg-surface-card px-2 py-0.5">
                {activeProvider}/{activeModel}
              </span>
            ) : null}
          </div>
          {selectedSubAgent ? (
            <div className="mb-1 inline-flex items-center gap-2 rounded border border-border bg-surface-card px-2 py-0.5 text-xs text-text-muted">
              对话目标: {selectedSubAgent}
              <button
                className="rounded px-1 hover:bg-surface-hover"
                onClick={() => setSelectedSubAgent(null)}
              >
                切回 Meta
              </button>
            </div>
          ) : null}
          <div className="rounded-2xl border border-border bg-surface-card transition-colors focus-within:border-border-strong">
            {attachmentEntries.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 px-3 pt-3">
                {attachmentEntries.map(([key, file]) => (
                  <AttachmentChip key={key} file={file} onRemove={() => removeAttachment(key)} />
                ))}
              </div>
            ) : null}
            <textarea
              value={input}
              onChange={(e) => {
                const value = e.target.value;
                setInput(value);
                const match = value.match(/(?:^|\s)@([^\s@]*)$/);
                if (match) {
                  const query = match[1] ?? "";
                  setAtOpen(true);
                  setAtQuery(query);
                  void searchAtCandidates(query);
                } else {
                  setAtOpen(false);
                  setAtQuery("");
                }
              }}
              onCompositionStart={() => {
                imeComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                window.setTimeout(() => {
                  imeComposingRef.current = false;
                }, 0);
              }}
              onBlur={() => {
                imeComposingRef.current = false;
              }}
              onKeyDown={(e) => {
                const isImeComposing =
                  e.nativeEvent.isComposing ||
                  imeComposingRef.current ||
                  e.key === "Process" ||
                  e.keyCode === 229;
                if (isImeComposing) return;
                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
                  e.preventDefault();
                  void createNewTopic(true);
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  if (atOpen && atCandidates.length > 0) {
                    e.preventDefault();
                    const first = atCandidates[0];
                    const mention = `@${first.label} `;
                    setInput((prev) => prev.replace(/(?:^|\s)@[^\s@]*$/, (text) => `${text.startsWith(" ") ? " " : ""}${mention}`));
                    setAtOpen(false);
                    setAtQuery("");
                    if (first.kind === "taskspace") {
                      void addTaskspaceAliasReference(first.taskspaceId, first.alias, first.path);
                    } else {
                      void addContextFile(first.taskspaceId, first.path);
                    }
                    return;
                  }
                  e.preventDefault();
                  void sendChat(input);
                }
              }}
              rows={input.includes("\n") ? 2 : 1}
              placeholder="发消息..."
              className="block min-h-[40px] w-full resize-none bg-transparent px-4 pb-0 pt-3 text-sm text-text-primary outline-none placeholder:text-text-faint"
            />
            <div className="flex items-center justify-between px-2 pb-2 pt-1">
              <div className="flex items-center gap-0.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = e.target.files;
                    if (!files) return;
                    for (const file of Array.from(files)) {
                      const key = `${file.name}:${file.size}:${file.lastModified}`;
                      parseLocalFile(file, key);
                    }
                    e.target.value = "";
                  }}
                />
                <button
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-text-faint transition hover:bg-surface-hover hover:text-text-muted"
                  title="上传附件"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
                <NewTopicButton onNewTopic={createNewTopic} />
                <button
                  className="flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] text-text-faint transition hover:bg-surface-hover hover:text-text-muted"
                  title="更多"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
                    <rect x="3" y="3" width="8" height="8" rx="1.5" />
                    <rect x="13" y="3" width="8" height="8" rx="1.5" />
                    <rect x="3" y="13" width="8" height="8" rx="1.5" />
                    <rect x="13" y="13" width="8" height="8" rx="1.5" />
                  </svg>
                  <span>更多</span>
                </button>
              </div>
              <ActionCircleButton
                hasInput={!!input.trim() && !!pane.sessionId}
                streaming={streaming}
                recording={recording}
                onSend={() => void sendChat(input)}
                onMic={onMicClick}
                onStop={() => abortRef.current?.abort()}
              />
            </div>
          </div>
          {atOpen ? (
            <div className="mt-1 max-h-28 overflow-y-auto rounded border border-border bg-surface-panel p-1 backdrop-blur-xl">
              {atCandidates.length === 0 ? (
                <div className="px-2 py-1 text-[11px] text-text-faint">
                  未找到匹配文件/文件夹{atQuery ? `: ${atQuery}` : ""}
                </div>
              ) : (
                atCandidates.map((item) => (
                  <button
                    key={`${item.kind}:${item.taskspaceId}:${item.path}`}
                    className="block w-full rounded px-2 py-1 text-left text-[11px] text-text-muted hover:bg-surface-hover"
                    onClick={() => {
                      const mention = `@${item.label} `;
                      setInput((prev) => prev.replace(/(?:^|\s)@[^\s@]*$/, (text) => `${text.startsWith(" ") ? " " : ""}${mention}`));
                      setAtOpen(false);
                      setAtQuery("");
                      if (item.kind === "taskspace") {
                        void addTaskspaceAliasReference(item.taskspaceId, item.alias, item.path);
                      } else {
                        void addContextFile(item.taskspaceId, item.path);
                      }
                    }}
                  >
                    {item.kind === "taskspace" ? `📁 ${item.label} → ${item.path}` : item.path}
                  </button>
                ))
              )}
            </div>
          ) : null}
          <div className="mt-1.5 flex items-center">
            <PaneModelPicker />
          </div>
        </div>
      </div>

      <HistoryPanelBoundary key={`hpb-${pane.id}-${pane.historyOpen}`}>
        <SessionHistoryPanel pane={pane} />
      </HistoryPanelBoundary>
      {pane.taskspacePanelOpen ? (
        <div className="relative h-full shrink-0 border-l border-border" style={{ width: taskspaceWidth }}>
          <div
            className="group absolute -left-[3px] top-0 z-20 h-full w-2 cursor-col-resize"
            onMouseDown={startResizeTaskspace}
            title="拖拽调整工作区面板宽度"
          >
            <div className="mx-auto h-full w-px transition" style={{ background: "var(--ui-accent-divider)" }} />
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-10 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-surface-panel opacity-60 transition group-hover:opacity-90" style={{ borderColor: "var(--ui-accent-divider-hover)" }} />
          </div>
          <WorkspacePanel
            sessionId={pane.sessionId}
            activeTaskspaceId={pane.activeTaskspaceId}
            onActiveTaskspaceChange={(taskspaceId) => setActiveTaskspace(pane.id, taskspaceId)}
            autoRefreshKey={taskspaceAutoRefreshKey}
            onPickFileForReference={(path) => {
              if (!pane.activeTaskspaceId) return;
              void addContextFile(pane.activeTaskspaceId, path);
              setInput((prev) => `${prev}${prev.endsWith(" ") || !prev ? "" : " "}@${path.split("/").pop() || path} `);
            }}
            subAgents={paneSubAgents}
            selectedSubAgent={selectedSubAgent}
            onCancel={(agentId) => void cancelPaneSubAgent(agentId)}
            onRetry={(agentId) => void retryPaneSubAgent(agentId)}
            onChat={(agentId) => setSelectedSubAgent(agentId)}
            onSelect={(agentId) => setSelectedSubAgent(agentId)}
            onConfirmResolve={(agentId, approved) => void resolvePaneSubAgentConfirm(agentId, approved)}
          />
        </div>
      ) : null}
    </div>
  );
}
