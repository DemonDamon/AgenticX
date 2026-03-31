import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, memo } from "react";
import type { ErrorInfo, ReactNode, MouseEvent as ReactMouseEvent } from "react";
import { GitBranch, GripVertical, Sparkles } from "lucide-react";
import {
  useAppStore,
  type Avatar,
  type ChatPane as ChatPaneState,
  type Message,
  type MessageAttachment,
  type PendingConfirm,
} from "../store";
import { startRecording, stopRecording } from "../voice/stt";
import { SessionHistoryPanel } from "./SessionHistoryPanel";
import { WorkspacePanel } from "./WorkspacePanel";
import { SpawnsColumn } from "./SpawnsColumn";
import { MessageRenderer } from "./messages/MessageRenderer";
import { WorkingIndicator } from "./messages/WorkingIndicator";
import { ImBubble } from "./messages/ImBubble";
import { TerminalLine } from "./messages/TerminalLine";
import { CleanBlock } from "./messages/CleanBlock";
import { ForwardPicker, type ForwardConfirmPayload } from "./ForwardPicker";
import { HoverTip } from "./ds/HoverTip";
import { Toast } from "./ds/Toast";
import { extractClipboardImageFiles, withClipboardImageNames } from "../utils/clipboard-images";
import { isKnownNonVisionChatModel } from "../utils/model-vision";
import {
  attachmentsFromSessionRow,
  mapLoadedSessionMessage,
  type LoadedSessionMessage,
} from "../utils/session-message-map";
import { favoriteStorageMessageId } from "../utils/favorite-selection";
import { createResizeRafScheduler } from "../utils/resize-raf";
import { avatarTintBg } from "../utils/avatar-color";
import { parseReasoningContent } from "./messages/reasoning-parser";
import { usePaneSortableHandle } from "./pane-sortable-context";

/** Shown in the user bubble and sent as user_input when sending attachments without typed text (API min_length=1). */
const ATTACHMENT_ONLY_USER_PROMPT = "（见附件，请结合附件回答。）";
const VISION_UNSUPPORTED_TOAST = "模型不支持该文件类型";
function resolveQuoteBody(message: Message, selectedText?: string): string {
  const sel = selectedText?.trim() ?? "";
  if (sel.length > 0) return sel;
  if (message.role === "assistant") {
    const parsed = parseReasoningContent(message.content);
    if (parsed.hasReasoningTag) {
      const resp = (parsed.response ?? "").trim();
      if (resp.length > 0) return resp;
    }
  }
  return message.content;
}

const FALLBACK_PANE: ChatPaneState = {
  id: "fallback-pane",
  avatarId: null,
  avatarName: "Machi",
  sessionId: "",
  messages: [],
  historyOpen: false,
  contextInherited: false,
  taskspacePanelOpen: false,
  membersPanelOpen: false,
  sidePanelTab: "workspace",
  activeTaskspaceId: null,
  spawnsColumnOpen: false,
  spawnsColumnSuppressAuto: false,
  spawnsColumnBaselineIds: [],
  terminalTabs: [],
  activeTerminalTabId: null,
  sessionTokens: { input: 0, output: 0 },
};

function NewTopicIconButtons({ onNewTopic }: { onNewTopic: (inherit: boolean) => void }) {
  const iconBtn =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-faint transition hover:bg-surface-hover hover:text-text-muted";
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <HoverTip label="全新对话 · 不继承上下文">
        <button
          type="button"
          className={iconBtn}
          aria-label="全新对话，不继承上下文"
          onClick={() => onNewTopic(false)}
        >
          <Sparkles className="h-[15px] w-[15px]" strokeWidth={1.8} aria-hidden />
        </button>
      </HoverTip>
      <HoverTip label="新对话 · 继承上下文（携带摘要）">
        <button
          type="button"
          className={iconBtn}
          aria-label="新对话，继承上下文"
          onClick={() => onNewTopic(true)}
        >
          <GitBranch className="h-[15px] w-[15px]" strokeWidth={1.8} aria-hidden />
        </button>
      </HoverTip>
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
        <div className="h-full w-[220px] shrink-0 border-l border-border bg-surface-card flex items-center justify-center">
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
                    type="button"
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:font-bold ${
                      isActive ? "text-text-strong" : "text-text-muted"
                    }`}
                    onClick={() => handleSelect(opt.provider, opt.model)}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        isActive ? "bg-emerald-500" : "bg-surface-hover"
                      }`}
                    />
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
  const isReferenceToken = !!file.referenceToken;
  return (
    <div
      className={`inline-flex max-w-[360px] items-center gap-2 rounded-lg border px-2 py-1 text-xs ${
        isReferenceToken
          ? "border-sky-500/40 bg-sky-500/15 text-sky-100"
          : "border-border bg-surface-panel text-text-muted"
      }`}
    >
      {isImage && file.dataUrl ? (
        <img src={file.dataUrl} alt={file.name} className="h-8 w-8 shrink-0 rounded object-cover" />
      ) : isReferenceToken ? (
        <span className="text-sm">↘</span>
      ) : (
        <span className="text-sm text-text-faint">{file.status === "error" ? "⚠️" : "📄"}</span>
      )}
      <div className="min-w-0">
        <div className={`truncate ${isReferenceToken ? "text-sky-100" : "text-text-muted"}`}>{file.name}</div>
        {isReferenceToken ? (
          <div className="text-[10px] text-sky-200/80">@ 文件引用</div>
        ) : file.status === "parsing" ? (
          <div className="text-[10px] text-text-faint animate-pulse">解析中...</div>
        ) : file.status === "error" ? (
          <div className="text-[10px] text-status-error">{file.errorText || "解析失败"}</div>
        ) : (
          <div className="text-[10px] text-text-faint">{formatFileSize(file.size)}</div>
        )}
      </div>
      <button
        className={`shrink-0 rounded px-1 transition ${
          isReferenceToken
            ? "text-sky-200/80 hover:bg-sky-500/20 hover:text-sky-100"
            : "text-text-faint hover:bg-surface-hover hover:text-text-muted"
        }`}
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

function normalizeStreamText(text: string): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function isNearBottom(el: HTMLDivElement, thresholdPx = 96): boolean {
  const remain = el.scrollHeight - (el.scrollTop + el.clientHeight);
  return remain <= thresholdPx;
}

function formatToolResultMessage(toolNameRaw: unknown, resultRaw: unknown): { content: string; silent: boolean } {
  const toolName = String(toolNameRaw ?? "tool");
  const resultText = String(resultRaw ?? "");
  if (toolName === "delegate_to_avatar") {
    try {
      const parsed = JSON.parse(resultText) as Record<string, unknown>;
      const delegated = Boolean(parsed.delegated);
      const avatarName = String(parsed.avatar_name ?? "");
      const delegationId = String(parsed.delegation_id ?? parsed.agent_id ?? "").trim();
      if (delegated) {
        return {
          content: `🤝 已委派给 ${avatarName || "分身"}${delegationId ? `\nID: ${delegationId}` : ""}`,
          silent: false,
        };
      }
    } catch {
      // Fall through to generic formatter.
    }
  }
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
const SPAWNS_WIDTH_STORAGE_KEY = "agenticx:spawns-column-width";
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
  sourcePath?: string;
  referenceToken?: boolean;
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
      kind: "avatar";
      avatarId: string;
      label: string;
      role: string;
      avatarUrl?: string;
    }
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

const MEMBER_PALETTE = [
  "bg-cyan-600",
  "bg-violet-600",
  "bg-rose-600",
  "bg-amber-600",
  "bg-emerald-600",
  "bg-sky-600",
  "bg-fuchsia-600",
];

function memberInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || "?";
}

function memberColorClass(id: string): string {
  let h = 0;
  for (const ch of id) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
  return MEMBER_PALETTE[Math.abs(h) % MEMBER_PALETTE.length];
}

const GroupMembersSidePanel = memo(function GroupMembersSidePanel({
  groupId,
  avatarList,
  metaLeaderLabel,
  onClose,
}: {
  groupId: string;
  avatarList: Avatar[];
  /** Meta-Agent pane title; shown as group coordinator in member grid. */
  metaLeaderLabel: string;
  onClose?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"browse" | "add" | "remove">("browse");
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelWidth, setPanelWidth] = useState(0);
  const groups = useAppStore((s) => s.groups);
  const setGroups = useAppStore((s) => s.setGroups);
  const group = groups.find((g) => g.id === groupId);

  useEffect(() => {
    if (!panelRef.current) return;
    const target = panelRef.current;
    const update = () => setPanelWidth(target.clientWidth);
    const { schedule, cancel } = createResizeRafScheduler(update);
    update();
    const observer = new ResizeObserver(schedule);
    observer.observe(target);
    return () => {
      cancel();
      observer.disconnect();
    };
  }, []);

  const avatarById = useMemo(() => {
    const map = new Map<string, Avatar>();
    for (const item of avatarList) map.set(item.id, item);
    return map;
  }, [avatarList]);

  const showMetaAgent = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const label = metaLeaderLabel.trim().toLowerCase();
    return (
      "meta-agent".includes(q) ||
      "meta agent".includes(q) ||
      "元智能体".includes(q) ||
      "组长".includes(q) ||
      (label.length > 0 && label.includes(q))
    );
  }, [search, metaLeaderLabel]);

  const filteredIds = useMemo(() => {
    if (!group) return [];
    const q = search.trim().toLowerCase();
    if (!q) return group.avatarIds;
    return group.avatarIds.filter((id) => {
      const a = avatarById.get(id);
      const name = (a?.name ?? id).toLowerCase();
      const role = (a?.role ?? "").toLowerCase();
      return name.includes(q) || role.includes(q);
    });
  }, [group, avatarById, search]);

  const addCandidates = useMemo(() => {
    if (!group) return [];
    const selected = new Set(group.avatarIds);
    const q = search.trim().toLowerCase();
    return avatarList.filter((a) => {
      if (selected.has(a.id)) return false;
      if (!q) return true;
      return a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q);
    });
  }, [group, avatarList, search]);

  const memberGrid = useMemo(() => {
    const width = panelWidth || 320;
    const columns = width <= 250 ? 2 : width <= 360 ? 3 : 4;
    const avatarSize = width <= 250 ? 38 : width <= 360 ? 44 : 48;
    const nameClass = width <= 250 ? "text-[10px]" : "text-[11px]";
    return { columns, avatarSize, nameClass };
  }, [panelWidth]);

  const [dialogChecked, setDialogChecked] = useState<Set<string>>(new Set());
  const [dialogSearch, setDialogSearch] = useState("");

  const dialogCandidates = useMemo(() => {
    if (mode !== "add" || !group) return [];
    const existing = new Set(group.avatarIds);
    const q = dialogSearch.trim().toLowerCase();
    return avatarList.filter((a) => {
      if (existing.has(a.id)) return false;
      if (!q) return true;
      return a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q);
    });
  }, [mode, group, avatarList, dialogSearch]);

  if (!group) {
    return (
      <div ref={panelRef} className="flex h-full flex-col bg-surface-card p-3">
        <p className="text-xs text-text-faint">未找到该群配置，可在侧栏刷新群列表后重试。</p>
      </div>
    );
  }

  const persistMembers = async (nextAvatarIds: string[]) => {
    if (!group || saving) return;
    setSaving(true);
    setErrorText("");
    const prevAvatarIds = group.avatarIds;
    setGroups(
      groups.map((item) => (item.id === group.id ? { ...item, avatarIds: nextAvatarIds } : item))
    );
    try {
      const res = await window.agenticxDesktop.updateGroup({
        id: group.id,
        avatar_ids: nextAvatarIds,
      });
      if (!res.ok) {
        throw new Error(res.error || "更新群成员失败");
      }
    } catch (err) {
      setGroups(
        groups.map((item) => (item.id === group.id ? { ...item, avatarIds: prevAvatarIds } : item))
      );
      setErrorText(err instanceof Error ? err.message : "更新群成员失败");
    } finally {
      setSaving(false);
    }
  };

  const handleAddMember = (avatarId: string) => {
    if (!group || group.avatarIds.includes(avatarId)) return;
    void persistMembers([...group.avatarIds, avatarId]);
  };

  const handleRemoveMember = (avatarId: string) => {
    if (!group || !group.avatarIds.includes(avatarId)) return;
    void persistMembers(group.avatarIds.filter((id) => id !== avatarId));
  };

  const openAddDialog = () => {
    setDialogChecked(new Set());
    setDialogSearch("");
    setMode("add");
  };

  const handleDialogConfirm = () => {
    if (!group || dialogChecked.size === 0) return;
    void persistMembers([...group.avatarIds, ...Array.from(dialogChecked)]);
    setMode("browse");
  };

  return (
    <div ref={panelRef} className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-card">
      <div className="shrink-0 space-y-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索群成员"
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface-panel px-2.5 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-faint focus:border-border-strong"
          />
          {onClose && (
            <button
              type="button"
              className="shrink-0 rounded px-1.5 py-1.5 text-text-faint transition hover:bg-surface-hover hover:text-text-strong"
              onClick={onClose}
              title="关闭成员面板"
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 8H13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
        {errorText ? <p className="text-[10px] text-rose-300">{errorText}</p> : null}
        {mode === "remove" ? (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-rose-300">点击成员头像移出群聊</span>
            <button
              type="button"
              className="rounded px-2 py-0.5 text-[11px] text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
              onClick={() => setMode("browse")}
            >
              完成
            </button>
          </div>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {filteredIds.length === 0 && !showMetaAgent && search.trim() ? (
          <p className="p-3 text-xs text-text-faint">无匹配成员，换个关键词试试。</p>
        ) : (
          <div
            className="grid gap-x-1 gap-y-3 px-2 py-3"
            style={{ gridTemplateColumns: `repeat(${memberGrid.columns}, minmax(0, 1fr))` }}
          >
            {/* Meta-Agent: 固定首位、不可移除 */}
            {showMetaAgent ? (
              <div className="relative flex flex-col items-center gap-1.5 rounded-lg text-center">
                <div
                  className="flex shrink-0 items-center justify-center rounded-xl bg-cyan-600 text-[10px] font-bold leading-tight text-white"
                  style={{ width: memberGrid.avatarSize, height: memberGrid.avatarSize }}
                >
                  {memberInitials(metaLeaderLabel)}
                </div>
                <span
                  className={`w-full truncate px-0.5 text-text-muted ${memberGrid.nameClass}`}
                  title={`${metaLeaderLabel} · 群聊协调者`}
                >
                  {metaLeaderLabel}
                </span>
              </div>
            ) : null}
            {filteredIds.map((id) => {
              const a = avatarById.get(id);
              const label = a?.name ?? id.slice(0, 6);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    if (mode === "remove") handleRemoveMember(id);
                  }}
                  disabled={saving}
                  className={`relative flex flex-col items-center gap-1.5 rounded-lg text-center transition ${
                    mode === "remove" ? "cursor-pointer hover:bg-surface-hover" : "cursor-default"
                  } disabled:opacity-60`}
                >
                  {a?.avatarUrl ? (
                    <img
                      src={a.avatarUrl}
                      alt=""
                      className="shrink-0 rounded-xl object-cover"
                      style={{ width: memberGrid.avatarSize, height: memberGrid.avatarSize }}
                    />
                  ) : (
                    <div
                      className={`flex shrink-0 items-center justify-center rounded-xl font-bold text-white ${memberColorClass(id)}`}
                      style={{ width: memberGrid.avatarSize, height: memberGrid.avatarSize }}
                    >
                      {memberInitials(label)}
                    </div>
                  )}
                  <span className={`w-full truncate px-0.5 text-text-muted ${memberGrid.nameClass}`} title={`${label}${a?.role ? ` · ${a.role}` : ""}\n${id}`}>
                    {label}
                  </span>
                  {mode === "remove" ? (
                    <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[11px] font-bold leading-none text-white shadow">−</span>
                  ) : null}
                </button>
              );
            })}
            {/* ── 微信风格: 添加 / 移出 两个虚线方块 ── */}
            {!search.trim() ? (
              <>
                <div className="relative flex flex-col items-center gap-1.5 text-center">
                  <button
                    type="button"
                    onClick={openAddDialog}
                    disabled={saving}
                    className="flex shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-border text-2xl font-light leading-none text-text-subtle transition hover:border-border-strong hover:bg-surface-hover hover:text-text-strong disabled:opacity-60"
                    style={{ width: memberGrid.avatarSize, height: memberGrid.avatarSize }}
                    title="添加成员"
                  >
                    +
                  </button>
                  <span className={`text-text-muted ${memberGrid.nameClass}`}>添加</span>
                </div>
                <div className="relative flex flex-col items-center gap-1.5 text-center">
                  <button
                    type="button"
                    onClick={() => setMode((prev) => (prev === "remove" ? "browse" : "remove"))}
                    disabled={saving || group.avatarIds.length === 0}
                    className="flex shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-border text-2xl font-light leading-none text-text-subtle transition hover:border-border-strong hover:bg-surface-hover hover:text-text-strong disabled:opacity-60"
                    style={{ width: memberGrid.avatarSize, height: memberGrid.avatarSize }}
                    title="移出成员"
                  >
                    −
                  </button>
                  <span className={`text-text-muted ${memberGrid.nameClass}`}>移出</span>
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* ── 添加成员 模态对话框（微信风格） ── */}
      {mode === "add" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setMode("browse")}>
          <div
            className="flex h-[480px] w-[520px] max-w-[90vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-panel shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 标题栏 */}
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-semibold text-text-strong">添加群成员</span>
              <span className="text-xs text-text-faint">
                {dialogChecked.size > 0 ? `已选 ${dialogChecked.size} 人` : ""}
              </span>
            </div>

            {/* 主体区域：左列表 + 右已选 */}
            <div className="flex min-h-0 flex-1">
              {/* 左侧：搜索 + 可选列表 */}
              <div className="flex min-h-0 flex-1 flex-col border-r border-border">
                <div className="shrink-0 px-3 py-2">
                  <input
                    type="search"
                    value={dialogSearch}
                    onChange={(e) => setDialogSearch(e.target.value)}
                    placeholder="搜索"
                    autoFocus
                    className="w-full rounded-lg border border-border bg-surface-card px-2.5 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-faint focus:border-border-strong"
                  />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-1">
                  {dialogCandidates.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-text-faint">
                      {dialogSearch.trim() ? "无匹配结果" : "所有分身都已在群里"}
                    </p>
                  ) : (
                    <div className="flex flex-col">
                      {dialogCandidates.map((a) => {
                        const checked = dialogChecked.has(a.id);
                        return (
                          <label
                            key={a.id}
                            className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 transition hover:bg-surface-hover"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setDialogChecked((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(a.id)) next.delete(a.id);
                                  else next.add(a.id);
                                  return next;
                                });
                              }}
                              className="h-4 w-4 shrink-0 accent-cyan-500"
                            />
                            {a.avatarUrl ? (
                              <img src={a.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
                            ) : (
                              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white ${memberColorClass(a.id)}`}>
                                {memberInitials(a.name || a.id)}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs text-text-primary">{a.name || a.id}</div>
                              {a.role ? <div className="truncate text-[10px] text-text-faint">{a.role}</div> : null}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* 右侧：已选预览 */}
              <div className="flex w-[160px] shrink-0 flex-col bg-surface-card">
                <div className="shrink-0 px-3 py-2">
                  <span className="text-[11px] text-text-faint">已选成员</span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-2">
                  {dialogChecked.size === 0 ? (
                    <p className="px-1 text-[11px] text-text-faint">勾选左侧分身</p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {Array.from(dialogChecked).map((id) => {
                        const a = avatarById.get(id);
                        const label = a?.name ?? id.slice(0, 6);
                        return (
                          <div key={id} className="flex items-center gap-2 rounded-md px-1 py-1">
                            {a?.avatarUrl ? (
                              <img src={a.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-md object-cover" />
                            ) : (
                              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white ${memberColorClass(id)}`}>
                                {memberInitials(label)}
                              </div>
                            )}
                            <span className="min-w-0 flex-1 truncate text-[11px] text-text-muted">{label}</span>
                            <button
                              type="button"
                              className="shrink-0 text-xs text-text-faint transition hover:text-rose-400"
                              onClick={() => setDialogChecked((prev) => { const n = new Set(prev); n.delete(id); return n; })}
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 底部按钮 */}
            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border px-4 py-3">
              <button
                type="button"
                className="rounded-lg border border-border px-4 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
                onClick={() => setMode("browse")}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-lg bg-cyan-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-500 disabled:opacity-50"
                disabled={dialogChecked.size === 0 || saving}
                onClick={handleDialogConfirm}
              >
                添加{dialogChecked.size > 0 ? ` (${dialogChecked.size})` : ""}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
});

export function ChatPane({ paneId, focused, onFocus, onOpenConfirm }: Props) {
  const pane = useAppStore((s) => s.panes.find((item) => item.id === paneId) ?? FALLBACK_PANE);
  const paneSortableListeners = usePaneSortableHandle();
  const panes = useAppStore((s) => s.panes);
  const metaLeaderDisplayName = useMemo(() => {
    const mp = panes.find((p) => p.avatarId === null);
    return (mp?.avatarName ?? "").trim() || "Machi";
  }, [panes]);
  const removePane = useAppStore((s) => s.removePane);
  const addPane = useAppStore((s) => s.addPane);
  const setActivePaneId = useAppStore((s) => s.setActivePaneId);
  const togglePaneHistory = useAppStore((s) => s.togglePaneHistory);
  const cycleSidePanel = useAppStore((s) => s.cycleSidePanel);
  const openSidePanel = useAppStore((s) => s.openSidePanel);
  const setActiveTaskspace = useAppStore((s) => s.setActiveTaskspace);
  const addPaneMessage = useAppStore((s) => s.addPaneMessage);
  const clearPaneMessages = useAppStore((s) => s.clearPaneMessages);
  const setPaneSessionId = useAppStore((s) => s.setPaneSessionId);
  const setPaneMessages = useAppStore((s) => s.setPaneMessages);
  const setActiveAvatarId = useAppStore((s) => s.setActiveAvatarId);
  const setPaneContextInherited = useAppStore((s) => s.setPaneContextInherited);
  const setSpawnsColumnOpen = useAppStore((s) => s.setSpawnsColumnOpen);
  const dismissSpawnsColumn = useAppStore((s) => s.dismissSpawnsColumn);
  const clearSpawnsColumnSuppress = useAppStore((s) => s.clearSpawnsColumnSuppress);
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
  const groups = useAppStore((s) => s.groups);
  const chatStyle = useAppStore((s) => s.chatStyle);
  const userNickname = useAppStore((s) => s.userNickname);
  const userPreference = useAppStore((s) => s.userPreference);
  const userBubbleLabel = useMemo(() => userNickname.trim() || "我", [userNickname]);
  const isGroupPane = Boolean(pane?.avatarId?.startsWith("group:"));
  const groupChatId = isGroupPane && pane?.avatarId ? pane.avatarId.slice("group:".length) : "";
  const activeGroup = useMemo(
    () => (isGroupPane ? groups.find((g) => g.id === groupChatId) : undefined),
    [groups, isGroupPane, groupChatId]
  );
  const groupMembers = useMemo(
    () =>
      (activeGroup?.avatarIds ?? [])
        .map((id) => avatars.find((a) => a.id === id))
        .filter((a): a is Avatar => Boolean(a)),
    [activeGroup, avatars]
  );
  const workspacePanelOpen = !!pane?.taskspacePanelOpen;

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
  const autoScrollPinnedRef = useRef(true);
  const imeComposingRef = useRef(false);
  const [atOpen, setAtOpen] = useState(false);
  const [atQuery, setAtQuery] = useState("");
  const [atCandidates, setAtCandidates] = useState<AtCandidate[]>([]);
  const [groupTyping, setGroupTyping] = useState<Record<string, string>>({});
  const lastGroupProgressRef = useRef<Record<string, string>>({});
  const [quoteTarget, setQuoteTarget] = useState<{ message: Message; body: string } | null>(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [forwardPickerOpen, setForwardPickerOpen] = useState(false);
  const [pendingForwardMessages, setPendingForwardMessages] = useState<
    Array<{ sender: string; role: string; content: string; avatar_url?: string; timestamp?: number }>
  >([]);
  const [contextFiles, setContextFiles] = useState<Record<string, AttachedFile>>({});
  const [attachToastOpen, setAttachToastOpen] = useState(false);
  const [favoriteToastOpen, setFavoriteToastOpen] = useState(false);
  const [favoriteToastMsg, setFavoriteToastMsg] = useState("");
  const [feishuDesktopBound, setFeishuDesktopBound] = useState(false);
  const [hasAnyFeishuDesktopBinding, setHasAnyFeishuDesktopBinding] = useState(false);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const [composerExpanded, setComposerExpanded] = useState(false);
  useEffect(() => {
    if (!favoriteToastOpen) return;
    const t = window.setTimeout(() => setFavoriteToastOpen(false), 1800);
    return () => window.clearTimeout(t);
  }, [favoriteToastOpen]);
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
  const [spawnsWidth, setSpawnsWidth] = useState(() => {
    try {
      const raw = window.localStorage.getItem(SPAWNS_WIDTH_STORAGE_KEY);
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    } catch {
      // ignore storage access failures
    }
    return 300;
  });
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [paneWidth, setPaneWidth] = useState(0);

  const visibleMessages = useMemo(
    () =>
      (pane?.messages ?? []).filter((item) => {
        if (isGroupPane) return true;
        if (item.role === "assistant" && isThinkingPlaceholderText(item.content || "")) return false;
        return !item.agentId || item.agentId === "meta";
      }),
    [isGroupPane, pane?.messages]
  );
  const paneSubAgents = useMemo(() => {
    const sid = (pane?.sessionId ?? "").trim();
    if (!sid) return [];
    return subAgents.filter((item) => (item.sessionId ?? "").trim() === sid);
  }, [pane?.sessionId, subAgents]);
  const paneSubAgentIdsKey = useMemo(
    () =>
      paneSubAgents
        .map((s) => s.id)
        .sort()
        .join("\0"),
    [paneSubAgents]
  );

  useEffect(() => {
    if (paneSubAgents.length === 0) {
      if (pane.spawnsColumnOpen) setSpawnsColumnOpen(pane.id, false);
      return;
    }
    const baseline = new Set(pane.spawnsColumnBaselineIds ?? []);
    if (pane.spawnsColumnSuppressAuto) {
      const hasNew = paneSubAgents.some((s) => !baseline.has(s.id));
      if (hasNew) {
        clearSpawnsColumnSuppress(pane.id);
        setSpawnsColumnOpen(pane.id, true);
      }
      return;
    }
    if (!pane.spawnsColumnOpen) {
      setSpawnsColumnOpen(pane.id, true);
    }
  }, [
    pane.id,
    pane.spawnsColumnOpen,
    pane.spawnsColumnSuppressAuto,
    pane.spawnsColumnBaselineIds,
    paneSubAgentIdsKey,
    paneSubAgents.length,
    clearSpawnsColumnSuppress,
    setSpawnsColumnOpen,
  ]);
  const attachmentEntries = useMemo(() => Object.entries(contextFiles), [contextFiles]);
  const visibleAttachmentEntries = useMemo(
    () => attachmentEntries.filter(([, file]) => !file.referenceToken),
    [attachmentEntries]
  );
  const readyAttachments = useMemo(
    () =>
      attachmentEntries
        .filter(([, file]) => file.status === "ready")
        .map(([sourcePath, file]) => ({ ...file, sourcePath: file.sourcePath || sourcePath })),
    [attachmentEntries]
  );

  const hasDelegation = useMemo(() => {
    const fromPaneSubs = paneSubAgents.some(
      (sub) =>
        (sub.status === "running" || sub.status === "pending") &&
        (sub.id.startsWith("dlg-") || sub.events?.some((evt) => evt.type.startsWith("delegation")))
    );
    if (fromPaneSubs) return true;
    const paneName = (pane?.avatarName ?? "").trim().toLowerCase();
    if (!paneName) return false;
    return subAgents.some(
      (sub) =>
        (sub.status === "running" || sub.status === "pending") &&
        sub.id.startsWith("dlg-") &&
        (sub.name ?? "").trim().toLowerCase() === paneName
    );
  }, [paneSubAgents, subAgents, pane?.avatarName]);

  const lastPollCountRef = useRef(0);

  useEffect(() => {
    if (!pane?.sessionId) return;
    let active = true;
    let timer: number | undefined;

    const isFeishuBoundSession = async (sid: string): Promise<boolean> => {
      try {
        const r = await window.agenticxDesktop.loadFeishuBinding();
        if (!r.ok) return false;
        const desk = r.bindings["_desktop"] as { session_id?: string } | undefined;
        return Boolean(desk && desk.session_id === sid);
      } catch {
        return false;
      }
    };

    const poll = async () => {
      if (!active) return;
      const currentSid = pane.sessionId;
      if (!currentSid) return;
      const otherPaneHasSameSid = panes.some(
        (p) => p.id !== pane.id && p.sessionId === currentSid
      );
      if (otherPaneHasSameSid) {
        console.warn("[ChatPane] poll skipped — session %s is shared with another pane", currentSid);
        return;
      }
      try {
        const result = await window.agenticxDesktop.loadSessionMessages(currentSid);
        if (!active) return;
        if (result.ok && Array.isArray(result.messages) && result.messages.length > 0) {
          if (result.messages.length <= lastPollCountRef.current) return;
          lastPollCountRef.current = result.messages.length;
          const seen = new Set<string>();
          const deduped: Message[] = [];
          for (let idx = 0; idx < result.messages.length; idx++) {
            const item = result.messages[idx];
            const role = String(item.role ?? "");
            const content = String(item.content ?? "").trim();
            const rowAtts = attachmentsFromSessionRow(
              (item as { attachments?: unknown }).attachments
            );
            if (!content && !rowAtts?.length) continue;
            const attSig =
              rowAtts?.length && rowAtts[0]?.dataUrl
                ? rowAtts[0].dataUrl.slice(0, 72)
                : "";
            const key = `${role}::${content.slice(0, 300)}::${attSig}`;
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(mapLoadedSessionMessage(item as LoadedSessionMessage, `dlgpoll-${pane.sessionId}`, idx));
          }
          setPaneMessages(pane.id, deduped);
        }
      } catch {
        // ignore polling failures
      }
    };

    const setup = async () => {
      if (!active) return;
      const sid = pane.sessionId;
      if (!sid) return;
      const isImSession = sid.startsWith("im-");
      const isBound = await isFeishuBoundSession(sid);
      if (!active) return;
      const needsExternalPoll = isImSession || isBound;
      if (!hasDelegation && !needsExternalPoll && (pane.messages?.length ?? 0) > 0) return;
      void poll();
      if (!hasDelegation && !needsExternalPoll) return;
      timer = window.setInterval(() => void poll(), 3000);
    };

    void setup();
    return () => {
      active = false;
      if (timer != null) window.clearInterval(timer);
    };
  }, [hasDelegation, feishuDesktopBound, pane?.sessionId, pane?.id, pane?.messages?.length, panes, setPaneMessages]);

  useEffect(() => {
    if (isGroupPane || !pane?.sessionId) {
      setFeishuDesktopBound(false);
      setHasAnyFeishuDesktopBinding(false);
      return;
    }
    let cancelled = false;
    const sid = pane.sessionId;

    const checkBound = async () => {
      if (cancelled) return;
      try {
        const r = await window.agenticxDesktop.loadFeishuBinding();
        if (cancelled || !r.ok) return;
        const desk = r.bindings["_desktop"] as { session_id?: string } | undefined;
        const hasDesktopBinding = Boolean(desk && typeof desk.session_id === "string" && desk.session_id.trim());
        setHasAnyFeishuDesktopBinding(hasDesktopBinding);
        setFeishuDesktopBound(
          Boolean(desk && typeof desk.session_id === "string" && desk.session_id === sid)
        );
      } catch {
        if (!cancelled) {
          setFeishuDesktopBound(false);
          setHasAnyFeishuDesktopBinding(false);
        }
      }
    };

    void checkBound();
    const timer = window.setInterval(() => void checkBound(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isGroupPane, pane?.sessionId]);

  const toggleFeishuDesktopBinding = useCallback(async () => {
    if (isGroupPane || !pane?.sessionId) return;
    try {
      if (feishuDesktopBound) {
        await window.agenticxDesktop.saveFeishuDesktopBinding({ sessionId: null });
        setFeishuDesktopBound(false);
      } else {
        const aid = pane.avatarId?.startsWith("group:") ? null : pane.avatarId || null;
        await window.agenticxDesktop.saveFeishuDesktopBinding({
          sessionId: pane.sessionId,
          avatarId: aid,
          avatarName: pane.avatarName || null,
        });
        setFeishuDesktopBound(true);
      }
    } catch {
      /* ignore */
    }
  }, [feishuDesktopBound, isGroupPane, pane?.sessionId, pane?.avatarId, pane?.avatarName]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const updatePinned = () => {
      autoScrollPinnedRef.current = isNearBottom(el);
    };
    updatePinned();
    el.addEventListener("scroll", updatePinned, { passive: true });
    return () => el.removeEventListener("scroll", updatePinned);
  }, [paneId]);

  useEffect(() => {
    requestAnimationFrame(() => {
      if (listRef.current && autoScrollPinnedRef.current) {
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
    const { schedule, cancel } = createResizeRafScheduler(update);
    update();
    const observer = new ResizeObserver(schedule);
    observer.observe(target);
    return () => {
      cancel();
      observer.disconnect();
    };
  }, []);

  const openDelegatedAvatarSession = async (agentId: string): Promise<boolean> => {
    const sub = useAppStore.getState().subAgents.find((item) => item.id === agentId);
    const targetSessionId = (sub?.sessionId ?? "").trim();
    if (!targetSessionId) return false;

    const targetName = String(sub?.name ?? "").trim();
    const existingPane = panes.find((item) => {
      if (!item.avatarId || item.avatarId.startsWith("group:")) return false;
      const found = avatars.find((avatar) => avatar.id === item.avatarId);
      return !!found && found.name === targetName;
    });
    const targetPaneId = existingPane?.id ?? addPane(null, targetName || "Avatar", targetSessionId);
    setPaneSessionId(targetPaneId, targetSessionId);
    setActivePaneId(targetPaneId);
    setSelectedSubAgent(null);

    try {
      const result = await window.agenticxDesktop.loadSessionMessages(targetSessionId);
      if (result.ok && Array.isArray(result.messages)) {
        const mapped: Message[] = result.messages.map((item, index) =>
          mapLoadedSessionMessage(item as LoadedSessionMessage, targetSessionId, index)
        );
        setPaneMessages(targetPaneId, mapped);
      } else {
        setPaneMessages(targetPaneId, []);
      }
    } catch {
      setPaneMessages(targetPaneId, []);
    }
    return true;
  };

  const cancelStreamRenderFrame = () => {
    if (streamRafRef.current !== null) {
      window.cancelAnimationFrame(streamRafRef.current);
      streamRafRef.current = null;
    }
  };

  const searchAtCandidates = async (queryText: string) => {
    const lowered = queryText.trim().toLowerCase();
    const avatarCandidates: AtCandidate[] = isGroupPane
      ? groupMembers
          .filter((a) => !lowered || a.name.toLowerCase().includes(lowered) || a.role.toLowerCase().includes(lowered))
          .map((a) => ({
            kind: "avatar" as const,
            avatarId: a.id,
            label: a.name,
            role: a.role,
            avatarUrl: a.avatarUrl || undefined,
          }))
      : [];

    if (!pane.sessionId) {
      setAtCandidates(avatarCandidates.slice(0, 24));
      return;
    }
    const wsResp = await window.agenticxDesktop.listTaskspaces(pane.sessionId);
    if (!wsResp.ok || !Array.isArray(wsResp.workspaces) || wsResp.workspaces.length === 0) {
      setAtCandidates(avatarCandidates.slice(0, 24));
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
      setAtCandidates(avatarCandidates.slice(0, 24));
      return;
    }
    const flatRows: Extract<AtCandidate, { kind: "file" }>[] = [];
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
    setAtCandidates([...avatarCandidates, ...filteredFolders, ...filteredFiles].slice(0, 24));
  };

  const updateAtStateFromText = useCallback(
    (value: string) => {
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
    },
    [searchAtCandidates]
  );

  const extractComposerText = useCallback((): string => {
    const el = composerRef.current;
    if (!el) return "";
    // Keep visual token text clean (without "@"), but serialize it as "@name" for routing.
    const clone = el.cloneNode(true) as HTMLDivElement;
    const tokenNodes = clone.querySelectorAll<HTMLElement>("[data-ref-token='1']");
    for (const node of tokenNodes) {
      const name = String(node.dataset.refName || node.textContent || "").trim();
      node.textContent = name ? `@${name}` : "";
    }
    return (clone.innerText || "").replace(/\u00a0/g, " ");
  }, []);

  const focusComposerEnd = useCallback(() => {
    const el = composerRef.current;
    if (!el) return;
    el.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const createFileRefToken = useCallback((name: string) => {
    const token = document.createElement("span");
    token.setAttribute("contenteditable", "false");
    token.setAttribute("data-ref-token", "1");
    token.setAttribute("data-ref-name", name);
    token.className =
      "mx-0.5 inline-flex items-center rounded-md border border-[#6a9dff90] bg-[#244766cc] px-1.5 py-0.5 align-baseline text-[12px] font-medium leading-[1.2] text-[#e6f0ff]";
    token.textContent = name;
    return token;
  }, []);

  const setComposerText = useCallback(
    (value: string, options?: { tokenNames?: string[] }) => {
      const el = composerRef.current;
      if (!el) {
        setInput(value);
        updateAtStateFromText(value);
        return;
      }
      const tokenNames = new Set<string>();
      for (const [, file] of Object.entries(contextFiles)) {
        if (file.referenceToken && file.name) tokenNames.add(file.name);
      }
      for (const name of options?.tokenNames ?? []) {
        if (name) tokenNames.add(name);
      }
      el.innerHTML = "";
      const tokenNamesByLength = Array.from(tokenNames).sort((a, b) => b.length - a.length);
      let cursor = 0;
      let textBuffer = "";
      while (cursor < value.length) {
        if (value[cursor] !== "@") {
          textBuffer += value[cursor];
          cursor += 1;
          continue;
        }
        const rest = value.slice(cursor + 1);
        const matched = tokenNamesByLength.find((name) => {
          if (!rest.startsWith(name)) return false;
          const tail = rest.slice(name.length, name.length + 1);
          return tail.length === 0 || /\s/.test(tail);
        });
        if (!matched) {
          textBuffer += value[cursor];
          cursor += 1;
          continue;
        }
        if (textBuffer) {
          el.appendChild(document.createTextNode(textBuffer));
          textBuffer = "";
        }
        el.appendChild(createFileRefToken(matched));
        cursor += matched.length + 1;
      }
      if (textBuffer) {
        el.appendChild(document.createTextNode(textBuffer));
      }
      setInput(value);
      updateAtStateFromText(value);
      focusComposerEnd();
    },
    [contextFiles, createFileRefToken, focusComposerEnd, updateAtStateFromText]
  );

  const addContextFile = async (
    taskspaceId: string,
    relPath: string,
    options?: { referenceToken?: boolean }
  ): Promise<string | null> => {
    if (!pane.sessionId || !relPath) return null;
    const fileResp = await window.agenticxDesktop.readTaskspaceFile({
      sessionId: pane.sessionId,
      taskspaceId,
      path: relPath,
    });
    if (!fileResp.ok || typeof fileResp.content !== "string") return null;
    const key = String(fileResp.absolute_path || relPath);
    const content = (fileResp.content ?? "").slice(0, TEXT_ATTACHMENT_LIMIT);
    setContextFiles((prev) => ({
      ...prev,
      [key]: {
        name: key.split(/[\\/]/).pop() || key,
        size: content.length,
        mimeType: "text/plain",
        status: "ready",
        content,
        sourcePath: key,
        referenceToken: !!options?.referenceToken,
      },
    }));
    return key;
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
      if (!pane.taskspacePanelOpen) openSidePanel(pane.id, "workspace");
    }
  }, [pane.id, pane.sessionId, pane.taskspacePanelOpen, setActiveTaskspace, openSidePanel]);

  const copyMessage = useCallback(async (message: Message) => {
    const textToCopy = message.content || "";
    try {
      const firstImage = (message.attachments ?? []).find(
        (attachment) => !!attachment.dataUrl && attachment.mimeType.startsWith("image/")
      );
      if (
        firstImage?.dataUrl &&
        typeof window.ClipboardItem !== "undefined" &&
        typeof navigator.clipboard?.write === "function"
      ) {
        const imageBlob = await fetch(firstImage.dataUrl).then((resp) => resp.blob());
        const imageMime = imageBlob.type || firstImage.mimeType || "image/png";
        await navigator.clipboard.write([
          new ClipboardItem({
            [imageMime]: imageBlob,
            "text/plain": new Blob([textToCopy], { type: "text/plain" }),
          }),
        ]);
        return;
      }
      await navigator.clipboard.writeText(textToCopy);
    } catch {
      // ignore clipboard failures
    }
  }, []);

  const favoriteMessage = useCallback(async (message: Message, selectedText?: string) => {
    if (!apiBase || !pane.sessionId) return;
    const trimmedSel = selectedText?.trim() ?? "";
    const content = trimmedSel.length > 0 ? trimmedSel : message.content;
    const messageId = favoriteStorageMessageId(message.id, content, message.content);
    try {
      const res = await fetch(`${apiBase}/api/memory/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({
          session_id: pane.sessionId,
          message_id: messageId,
          content,
          role: message.role,
        }),
      });
      const data = (await res.json().catch(() => null)) as { already_saved?: boolean } | null;
      if (!res.ok || !data) {
        setFavoriteToastMsg("收藏失败，请稍后重试");
        setFavoriteToastOpen(true);
        return;
      }
      setFavoriteToastMsg(data.already_saved ? "已收藏过" : "已收藏");
      setFavoriteToastOpen(true);
    } catch {
      setFavoriteToastMsg("收藏失败，请稍后重试");
      setFavoriteToastOpen(true);
    }
  }, [apiBase, apiToken, pane.sessionId]);

  const toggleSelectMessage = useCallback((message: Message) => {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(message.id)) next.delete(message.id);
      else next.add(message.id);
      return next;
    });
  }, []);

  const selectUpTo = useCallback((targetMessage: Message) => {
    setSelectedMessageIds((prev) => {
      if (prev.size === 0) return new Set([targetMessage.id]);
      let lastSelectedIdx = -1;
      for (let i = visibleMessages.length - 1; i >= 0; i--) {
        if (prev.has(visibleMessages[i].id)) { lastSelectedIdx = i; break; }
      }
      const targetIdx = visibleMessages.findIndex((m) => m.id === targetMessage.id);
      if (targetIdx < 0) return prev;
      if (lastSelectedIdx < 0) return new Set([targetMessage.id]);
      const lo = Math.min(lastSelectedIdx, targetIdx);
      const hi = Math.max(lastSelectedIdx, targetIdx);
      const next = new Set(prev);
      for (let i = lo; i <= hi; i++) next.add(visibleMessages[i].id);
      return next;
    });
  }, [visibleMessages]);

  const selectedMessages = useMemo(
    () => visibleMessages.filter((m) => selectedMessageIds.has(m.id)),
    [visibleMessages, selectedMessageIds]
  );

  const resolveForwardTarget = useCallback(
    async (payload: ForwardConfirmPayload): Promise<{ paneId: string; sessionId: string }> => {
      const state = useAppStore.getState();
      if (payload.type === "session") {
        const sid = payload.sessionId.trim();
        const p = state.panes.find((item) => (item.sessionId || "").trim() === sid);
        if (!p) {
          throw new Error("找不到对应窗格，请从侧栏重新打开该会话后再试");
        }
        return { paneId: p.id, sessionId: sid };
      }
      if (payload.type === "avatar") {
        let pane = state.panes.find((item) => item.avatarId === payload.avatarId);
        if (!pane) {
          const paneId = addPane(payload.avatarId, payload.displayName, "");
          setActiveAvatarId(payload.avatarId);
          const created = await window.agenticxDesktop.createSession({ avatar_id: payload.avatarId });
          if (!created.ok || !created.session_id) {
            throw new Error(created.error || "创建分身会话失败");
          }
          setPaneSessionId(paneId, created.session_id);
          return { paneId, sessionId: created.session_id };
        }
        let sid = (pane.sessionId || "").trim();
        if (!sid) {
          const created = await window.agenticxDesktop.createSession({ avatar_id: payload.avatarId });
          if (!created.ok || !created.session_id) {
            throw new Error(created.error || "创建分身会话失败");
          }
          setPaneSessionId(pane.id, created.session_id);
          sid = created.session_id;
        }
        setActivePaneId(pane.id);
        setActiveAvatarId(payload.avatarId);
        return { paneId: pane.id, sessionId: sid };
      }
      const groupAvatarId = `group:${payload.groupId}`;
      let groupPane = state.panes.find((item) => item.avatarId === groupAvatarId);
      if (!groupPane) {
        const paneId = addPane(groupAvatarId, `群聊 · ${payload.displayName}`, "");
        setActiveAvatarId(null);
        const created = await window.agenticxDesktop.createSession({
          avatar_id: groupAvatarId,
          name: payload.displayName,
        });
        if (!created.ok || !created.session_id) {
          throw new Error(created.error || "创建群聊会话失败");
        }
        setPaneSessionId(paneId, created.session_id);
        return { paneId, sessionId: created.session_id };
      }
      let sid = (groupPane.sessionId || "").trim();
      if (!sid) {
        const created = await window.agenticxDesktop.createSession({
          avatar_id: groupAvatarId,
          name: payload.displayName,
        });
        if (!created.ok || !created.session_id) {
          throw new Error(created.error || "创建群聊会话失败");
        }
        setPaneSessionId(groupPane.id, created.session_id);
        sid = created.session_id;
      }
      setActivePaneId(groupPane.id);
      setActiveAvatarId(null);
      return { paneId: groupPane.id, sessionId: sid };
    },
    [addPane, setActiveAvatarId, setActivePaneId, setPaneSessionId]
  );

  const executeForward = useCallback(
    async (targetPayload: ForwardConfirmPayload, followUpNote: string) => {
      if (!apiBase || !pane.sessionId || pendingForwardMessages.length === 0) return;
      const follow = followUpNote.trim();
      try {
        const { paneId: targetPaneId, sessionId: targetSessionId } = await resolveForwardTarget(targetPayload);
        const resp = await fetch(`${apiBase}/api/messages/forward`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
          body: JSON.stringify({
            source_session_id: pane.sessionId,
            target_session_id: targetSessionId,
            messages: pendingForwardMessages,
          }),
        });
        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          throw new Error(text.slice(0, 200) || `转发失败 HTTP ${resp.status}`);
        }
        setActivePaneId(targetPaneId);
        const targetPaneMeta = useAppStore.getState().panes.find((p) => p.id === targetPaneId);
        const aid = targetPaneMeta?.avatarId;
        if (aid?.startsWith("group:")) {
          setActiveAvatarId(null);
        } else {
          setActiveAvatarId(aid ?? null);
        }
        const prompt = follow || "请阅读上一条转发的聊天记录并给出你的回应。";
        useAppStore.getState().setForwardAutoReply({
          paneId: targetPaneId,
          sessionId: targetSessionId,
          text: prompt,
        });
        try {
          const result = await window.agenticxDesktop.loadSessionMessages(targetSessionId);
          if (result.ok && Array.isArray(result.messages)) {
            const mapped: Message[] = result.messages.map((item, index) =>
              mapLoadedSessionMessage(item as LoadedSessionMessage, targetSessionId, index)
            );
            setPaneMessages(targetPaneId, mapped);
          }
        } catch {
          // keep server state; pane may refresh on next poll
        }
      } catch (err) {
        console.error("[ChatPane] forward failed:", err);
        throw err;
      } finally {
        setPendingForwardMessages([]);
      }
    },
    [
      apiBase,
      apiToken,
      pane.sessionId,
      pendingForwardMessages,
      resolveForwardTarget,
      setActiveAvatarId,
      setActivePaneId,
      setPaneMessages,
    ]
  );

  const forwardOneMessage = useCallback((message: Message) => {
    const sender = message.role === "assistant" ? message.avatarName || message.agentId || "AI" : "我";
    setPendingForwardMessages([
      {
        sender,
        role: message.role,
        content: message.content,
        avatar_url: message.avatarUrl,
        timestamp: message.timestamp,
      },
    ]);
    setForwardPickerOpen(true);
  }, []);

  const forwardSelectedMessages = useCallback(() => {
    if (selectedMessages.length === 0) return;
    setPendingForwardMessages(
      selectedMessages.map((message) => ({
        sender: message.role === "assistant" ? message.avatarName || message.agentId || "AI" : "我",
        role: message.role,
        content: message.content,
        avatar_url: message.avatarUrl,
        timestamp: message.timestamp,
      }))
    );
    setForwardPickerOpen(true);
  }, [selectedMessages]);

  const deleteSelectedMessages = useCallback(async () => {
    if (selectedMessages.length === 0 || !apiBase || !pane.sessionId) return;
    const ok = window.confirm(`确认删除已选中的 ${selectedMessages.length} 条消息？`);
    if (!ok) return;
    try {
      const resp = await fetch(`${apiBase}/api/session/messages/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({
          session_id: pane.sessionId,
          messages: selectedMessages.map((m) => ({
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
            agent_id: m.agentId,
          })),
        }),
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const selectedIds = new Set(selectedMessages.map((m) => m.id));
      setPaneMessages(
        pane.id,
        (pane.messages ?? []).filter((m) => !selectedIds.has(m.id))
      );
      setSelectedMessageIds(new Set());
    } catch (err) {
      console.error("[ChatPane] delete selected messages failed:", err);
    }
  }, [apiBase, apiToken, pane.id, pane.messages, pane.sessionId, selectedMessages, setPaneMessages]);

  const retryUserMessage = useCallback((msg: Message) => {
    if (msg.role !== "user") return;
    void sendChatRef.current(msg.content, { retryAttachments: msg.attachments ?? [] });
  }, []);

  const renderedMessages = useMemo(() => (
    <>
      {visibleMessages.map((message) => {
        const canRetryThisUserMessage = message.role === "user" && !streaming;
        const isSelecting = selectedMessageIds.size > 0;
        const isSelected = selectedMessageIds.has(message.id);
        return (
          <div key={message.id} className="group/sel relative">
            {/* 「↓ 选择到这里」按钮：多选模式 + 未选中时显示 */}
            {isSelecting && !isSelected && (
              <button
                type="button"
                className="absolute -top-1 left-0 z-10 flex items-center gap-1 rounded-full border border-border bg-surface-card px-2 py-0.5 text-[10px] text-text-muted shadow-sm opacity-0 transition-opacity group-hover/sel:opacity-100 hover:!opacity-100 hover:bg-surface-hover hover:text-text-strong"
                onClick={() => selectUpTo(message)}
              >
                ↓ 选择到这里
              </button>
            )}
            <MessageRenderer
              message={message}
              assistantBadge={message.role === "assistant" ? <ModelBadge provider={message.provider} model={message.model} /> : undefined}
              onRevealPath={(path) => void revealFileInTaskspace(path)}
              assistantName={paneAvatarMeta.name}
              assistantAvatarUrl={paneAvatarMeta.url}
              userName={userBubbleLabel}
              onCopyMessage={copyMessage}
              onQuoteMessage={(msg, selectedText) =>
                setQuoteTarget({ message: msg, body: resolveQuoteBody(msg, selectedText) })
              }
              onFavoriteMessage={favoriteMessage}
              onForwardMessage={forwardOneMessage}
              onRetryMessage={canRetryThisUserMessage ? retryUserMessage : undefined}
              onToggleSelectMessage={toggleSelectMessage}
              onResolveInlineConfirm={(confirm, approved) => void resolveGroupInlineConfirm(confirm, approved)}
              selectable={isSelecting}
              selected={isSelected}
            />
          </div>
        );
      })}
      {Object.entries(groupTyping).map(([agentId, name]) => (
        <ImBubble
          key={`typing-${agentId}`}
          message={{ id: `typing-${agentId}`, role: "assistant", content: "", avatarName: name, agentId }}
          assistantName={name}
        />
      ))}
      {streaming && !isGroupPane ? (
        chatStyle === "terminal" ? (
          <TerminalLine
            message={{ id: "__stream__", role: "assistant", content: streamedAssistantText || "" }}
            badge={streamingModel ? <ModelBadge provider={streamingModel.provider} model={streamingModel.model} /> : undefined}
          />
        ) : chatStyle === "clean" ? (
          <CleanBlock
            message={{ id: "__stream__", role: "assistant", content: streamedAssistantText || "" }}
            badge={streamingModel ? <ModelBadge provider={streamingModel.provider} model={streamingModel.model} /> : undefined}
          />
        ) : (
          <ImBubble
            message={{ id: "__stream__", role: "assistant", content: streamedAssistantText || "" }}
            badge={streamingModel ? <ModelBadge provider={streamingModel.provider} model={streamingModel.model} /> : undefined}
            assistantName={paneAvatarMeta.name}
            assistantAvatarUrl={paneAvatarMeta.url}
          />
        )
      ) : null}
    </>
  ), [chatStyle, copyMessage, favoriteMessage, forwardOneMessage, groupTyping, isGroupPane, paneAvatarMeta, resolveGroupInlineConfirm, revealFileInTaskspace, retryUserMessage, selectUpTo, selectedMessageIds, streamedAssistantText, streaming, streamingModel, toggleSelectMessage, userBubbleLabel, visibleMessages]);

  const removeAttachment = useCallback((key: string) => {
    setContextFiles((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const parseLocalFile = useCallback((file: File, key: string) => {
    if (isImageFile(file) && isKnownNonVisionChatModel(activeProvider, activeModel)) {
      setAttachToastOpen(true);
      return;
    }
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
  }, [activeProvider, activeModel]);

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

  const sendChatRef = useRef<(text: string, options?: { retryAttachments?: MessageAttachment[] }) => Promise<void>>(
    async () => {}
  );

  const sendChat = async (userText: string, options?: { retryAttachments?: MessageAttachment[] }) => {
    const text = userText.trim();
    const messageText = text || ATTACHMENT_ONLY_USER_PROMPT;
    const retryAttachments = options?.retryAttachments;
    const readyEntries = attachmentEntries.filter(([, file]) => file.status === "ready");
    const readyEntryMap = new Map(readyEntries);
    const composerAttachments: MessageAttachment[] = readyAttachments.map((file) => ({
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      dataUrl: file.dataUrl,
      sourcePath: file.sourcePath,
      referenceToken: file.referenceToken,
    }));
    const rawUserAttachments: MessageAttachment[] =
      retryAttachments && retryAttachments.length > 0
        ? retryAttachments.map((item) => ({ ...item }))
        : composerAttachments;
    const userAttachments: MessageAttachment[] = rawUserAttachments.filter((item) => {
      if (!item.referenceToken) return true;
      const name = String(item.name || "").trim();
      if (!name) return true;
      return messageText.includes(`@${name}`);
    });
    const hasReadyAttachments = userAttachments.length > 0;
    if ((!text && !hasReadyAttachments) || !apiBase || !pane.sessionId) return;
    if (streaming) return;

    const otherPanesWithSameSession = panes.filter(
      (p) => p.id !== pane.id && p.sessionId === pane.sessionId
    );
    if (otherPanesWithSameSession.length > 0) {
      console.warn(
        "[ChatPane] session collision detected: pane %s shares session %s with %d other pane(s); creating isolated session",
        pane.id,
        pane.sessionId,
        otherPanesWithSameSession.length,
      );
      try {
        const avatarId =
          pane.avatarId && pane.avatarId.startsWith("group:") ? undefined : pane.avatarId ?? undefined;
        const created = await window.agenticxDesktop.createSession({ avatar_id: avatarId });
        if (created.ok && created.session_id) {
          setPaneSessionId(pane.id, created.session_id);
          addPaneMessage(pane.id, "tool", "⚠️ 检测到会话冲突，已自动切换到独立会话。", "meta");
        }
      } catch (err) {
        console.error("[ChatPane] failed to create isolated session:", err);
      }
      return;
    }

    const requestSessionId = pane.sessionId;
    const selectedIsPaneSubagent =
      !!selectedSubAgent && paneSubAgents.some((item) => item.id === selectedSubAgent);
    const targetAgentId = selectedIsPaneSubagent ? selectedSubAgent : "meta";
    const mentionMap = new Map(
      groupMembers.map((a) => [a.name.trim().toLowerCase(), a.id])
    );
    const mentionRegex = /@([^\s@]+)/g;
    const mentionedAvatarIds: string[] = [];
    if (isGroupPane) {
      let m: RegExpExecArray | null;
      while ((m = mentionRegex.exec(text)) !== null) {
        const matchedName = (m[1] || "").trim().toLowerCase();
        const avatarId = mentionMap.get(matchedName);
        if (avatarId && !mentionedAvatarIds.includes(avatarId)) mentionedAvatarIds.push(avatarId);
      }
    }
    if (targetAgentId === "meta") {
      addPaneMessage(
        pane.id,
        "user",
        messageText,
        "meta",
        undefined,
        undefined,
        userAttachments,
        quoteTarget
          ? {
              quotedMessageId: quoteTarget.message.id,
              quotedContent: `${quoteTarget.message.avatarName || quoteTarget.message.agentId || quoteTarget.message.role}: ${quoteTarget.body.slice(0, 120)}`,
            }
          : undefined
      );
    } else {
      addSubAgentEvent(targetAgentId, { type: "user", content: messageText });
      addPaneMessage(pane.id, "tool", `🗣 发送给 ${targetAgentId}: ${messageText}`, "meta");
    }
    setComposerText("");
    setQuoteTarget(null);
    // Clear attachments immediately so chips do not linger until the stream ends (finally also clears).
    setContextFiles({});
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
      const body: Record<string, unknown> = { session_id: requestSessionId, user_input: messageText };
      if (quoteTarget) {
        body.quoted_message_id = quoteTarget.message.id;
        body.quoted_content = `${quoteTarget.message.avatarName || quoteTarget.message.agentId || quoteTarget.message.role}: ${quoteTarget.body}`;
      }
      if (activeProvider) body.provider = activeProvider;
      if (activeModel) body.model = activeModel;
      if (targetAgentId !== "meta") body.agent_id = targetAgentId;
      if (isGroupPane && targetAgentId === "meta") {
        body.group_id = groupChatId;
        body.mentioned_avatar_ids = mentionedAvatarIds;
        body.meta_leader_display_name = metaLeaderDisplayName;
        body.user_display_name = userBubbleLabel;
      }
      if (userBubbleLabel && userBubbleLabel !== "我") body.user_nickname = userBubbleLabel;
      if (userPreference.trim()) body.user_preference = userPreference.trim();
      if (userAttachments.length > 0) {
        const imageInputs = userAttachments
          .filter((file) => !!file.dataUrl && file.mimeType.startsWith("image/"))
          .map((file) => ({
            name: file.name,
            data_url: file.dataUrl as string,
            mime_type: file.mimeType,
            size: file.size,
          }));
        const canSendImageInputs = targetAgentId === "meta" && !isGroupPane;
        if (canSendImageInputs && imageInputs.length > 0) {
          body.image_inputs = imageInputs;
        }
        const contextFilePayload: Record<string, string> = {};
        for (const file of userAttachments) {
          const key = String(file.sourcePath || file.name || "").trim();
          if (!key) continue;
          const ready = readyEntryMap.get(key);
          const isImage = !!file.dataUrl || file.mimeType.startsWith("image/") || !!ready?.dataUrl || ready?.mimeType.startsWith("image/");
          if (isImage) {
            contextFilePayload[key] = "[图片文件]";
          } else if (ready?.content) {
            contextFilePayload[key] = ready.content;
          } else {
            contextFilePayload[key] = `[附件] ${file.name}`;
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
      lastGroupProgressRef.current = {};
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
            if (payload.type === "group_typing") {
              const avatarName = String(payload.data?.avatar_name ?? eventAgentId);
              setGroupTyping((prev) => ({ ...prev, [eventAgentId]: avatarName }));
              continue;
            }
            if (payload.type === "group_progress") {
              const avatarName = String(payload.data?.avatar_name ?? eventAgentId);
              const avatarUrl = String(payload.data?.avatar_url ?? "");
              const progressText = String(payload.data?.content ?? "").trim();
              setGroupTyping((prev) => ({ ...prev, [eventAgentId]: avatarName }));
              if (!progressText) continue;
              const prevText = lastGroupProgressRef.current[eventAgentId] ?? "";
              if (prevText === progressText) continue;
              lastGroupProgressRef.current[eventAgentId] = progressText;
              addPaneMessage(
                pane.id,
                "tool",
                `${avatarName}：${progressText}`,
                eventAgentId,
                activeProvider,
                activeModel,
                undefined,
                { avatarName, avatarUrl: avatarUrl || undefined }
              );
              continue;
            }
            if (payload.type === "group_blocked") {
              const avatarName = String(payload.data?.avatar_name ?? eventAgentId);
              const avatarUrl = String(payload.data?.avatar_url ?? "");
              const blockedText = String(payload.data?.content ?? "").trim();
              const requestId = String(payload.data?.confirm_request_id ?? "").trim();
              setGroupTyping((prev) => {
                const next = { ...prev };
                delete next[eventAgentId];
                return next;
              });
              if (!blockedText) continue;
              const prevText = lastGroupProgressRef.current[eventAgentId] ?? "";
              if (prevText === blockedText) continue;
              lastGroupProgressRef.current[eventAgentId] = blockedText;
              const strategy = useAppStore.getState().confirmStrategy;
              if (strategy === "auto" && requestId) {
                addPaneMessage(
                  pane.id,
                  "tool",
                  `${avatarName}：确认通过，继续执行`,
                  eventAgentId,
                  activeProvider,
                  activeModel,
                  undefined,
                  { avatarName, avatarUrl: avatarUrl || undefined }
                );
                fetch(`${apiBase}/api/confirm`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
                  body: JSON.stringify({
                    session_id: requestSessionId,
                    request_id: requestId,
                    approved: true,
                    agent_id: eventAgentId,
                  }),
                }).catch(() => {});
                continue;
              }
              addPaneMessage(
                pane.id,
                "tool",
                `${avatarName}：⏸ ${blockedText}`,
                eventAgentId,
                activeProvider,
                activeModel,
                undefined,
                {
                  avatarName,
                  avatarUrl: avatarUrl || undefined,
                  inlineConfirm: requestId
                    ? {
                        requestId,
                        question: blockedText,
                        agentId: eventAgentId,
                        sessionId: requestSessionId,
                      }
                    : undefined,
                }
              );
              continue;
            }
            if (payload.type === "group_reply") {
              const avatarName = String(payload.data?.avatar_name ?? eventAgentId);
              const avatarUrl = String(payload.data?.avatar_url ?? "");
              const content = String(payload.data?.content ?? "");
              const errorText = String(payload.data?.error ?? "");
              setGroupTyping((prev) => {
                const next = { ...prev };
                delete next[eventAgentId];
                return next;
              });
              if (content.trim()) {
                addPaneMessage(
                  pane.id,
                  "assistant",
                  content,
                  eventAgentId,
                  activeProvider,
                  activeModel,
                  undefined,
                  { avatarName, avatarUrl: avatarUrl || undefined }
                );
              } else if (errorText.trim()) {
                addPaneMessage(
                  pane.id,
                  "assistant",
                  `${avatarName} 回复失败：${errorText}`,
                  eventAgentId,
                  activeProvider,
                  activeModel,
                  undefined,
                  { avatarName, avatarUrl: avatarUrl || undefined }
                );
              }
              continue;
            }
            if (payload.type === "group_nudge") {
              const avatarName = String(payload.data?.avatar_name ?? metaLeaderDisplayName);
              const avatarUrl = String(payload.data?.avatar_url ?? "");
              const content = String(payload.data?.content ?? "");
              if (content.trim()) {
                addPaneMessage(
                  pane.id,
                  "assistant",
                  content,
                  eventAgentId,
                  activeProvider,
                  activeModel,
                  undefined,
                  { avatarName, avatarUrl: avatarUrl || undefined }
                );
              }
              continue;
            }
            if (payload.type === "group_skipped") {
              setGroupTyping((prev) => {
                const next = { ...prev };
                delete next[eventAgentId];
                return next;
              });
              continue;
            }
            if (payload.type === "tool_progress") {
              const name = String(payload.data?.name ?? "tool");
              const sec = Number(payload.data?.elapsed_seconds ?? 0);
              const waitLabel = Number.isFinite(sec)
                ? `⏳ ${name} 执行中…（已等待 ${sec}s）`
                : `⏳ ${name} 执行中…`;
              if (eventAgentId === "meta") {
                setStreamedAssistantText(waitLabel);
              } else {
                updateSubAgent(eventAgentId, {
                  currentAction: Number.isFinite(sec) ? `${name} 执行中… (${sec}s)` : `${name} 执行中…`,
                });
              }
              continue;
            }
            if (payload.type === "token") {
              if (eventAgentId === "meta") {
                const tokenText = String(payload.data?.text ?? "");
                if (isThinkingPlaceholderText(tokenText) && !full.trim()) {
                  // Ignore waiting placeholder tokens to prevent ghost "⏳" answers.
                  continue;
                }
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
                const isDelegation = Boolean(payload.data?.delegation);
                const avatarSessionId =
                  (typeof payload.data?.avatar_session_id === "string" && payload.data.avatar_session_id.trim()) || "";
                addSubAgent({
                  id: subId,
                  name: payload.data?.name ?? subId,
                  role: payload.data?.role ?? (isDelegation ? "delegated avatar" : "worker"),
                  provider: payload.data?.provider ?? undefined,
                  model: payload.data?.model ?? undefined,
                  task: payload.data?.task ?? "",
                  sessionId: avatarSessionId || requestSessionId || undefined,
                });
                updateSubAgent(subId, {
                  status: "running",
                  currentAction: isDelegation ? "委派执行中" : "执行中",
                });
                addSubAgentEvent(
                  subId,
                  { type: isDelegation ? "delegation_started" : "started", content: isDelegation ? `已委派给 ${payload.data?.name ?? subId}` : "已启动" }
                );
                if (isDelegation && avatarSessionId && !isGroupPane) {
                  const dlgName = String(payload.data?.name ?? "").trim();
                  const dlgAvatarId = typeof payload.data?.avatar_id === "string" ? payload.data.avatar_id.trim() : "";
                  const store = useAppStore.getState();
                  const existingPane = store.panes.find((p) => {
                    if (p.avatarId && dlgAvatarId && p.avatarId === dlgAvatarId) return true;
                    return dlgName && (p.avatarName ?? "").trim().toLowerCase() === dlgName.toLowerCase();
                  });
                  if (existingPane) {
                    // Only sync session if the pane has no session yet (freshly opened).
                    // Never overwrite an active session — the delegation already runs
                    // in _find_or_create_avatar_session which reuses the avatar's existing session.
                  } else {
                    const newPaneId = addPane(dlgAvatarId || null, dlgName || subId, avatarSessionId);
                    setActivePaneId(newPaneId);
                  }
                }
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
                const isDelegation = Boolean(payload.data?.delegation);
                updateSubAgent(subId, {
                  status: "completed",
                  currentAction: isDelegation ? "委派完成（查看摘要）" : "已完成（查看摘要）",
                  resultSummary:
                    typeof payload.data?.summary === "string" ? payload.data.summary : undefined,
                  sessionId:
                    (typeof payload.data?.avatar_session_id === "string" && payload.data.avatar_session_id.trim())
                      || undefined,
                });
                addSubAgentEvent(
                  subId,
                  { type: isDelegation ? "delegation_completed" : "completed", content: payload.data?.summary ?? "完成" }
                );
              }
            }
            if (payload.type === "subagent_error") {
              const subId = payload.data?.agent_id;
              if (subId) {
                const text = payload.data?.text ?? "执行异常";
                const isDelegation = Boolean(payload.data?.delegation);
                updateSubAgent(subId, {
                  status: payload.data?.status === "cancelled" ? "cancelled" : "failed",
                  currentAction: text,
                  sessionId:
                    (typeof payload.data?.avatar_session_id === "string" && payload.data.avatar_session_id.trim())
                      || undefined,
                });
                addSubAgentEvent(subId, { type: isDelegation ? "delegation_error" : "error", content: text });
              }
            }
            if (payload.type === "final") {
              if (eventAgentId === "meta") {
                const finalText = String(payload.data?.text ?? "");
                // Final payload is authoritative. Replacing (instead of merging) avoids
                // duplicate concatenation when token stream shape differs from final text.
                if (finalText.trim() && !isThinkingPlaceholderText(finalText)) {
                  full = finalText;
                  cumulativeFull = finalText;
                }
                scheduleStreamTextUpdate(full);
              } else {
                updateSubAgent(eventAgentId, { status: "completed", currentAction: "已完成" });
                addSubAgentEvent(eventAgentId, { type: "final", content: payload.data?.text ?? "" });
              }
            }
            if (payload.type === "token_usage") {
              const inp = Number(payload.data?.input_tokens ?? 0);
              const out = Number(payload.data?.output_tokens ?? 0);
              if (inp > 0 || out > 0) {
                useAppStore.getState().accumulatePaneTokens(pane.id, inp, out);
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
      setGroupTyping({});
      setStreaming(false);
      setStreamedAssistantText("");
      setStreamingModel(null);
      setContextFiles({});
    }
  };

  sendChatRef.current = sendChat;

  const forwardAutoReply = useAppStore((s) => s.forwardAutoReply);
  useEffect(() => {
    if (!forwardAutoReply) return;
    if (forwardAutoReply.paneId !== paneId) return;
    if ((pane.sessionId || "").trim() !== forwardAutoReply.sessionId.trim()) return;
    useAppStore.getState().setForwardAutoReply(null);
    void sendChatRef.current(forwardAutoReply.text);
  }, [forwardAutoReply, paneId, pane.sessionId]);

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

  const maxTaskspaceWidth = paneWidth > 0 ? Math.max(240, Math.floor(paneWidth * 0.4)) : 480;
  const minTaskspaceWidth = 220;
  const maxSpawnsWidth = paneWidth > 0 ? Math.max(240, Math.floor(paneWidth * 0.42)) : 420;
  const minSpawnsWidth = 220;

  useEffect(() => {
    setTaskspaceWidth((prev) => Math.min(maxTaskspaceWidth, Math.max(minTaskspaceWidth, prev)));
  }, [maxTaskspaceWidth]);

  useEffect(() => {
    setSpawnsWidth((prev) => Math.min(maxSpawnsWidth, Math.max(minSpawnsWidth, prev)));
  }, [maxSpawnsWidth]);


  useEffect(() => {
    try {
      window.localStorage.setItem(TASKSPACE_WIDTH_STORAGE_KEY, String(taskspaceWidth));
    } catch {
      // ignore storage access failures
    }
  }, [taskspaceWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SPAWNS_WIDTH_STORAGE_KEY, String(spawnsWidth));
    } catch {
      // ignore storage access failures
    }
  }, [spawnsWidth]);


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

  const startResizeSpawns = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = spawnsWidth;
    const onMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const next = Math.max(minSpawnsWidth, Math.min(maxSpawnsWidth, startWidth + delta));
      setSpawnsWidth(next);
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

  async function resolveGroupInlineConfirm(confirm: PendingConfirm, approved: boolean) {
    if (!apiBase || !apiToken || !pane.sessionId) return;
    const targetSessionId = (confirm.sessionId ?? pane.sessionId).trim() || pane.sessionId;
    setPaneMessages(
      pane.id,
      visibleMessages.map((msg) => {
        if (msg.inlineConfirm?.requestId !== confirm.requestId) return msg;
        return { ...msg, inlineConfirm: undefined };
      })
    );
    addPaneMessage(
      pane.id,
      "tool",
      `${confirm.agentId}：${approved ? "确认通过，继续执行" : "确认拒绝，执行终止"}`,
      confirm.agentId,
      activeProvider,
      activeModel
    );
    try {
      await fetch(`${apiBase}/api/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({
          session_id: targetSessionId,
          request_id: confirm.requestId,
          approved,
          agent_id: confirm.agentId,
        }),
      });
    } catch {
      // confirm POST failure is non-fatal for UI
    }
  }

  const paneTint = (() => {
    if (!pane.avatarId) return undefined;
    if (pane.avatarId.startsWith("group:")) {
      const rawId = pane.avatarId.slice(6);
      const idx = groups.findIndex((g) => g.id === rawId);
      if (idx >= 0) {
        // reuse GROUP_TINT colors in same order as groupColorByIndex
        const GROUP_TINT_LIST = [
          "rgba(99,102,241,0.07)",   // indigo
          "rgba(20,184,166,0.07)",   // teal
          "rgba(236,72,153,0.07)",   // pink
          "rgba(132,204,22,0.07)",   // lime
          "rgba(239,68,68,0.07)",    // red
          "rgba(59,130,246,0.07)",   // blue
          "rgba(234,179,8,0.07)",    // yellow
          "rgba(168,85,247,0.07)",   // purple
        ];
        return GROUP_TINT_LIST[idx % GROUP_TINT_LIST.length];
      }
    }
    return avatarTintBg(pane.avatarId);
  })();

  return (
    <div
      ref={paneRef}
      className="flex h-full min-w-0 flex-1"
      style={paneTint ? { backgroundColor: paneTint } : undefined}
      onMouseDown={onFocus}
    >
      <div className="flex h-full min-w-0 flex-1 flex-col" style={{ minWidth: 280 }}>
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
          <div
            className={`flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden ${
              paneSortableListeners ? "cursor-grab touch-none active:cursor-grabbing" : ""
            }`}
            {...(paneSortableListeners ?? {})}
            title={paneSortableListeners ? "拖拽以调整窗格顺序" : undefined}
          >
            {paneSortableListeners ? (
              <GripVertical
                className="h-4 w-4 shrink-0 text-text-faint opacity-50 hover:opacity-90"
                strokeWidth={1.8}
                aria-hidden
              />
            ) : null}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 truncate text-sm font-medium text-text-strong">
                {pane.avatarName}
                {(feishuDesktopBound || pane.sessionId?.startsWith("im-") || (!hasAnyFeishuDesktopBinding && !pane.avatarId)) && (
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-sm px-1 py-px text-[9px] font-medium leading-tight" style={{ backgroundColor: "rgba(51,112,255,0.15)", color: "#3370FF" }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
                      <path d="M5.63 4.02a1 1 0 0 1 1.4.17l4.97 6.3 4.97-6.3a1 1 0 0 1 1.58 1.22L14 10.83l5.37 6.8a1 1 0 0 1-1.57 1.24L12 12.16l-5.8 6.71a1 1 0 0 1-1.57-1.24L10 10.83 5.45 5.42a1 1 0 0 1 .18-1.4Z" fill="currentColor"/>
                    </svg>
                    飞书
                  </span>
                )}
              </div>
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
          </div>
          <div className="no-drag flex shrink-0 items-center gap-1">
            {isGroupPane && (
              <button
                className={`rounded px-2 py-0.5 text-[11px] transition ${
                  pane.membersPanelOpen
                    ? "bg-surface-card-strong text-text-strong"
                    : "text-text-faint hover:bg-surface-hover hover:text-text-strong"
                }`}
                onClick={() => cycleSidePanel(pane.id, "members")}
                title="切换群成员面板"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="6" cy="5" r="2.2" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M2 13c0-2.21 1.79-4 4-4s4 1.79 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  <circle cx="11.5" cy="5.5" r="1.7" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M13.5 13c0-1.66-1-3-2.5-3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
              </button>
            )}
            <button
              className={`rounded px-2 py-0.5 text-[11px] transition ${
                workspacePanelOpen
                  ? "bg-surface-card-strong text-text-strong"
                  : "text-text-faint hover:bg-surface-hover hover:text-text-strong"
              }`}
              onClick={() => cycleSidePanel(pane.id, "workspace")}
              title="切换工作区面板"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 4.5C2 3.67 2.67 3 3.5 3H6.38L7.88 4.5H12.5C13.33 4.5 14 5.17 14 6V11.5C14 12.33 13.33 13 12.5 13H3.5C2.67 13 2 12.33 2 11.5V4.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
              </svg>
            </button>
            {paneSubAgents.length > 0 ? (
              <button
                className={`rounded px-2 py-0.5 text-[11px] transition ${
                  pane.spawnsColumnOpen
                    ? "bg-surface-card-strong text-text-strong"
                    : "text-text-faint hover:bg-surface-hover hover:text-text-strong"
                }`}
                onClick={() => {
                  if (pane.spawnsColumnOpen) {
                    dismissSpawnsColumn(
                      pane.id,
                      paneSubAgents.map((s) => s.id)
                    );
                  } else {
                    setSpawnsColumnOpen(pane.id, true);
                  }
                }}
                title={pane.spawnsColumnOpen ? "收起 Spawns 列" : "打开 Spawns 列"}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="3" y="6" width="10" height="7" rx="2" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M6 6V4.5A2 2 0 0 1 10 4.5V6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  <circle cx="5.5" cy="9.5" r="0.8" fill="currentColor"/>
                  <circle cx="10.5" cy="9.5" r="0.8" fill="currentColor"/>
                  <path d="M1.5 8.5V10.5M14.5 8.5V10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  <path d="M6 12h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
              </button>
            ) : null}
            {!isGroupPane && pane.sessionId ? (() => {
              const isImSession = pane.sessionId.startsWith("im-");
              const isDefaultMetaRoute = !hasAnyFeishuDesktopBinding && !pane.avatarId && !isImSession;
              const isFeishuActive = feishuDesktopBound || isImSession || isDefaultMetaRoute;
              return (
                <button
                  type="button"
                  className={`rounded px-2 py-0.5 text-[11px] transition ${
                    isFeishuActive
                      ? ""
                      : "text-text-faint hover:bg-surface-hover hover:text-text-strong"
                  }`}
                  style={isFeishuActive ? { backgroundColor: "rgba(51,112,255,0.15)", color: "#3370FF" } : undefined}
                  onClick={isImSession || isDefaultMetaRoute ? undefined : () => void toggleFeishuDesktopBinding()}
                  title={
                    isImSession
                      ? "默认飞书会话（飞书消息未绑定分身时路由至此）"
                      : isDefaultMetaRoute
                      ? "默认飞书路由已回到 Machi（未绑定分身）"
                      : feishuDesktopBound
                      ? "已绑定飞书（点击解绑）"
                      : "绑定飞书到此会话"
                  }
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M6.2 9.8a2.5 2.5 0 0 1 0-3.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-.4.4M9.8 6.2a2.5 2.5 0 0 1 0 3.5l-1 1a2.5 2.5 0 0 1-3.5-3.5l.4-.4"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              );
            })() : null}
            <button
              className={`rounded px-2 py-0.5 text-[11px] transition ${
                pane.historyOpen
                  ? "bg-surface-card-strong text-text-strong"
                  : "text-text-faint hover:bg-surface-hover hover:text-text-strong"
              }`}
              onClick={() => togglePaneHistory(pane.id)}
              title="切换历史面板"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2.5 3C2.5 2.17 3.17 1.5 4 1.5H12C12.83 1.5 13.5 2.17 13.5 3V9C13.5 9.83 12.83 10.5 12 10.5H9L6.5 13V10.5H4C3.17 10.5 2.5 9.83 2.5 9V3Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                <path d="M5 5H11M5 7.5H9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </button>
            <button
              className="rounded px-2 py-0.5 text-[11px] text-text-faint transition hover:bg-surface-hover hover:text-status-error"
              onClick={() => removePane(pane.id)}
              title="关闭窗格"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        <div
          ref={listRef}
          className="relative min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-3"
        >
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
            <div className="min-w-0 space-y-2">
              {renderedMessages}
            </div>
          )}
          <Toast
            placement="inline-bottom-center"
            variant="warning"
            open={attachToastOpen}
            message={VISION_UNSUPPORTED_TOAST}
            onClose={() => setAttachToastOpen(false)}
            timeoutMs={3200}
          />
        </div>

        {/* 收藏 Toast：位于消息列表与输入框之间，水平居中 */}
        {favoriteToastOpen && (
          <div className="pointer-events-none flex justify-center px-4 pb-1 pt-1">
            <div className="rounded-lg border border-border bg-surface-card/95 px-3 py-2 text-xs text-text-primary shadow-lg backdrop-blur-sm">
              {favoriteToastMsg}
            </div>
          </div>
        )}

        <div className="shrink-0 border-t border-border px-4 py-2.5">
          <div className="mb-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-text-faint">
            {(() => {
              const tkIn = pane.sessionTokens?.input ?? 0;
              const tkOut = pane.sessionTokens?.output ?? 0;
              const tkTotal = tkIn + tkOut;
              return (
                <span
                  className="shrink-0 rounded border border-border bg-surface-card px-2 py-0.5"
                  title={tkTotal > 0
                    ? `↑ ${tkIn.toLocaleString()} input  ↓ ${tkOut.toLocaleString()} output`
                    : "本次会话累计 token 消耗"}
                >
                  {tkTotal > 0 ? `${(tkTotal / 1000).toFixed(1)}k tokens` : "0 tokens"}
                </span>
              );
            })()}
            <span className="shrink-0 truncate rounded border border-border bg-surface-card px-2 py-0.5" style={{ maxWidth: "45%" }}>
              {pane.sessionId ? `${pane.sessionId.slice(0, 8)}…` : "-"}
            </span>
            {activeProvider && activeModel ? (
              <span className="min-w-0 truncate rounded border border-border bg-surface-card px-2 py-0.5" style={{ maxWidth: "55%" }} title={`${activeProvider}/${activeModel}`}>
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
          {quoteTarget ? (
            <div className="mb-1 flex items-center gap-2 rounded border border-border bg-surface-card px-2 py-1 text-xs text-text-muted">
              <span className="truncate">
                引用 {quoteTarget.message.avatarName || quoteTarget.message.agentId || quoteTarget.message.role}:{" "}
                {quoteTarget.body.slice(0, 80)}
              </span>
              <button className="rounded px-1 hover:bg-surface-hover" onClick={() => setQuoteTarget(null)}>取消</button>
            </div>
          ) : null}
          {selectedMessageIds.size > 0 ? (
            <div className="mb-1 flex items-center gap-2 rounded border border-border bg-surface-card px-2 py-1 text-xs text-text-muted">
              <span>已多选 {selectedMessageIds.size} 条</span>
              <button className="rounded px-1 hover:bg-surface-hover" onClick={forwardSelectedMessages}>转发</button>
              <button
                className="rounded px-1 hover:bg-surface-hover"
                onClick={async () => {
                  const merged = selectedMessages
                    .map((message) => {
                      const name = message.role === "user" ? "我" : message.avatarName || message.agentId || "AI";
                      const time = message.timestamp
                        ? new Date(message.timestamp).toLocaleTimeString("zh-CN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "";
                      return `[${name}]${time ? ` ${time}` : ""}\n${message.content}`;
                    })
                    .join("\n\n");
                  try {
                    await navigator.clipboard.writeText(merged);
                  } catch {
                    // ignore clipboard failures
                  }
                }}
              >
                复制
              </button>
              <button className="rounded px-1 hover:bg-surface-hover text-rose-300" onClick={() => void deleteSelectedMessages()}>
                删除
              </button>
              <button className="rounded px-1 hover:bg-surface-hover" onClick={() => setSelectedMessageIds(new Set())}>取消</button>
            </div>
          ) : null}
          <div className="relative rounded-2xl border border-border bg-surface-card transition-colors focus-within:border-border-strong">
            {visibleAttachmentEntries.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 px-3 pt-3">
                {visibleAttachmentEntries.map(([key, file]) => (
                  <AttachmentChip key={key} file={file} onRemove={() => removeAttachment(key)} />
                ))}
              </div>
            ) : null}
            <div className="pointer-events-none absolute right-3 top-2 z-10 flex items-center gap-2">
              {composerExpanded ? (
                <span className="text-xs text-text-faint">↩ 键可用于换行</span>
              ) : null}
              <button
                type="button"
                className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-xl text-text-faint/55 outline-none transition hover:bg-surface-hover hover:text-text-strong focus:outline-none focus-visible:bg-surface-hover focus-visible:text-text-strong"
                aria-label={composerExpanded ? "收起输入区" : "展开输入区"}
                title={composerExpanded ? "收起输入区（Enter 发送）" : "展开输入区（Enter 换行）"}
                onClick={() => setComposerExpanded((prev) => !prev)}
              >
                {composerExpanded ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]">
                    <path d="M9 5H5v4M15 5h4v4M5 15v4h4M19 15v4h-4" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]">
                    <path d="M15 5h4v4M9 5H5v4M5 15v4h4M19 15v4h-4" />
                  </svg>
                )}
              </button>
            </div>
            <div
              ref={composerRef}
              contentEditable
              suppressContentEditableWarning
              onInput={() => {
                const value = extractComposerText();
                setInput(value);
                updateAtStateFromText(value);
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
              onPaste={(e) => {
                const dt = e.clipboardData;
                const raw = extractClipboardImageFiles(dt);
                const plain = dt?.getData("text/plain") ?? "";
                if (raw.length === 0) return;
                if (isKnownNonVisionChatModel(activeProvider, activeModel)) {
                  e.preventDefault();
                  setAttachToastOpen(true);
                  return;
                }
                e.preventDefault();
                const files = withClipboardImageNames(raw);
                if (plain) {
                  document.execCommand("insertText", false, plain.replace(/\r\n/g, "\n"));
                  const value = extractComposerText();
                  setInput(value);
                  updateAtStateFromText(value);
                }
                for (const file of files) {
                  const key = `${file.name}:${file.size}:${file.lastModified}`;
                  parseLocalFile(file, key);
                }
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
                    setAtOpen(false);
                    setAtQuery("");
                    if (first.kind === "avatar") {
                      const mention = `@${first.label} `;
                      const base = extractComposerText();
                      const next = base.replace(/(?:^|\s)@[^\s@]*$/, (text) => `${text.startsWith(" ") ? " " : ""}${mention}`);
                      setComposerText(next);
                      return;
                    }
                    if (first.kind === "taskspace") {
                      const mention = `@${first.label} `;
                      const base = extractComposerText();
                      const next = base.replace(/(?:^|\s)@[^\s@]*$/, (text) => `${text.startsWith(" ") ? " " : ""}${mention}`);
                      setComposerText(next);
                      void addTaskspaceAliasReference(first.taskspaceId, first.alias, first.path);
                    } else {
                      const mention = `@${first.label} `;
                      const base = extractComposerText();
                      const next = base.replace(/(?:^|\s)@[^\s@]*$/, (text) => `${text.startsWith(" ") ? " " : ""}${mention}`);
                      setComposerText(next, { tokenNames: [first.label] });
                      void addContextFile(first.taskspaceId, first.path, { referenceToken: true });
                    }
                    return;
                  }
                  if (composerExpanded) {
                    if (e.metaKey || e.ctrlKey) {
                      e.preventDefault();
                      void sendChat(extractComposerText());
                    }
                    return;
                  }
                  e.preventDefault();
                  void sendChat(extractComposerText());
                }
              }}
              className={`block w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-4 pb-0 pt-3 text-sm text-text-primary outline-none ${
                composerExpanded ? "max-h-[62vh] min-h-[260px] pr-40" : "max-h-[220px] min-h-[40px] pr-4"
              }`}
            />
            {input.trim().length === 0 ? (
              <div className="pointer-events-none absolute left-4 top-3 text-sm text-text-faint">发消息...</div>
            ) : null}
            <div className="flex min-w-0 items-center justify-between gap-1 px-2 pb-2 pt-1">
              <div className="flex min-w-0 items-center gap-0.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = e.target.files;
                    if (!files) return;
                    let showedVisionToast = false;
                    for (const file of Array.from(files)) {
                      if (isImageFile(file) && isKnownNonVisionChatModel(activeProvider, activeModel)) {
                        if (!showedVisionToast) {
                          setAttachToastOpen(true);
                          showedVisionToast = true;
                        }
                        continue;
                      }
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
                <NewTopicIconButtons onNewTopic={createNewTopic} />
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
                hasInput={!!pane.sessionId && (!!input.trim() || readyAttachments.length > 0)}
                streaming={streaming}
                recording={recording}
                onSend={() => void sendChat(extractComposerText())}
                onMic={onMicClick}
                onStop={() => abortRef.current?.abort()}
              />
            </div>
          </div>
          {atOpen ? (
            <div className="mt-1 max-h-28 overflow-y-auto rounded border border-border bg-surface-panel p-1 backdrop-blur-xl">
              {atCandidates.length === 0 ? (
                <div className="px-2 py-1 text-[11px] text-text-faint">
                  未找到匹配对象{atQuery ? `: ${atQuery}` : ""}
                </div>
              ) : (
                atCandidates.map((item) => (
                  <button
                    key={
                      item.kind === "avatar"
                        ? `avatar:${item.avatarId}`
                        : `${item.kind}:${item.taskspaceId}:${item.path}`
                    }
                    className="block w-full rounded px-2 py-1 text-left text-[11px] text-text-muted hover:bg-surface-hover"
                    onClick={() => {
                      setAtOpen(false);
                      setAtQuery("");
                      if (item.kind === "avatar") {
                        const mention = `@${item.label} `;
                        const base = extractComposerText();
                        const next = base.replace(/(?:^|\s)@[^\s@]*$/, (text) => `${text.startsWith(" ") ? " " : ""}${mention}`);
                        setComposerText(next);
                        return;
                      }
                      if (item.kind === "taskspace") {
                        const mention = `@${item.label} `;
                        const base = extractComposerText();
                        const next = base.replace(/(?:^|\s)@[^\s@]*$/, (text) => `${text.startsWith(" ") ? " " : ""}${mention}`);
                        setComposerText(next);
                        void addTaskspaceAliasReference(item.taskspaceId, item.alias, item.path);
                      } else {
                        const mention = `@${item.label} `;
                        const base = extractComposerText();
                        const next = base.replace(/(?:^|\s)@[^\s@]*$/, (text) => `${text.startsWith(" ") ? " " : ""}${mention}`);
                        setComposerText(next, { tokenNames: [item.label] });
                        void addContextFile(item.taskspaceId, item.path, { referenceToken: true });
                      }
                    }}
                  >
                    {item.kind === "avatar"
                      ? `👤 ${item.label}${item.role ? ` · ${item.role}` : ""}`
                      : item.kind === "taskspace"
                      ? `📁 ${item.label} → ${item.path}`
                      : item.path}
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

      {isGroupPane && pane.membersPanelOpen ? (
        <div className="relative h-full shrink-0 overflow-hidden border-l border-border" style={{ width: taskspaceWidth }}>
          <div
            className="group absolute -left-[3px] top-0 z-20 h-full w-2 cursor-col-resize"
            onMouseDown={startResizeTaskspace}
            title="拖拽调整面板宽度"
          >
            <div className="mx-auto h-full w-px transition" style={{ background: "var(--ui-accent-divider)" }} />
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-10 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-surface-panel opacity-60 transition group-hover:opacity-90" style={{ borderColor: "var(--ui-accent-divider-hover)" }} />
          </div>
          <GroupMembersSidePanel
            groupId={groupChatId}
            avatarList={avatars}
            metaLeaderLabel={metaLeaderDisplayName}
            onClose={() => cycleSidePanel(pane.id, "members")}
          />
        </div>
      ) : null}
      {workspacePanelOpen ? (
        <div className="relative h-full shrink-0 overflow-hidden border-l border-border" style={{ width: taskspaceWidth }}>
          <div
            className="group absolute -left-[3px] top-0 z-20 h-full w-2 cursor-col-resize"
            onMouseDown={startResizeTaskspace}
            title="拖拽调整工作区面板宽度"
          >
            <div className="mx-auto h-full w-px transition" style={{ background: "var(--ui-accent-divider)" }} />
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-10 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-surface-panel opacity-60 transition group-hover:opacity-90" style={{ borderColor: "var(--ui-accent-divider-hover)" }} />
          </div>
          <WorkspacePanel
            paneId={pane.id}
            sessionId={pane.sessionId}
            activeTaskspaceId={pane.activeTaskspaceId}
            onActiveTaskspaceChange={(taskspaceId) => setActiveTaskspace(pane.id, taskspaceId)}
            autoRefreshKey={taskspaceAutoRefreshKey}
            onClose={() => cycleSidePanel(pane.id, "workspace")}
            tintColor={paneTint}
            onPickFileForReference={(path) => {
              if (!pane.activeTaskspaceId) return;
              void addContextFile(pane.activeTaskspaceId, path, { referenceToken: true });
              const fileName = path.split(/[\\/]/).pop() || path;
              const mention = `@${fileName}`;
              const base = extractComposerText();
              const trimmed = base.trimEnd();
              const sep = !trimmed || /\s$/.test(base) ? "" : " ";
              const next = `${base}${sep}${mention} `;
              setComposerText(next, { tokenNames: [fileName] });
            }}
          />
        </div>
      ) : null}
      {pane.spawnsColumnOpen ? (
        <SpawnsColumn
          width={spawnsWidth}
          sessionId={pane.sessionId || undefined}
          subAgents={paneSubAgents}
          selectedSubAgent={selectedSubAgent}
          onResizeStart={startResizeSpawns}
          onClose={() => dismissSpawnsColumn(pane.id, paneSubAgents.map((s) => s.id))}
          onCancel={(agentId) => void cancelPaneSubAgent(agentId)}
          onRetry={(agentId) => void retryPaneSubAgent(agentId)}
          onChat={(agentId) => {
            const sub = paneSubAgents.find((item) => item.id === agentId);
            const isDelegation = agentId.startsWith("dlg-") || !!(sub?.events?.some((evt) => evt.type.startsWith("delegation")));
            if (isDelegation) {
              void openDelegatedAvatarSession(agentId);
              return;
            }
            setSelectedSubAgent(agentId);
          }}
          onSelect={(agentId) => setSelectedSubAgent(agentId)}
          onConfirmResolve={(agentId, approved) => void resolvePaneSubAgentConfirm(agentId, approved)}
          tintColor={paneTint}
        />
      ) : null}
      <HistoryPanelBoundary key={`hpb-${pane.id}-${pane.historyOpen}`}>
        <SessionHistoryPanel pane={pane} onClose={() => togglePaneHistory(pane.id)} tintColor={paneTint} />
      </HistoryPanelBoundary>
      <ForwardPicker
        open={forwardPickerOpen}
        currentSessionId={pane.sessionId}
        panes={panes}
        avatars={avatars}
        groups={groups}
        onClose={() => {
          setForwardPickerOpen(false);
          setPendingForwardMessages([]);
        }}
        onConfirm={async (targetPayload, followUpNote) => {
          await executeForward(targetPayload, followUpNote);
          setSelectedMessageIds(new Set());
        }}
      />
    </div>
  );
}
