import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEventHandler } from "react";
import { useAppStore, type Message, type QueuedMessage } from "../store";
import { getProviderDisplayName } from "../utils/provider-display";
import { SubAgentPanel } from "./SubAgentPanel";
import { interruptOnInterimResult, interruptTtsOnUserSpeech } from "../voice/interrupt";
import { speak } from "../voice/tts";
import { startRecording, stopRecording } from "../voice/stt";
import { CommandPalette } from "./CommandPalette";
import { QuickActions } from "./QuickActions";
import { ShortcutHints } from "./ShortcutHints";
import { createPhase1Registry } from "../core/command-registry";
import {
  ccBridgeSendToolProgressLabel,
  parseCcBridgeModeFromPayload,
  type CcBridgeSessionModeHint,
} from "../utils/cc-bridge-ui";
import { KeybindingsPanel } from "./KeybindingsPanel";
import { attachmentsFromSessionRow } from "../utils/session-message-map";
import { MessageRenderer, renderToolMessageExtras } from "./messages/MessageRenderer";
import { groupConsecutiveToolMessages, type GroupedChatRow } from "./messages/group-tool-messages";
import { expandMessagesToTopLevelRows } from "./messages/react-blocks";
import { TurnToolGroupCard } from "./messages/TurnToolGroupCard";
import { messagePlainTextForClipboard } from "../utils/markdown-copy-format";
import { ChatImAvatar, ImBubble } from "./messages/ImBubble";
import { TerminalLine } from "./messages/TerminalLine";
import { CleanBlock } from "./messages/CleanBlock";
import { QueuedMessageBubble } from "./messages/QueuedMessageBubble";
const EMPTY_QUEUE: QueuedMessage[] = [];

/** Matches {@link useAppStore.getState().updateMessageByToolCallId} `patch` argument. */
type ToolCallStreamPatch = Partial<
  Pick<Message, "content" | "toolStatus" | "toolElapsedSec" | "toolResultPreview" | "toolStreamLines" | "inlineConfirm">
> & { appendStreamLine?: string };

type Props = {
  onOpenConfirm: (
    requestId: string,
    question: string,
    diff?: string,
    agentId?: string,
    context?: Record<string, unknown>
  ) => Promise<boolean>;
  mode?: "pro" | "lite";
};

const statusLabel: Record<string, string> = {
  idle: "",
  listening: "聆听中...",
  processing: "思考中..."
};

const statusDot: Record<string, string> = {
  idle: "bg-emerald-400",
  listening: "bg-cyan-400 animate-pulse",
  processing: "bg-amber-400 animate-spin"
};

const confirmModeLabel: Record<string, string> = {
  manual: "每次询问",
  "semi-auto": "白名单放行",
  auto: "全部自动执行",
};

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
  if (toolName === "cc_bridge_send") {
    try {
      const parsed = JSON.parse(resultText) as Record<string, unknown>;
      const mode = String(parsed.mode ?? "headless");
      const ok = Boolean(parsed.ok);
      const interactive = Boolean(parsed.interactive);
      const pr = String(parsed.parsed_response ?? "").trim();
      const conf = Number(parsed.parse_confidence ?? 0);
      if (mode === "visible_tui") {
        if (interactive && ok) {
          return {
            content:
              "✅ 已发送到 Claude Code（Visible TUI）。请继续在右侧「claude-code」终端交互；如出现权限提示，直接在终端内按键确认。",
            silent: false,
          };
        }
        if (pr && ok) {
          return {
            content: `✅ Claude Code（Visible TUI，解析置信度 ${Math.round(Math.min(1, conf) * 100)}%）\n\n${pr}`,
            silent: false,
          };
        }
        const tail = String(parsed.tail ?? "").slice(0, 900);
        return {
          content: `⏳ Visible TUI：${ok ? "本轮已结束" : "未完成或解析置信度较低"}。请在右侧「claude-code」内嵌交互终端查看；若未自动连接，请确认 cc-bridge 已启动且配置 token 有效。\n${tail ? `\n---\n${tail}` : ""}`,
          silent: false,
        };
      }
    } catch {
      // fall through
    }
  }
  if (toolName === "query_subagent_status") {
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
        const counts = rows.reduce<Record<string, number>>((acc, row) => {
          const s = String(row.status ?? "unknown");
          acc[s] = (acc[s] ?? 0) + 1;
          return acc;
        }, {});
        const summary = Object.entries(counts)
          .map(([k, v]) => `${k}:${v}`)
          .join(" ");
        return { content: `📡 状态快照: ${rows.length} 个子智能体 (${summary})`, silent: false };
      }
    } catch {
      // Fall through to generic formatter.
    }
  }
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
    return { content: `⚠️ ${toolName} 提示: ${resultText}`, silent: false };
  }
  return { content: `✅ ${toolName} 结果: ${resultText}`, silent: false };
}

function deriveToolStatusFromResult(resultRaw: unknown): "done" | "error" {
  const t =
    typeof resultRaw === "string"
      ? resultRaw
      : (() => {
          try {
            return JSON.stringify(resultRaw ?? "");
          } catch {
            return String(resultRaw ?? "");
          }
        })();
  if (/^\s*ERROR:/i.test(t)) return "error";
  const m = t.match(/exit_code=(\d+)/);
  if (m && m[1] !== "0") return "error";
  return "done";
}

function serializeToolResultRaw(resultRaw: unknown): string {
  if (typeof resultRaw === "string") return resultRaw;
  try {
    return JSON.stringify(resultRaw ?? "", null, 2);
  } catch {
    return String(resultRaw ?? "");
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

function ModelBadge({ provider, model }: { provider?: string; model?: string }) {
  const providers = useAppStore((s) => s.settings.providers);
  if (!model) return null;
  const entry = provider ? providers[provider] : undefined;
  const provLabel = provider ? getProviderDisplayName(provider, entry) : "";
  const label = provLabel ? `${provLabel}/${model}` : model;
  return (
    <span className="mb-1 inline-block rounded bg-surface-card px-1.5 py-0.5 text-[10px] text-text-subtle">
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

function StreamingThinkingIndicator() {
  return (
    <div className="flex items-center gap-2">
      <span className="relative inline-flex h-3 w-3">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400/50" />
        <span className="relative inline-flex h-3 w-3 animate-pulse rounded-full bg-cyan-300" />
      </span>
      <span className="text-xs font-medium tracking-wide text-cyan-200/90">AgenticX 正在深度思考</span>
    </div>
  );
}

function MessageActions({
  msg,
  onCopy,
  onRetry,
  onReanswer,
}: {
  msg: Message;
  onCopy: () => void;
  onRetry: () => void;
  onReanswer: () => void;
}) {
  if (msg.role !== "assistant") return null;
  return (
    <div className="mt-1.5 flex items-center gap-3 text-[11px] text-text-faint">
      <button className="transition hover:text-text-muted" onClick={onCopy} title="复制">
        复制
      </button>
      <button className="transition hover:text-text-muted" onClick={onRetry} title="重试">
        重试
      </button>
      <button className="transition hover:text-cyan-400" onClick={onReanswer} title="换模型回答">
        @换模型
      </button>
    </div>
  );
}

export function ChatView({ onOpenConfirm, mode = "pro" }: Props) {
  const apiBase = useAppStore((s) => s.apiBase);
  const sessionId = useAppStore((s) => s.sessionId);
  const apiToken = useAppStore((s) => s.apiToken);
  const messages = useAppStore((s) => s.messages);
  const status = useAppStore((s) => s.status);
  const addMessage = useAppStore((s) => s.addMessage);
  const updateMessageByToolCallId = useAppStore((s) => s.updateMessageByToolCallId);
  const insertMessageAfter = useAppStore((s) => s.insertMessageAfter);
  const setStatus = useAppStore((s) => s.setStatus);
  const openSettings = useAppStore((s) => s.openSettings);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const agxAccount = useAppStore((s) => s.agxAccount);
  const setAgxAccount = useAppStore((s) => s.setAgxAccount);
  const activeProvider = useAppStore((s) => s.activeProvider);
  const activeModel = useAppStore((s) => s.activeModel);
  const setActiveModel = useAppStore((s) => s.setActiveModel);
  const userMode = useAppStore((s) => s.userMode);
  const setUserMode = useAppStore((s) => s.setUserMode);
  const planMode = useAppStore((s) => s.planMode);
  const setPlanMode = useAppStore((s) => s.setPlanMode);
  const commandPaletteOpen = useAppStore((s) => s.commandPaletteOpen);
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const keybindingsPanelOpen = useAppStore((s) => s.keybindingsPanelOpen);
  const setKeybindingsPanelOpen = useAppStore((s) => s.setKeybindingsPanelOpen);
  const confirmStrategy = useAppStore((s) => s.confirmStrategy);
  const setConfirmStrategy = useAppStore((s) => s.setConfirmStrategy);
  const clearMessages = useAppStore((s) => s.clearMessages);
  const subAgents = useAppStore((s) => s.subAgents);
  const selectedSubAgent = useAppStore((s) => s.selectedSubAgent);
  const setSessionId = useAppStore((s) => s.setSessionId);
  const setActiveAvatarId = useAppStore((s) => s.setActiveAvatarId);
  const avatars = useAppStore((s) => s.avatars);
  const chatStyle = useAppStore((s) => s.chatStyle);
  const liteQueueKey = "lite-pane";
  const queuedMessages = useAppStore((s) => s.pendingMessages[liteQueueKey] ?? EMPTY_QUEUE);
  const enqueuePaneMessage = useAppStore((s) => s.enqueuePaneMessage);
  const removePendingMessage = useAppStore((s) => s.removePendingMessage);
  const editPendingMessage = useAppStore((s) => s.editPendingMessage);
  const addSubAgent = useAppStore((s) => s.addSubAgent);
  const updateSubAgent = useAppStore((s) => s.updateSubAgent);
  const addSubAgentEvent = useAppStore((s) => s.addSubAgentEvent);
  const setSelectedSubAgent = useAppStore((s) => s.setSelectedSubAgent);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamedAssistantText, setStreamedAssistantText] = useState("");
  const [streamingModel, setStreamingModel] = useState<{ provider: string; model: string } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [headerModelPickerOpen, setHeaderModelPickerOpen] = useState(false);
  const [reanswerTarget, setReanswerTarget] = useState<string | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [keybindingsOpen, setKeybindingsOpen] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamTextRef = useRef("");
  const streamRafRef = useRef<number | null>(null);
  const streamCommittedRef = useRef(false);
  /** Text last committed at a tool_call boundary; avoids duplicating the same assistant bubble at stream end. */
  const lastMidStreamAssistantCommitRef = useRef<string | null>(null);
  const abortedByUserRef = useRef(false);
  const activeRequestIdRef = useRef(0);
  const modelBtnRef = useRef<HTMLButtonElement | null>(null);
  const imeComposingRef = useRef(false);
  const polledEventSeenRef = useRef<Record<string, Set<string>>>({});
  const subAgentsRef = useRef(subAgents);
  const subAgentStatusRef = useRef<Record<string, string>>({});
  const ccBridgeLastSessionModeRef = useRef<CcBridgeSessionModeHint>("");
  const isLite = mode === "lite";
  const applyUserMode = useCallback(
    async (nextMode: "pro" | "lite") => {
      setUserMode(nextMode);
      const nextStrategy = nextMode === "lite" ? "manual" : "semi-auto";
      setConfirmStrategy(nextStrategy);
      if (nextMode === "lite") setPlanMode(false);
      setCommandPaletteOpen(false);
      setKeybindingsPanelOpen(false);
      await window.agenticxDesktop.saveUserMode(nextMode);
      await window.agenticxDesktop.saveConfirmStrategy(nextStrategy);
    },
    [setUserMode, setConfirmStrategy, setPlanMode, setCommandPaletteOpen, setKeybindingsPanelOpen]
  );

  const deferredCommandQuery = useDeferredValue(commandQuery);
  const registry = useMemo(
    () =>
      createPhase1Registry({
        openSettings,
        openModelPicker: () => setHeaderModelPickerOpen(true),
        openKeybindings: () => setKeybindingsOpen(true),
        clearMessages,
        togglePlanMode: () => {
          const next = !planMode;
          setPlanMode(next);
          return next;
        },
        toggleUserMode: async () => {
          const nextMode = userMode === "pro" ? "lite" : "pro";
          await applyUserMode(nextMode);
        },
        cycleConfirmStrategy: async () => {
          const order: Array<"manual" | "semi-auto" | "auto"> = ["manual", "semi-auto", "auto"];
          const idx = order.indexOf(confirmStrategy);
          const next = order[(idx + 1) % order.length];
          setConfirmStrategy(next);
          await window.agenticxDesktop.saveConfirmStrategy(next);
          return next;
        },
        addAssistantMessage: (content) => addMessage("assistant", content, "meta"),
      }),
    [
      openSettings,
      clearMessages,
      userMode,
      addMessage,
      planMode,
      setPlanMode,
      confirmStrategy,
      setConfirmStrategy,
      applyUserMode,
    ]
  );
  const commandResults = useMemo(
    () => registry.search(deferredCommandQuery, userMode),
    [registry, deferredCommandQuery, userMode]
  );

  const canSend = useMemo(() => !!(apiBase && sessionId), [apiBase, sessionId]);
  const visibleMessages = useMemo(
    () => messages.filter((item) => !item.agentId || item.agentId === "meta"),
    [messages]
  );
  const groupedVisibleMessages = useMemo(
    () => groupConsecutiveToolMessages(visibleMessages),
    [visibleMessages]
  );
  const topLevelRowsIm = useMemo(
    () => (chatStyle === "im" ? expandMessagesToTopLevelRows(visibleMessages) : null),
    [chatStyle, visibleMessages]
  );
  /** Avoid showing __stream__ on top of an already-committed assistant bubble with identical text. */
  const hideStreamOverlayAsDuplicate = useMemo(() => {
    if (!streaming) return false;
    const t = (streamedAssistantText || "").trim();
    if (!t) return false;
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      const m = visibleMessages[i];
      if (m.role === "user") break;
      if (m.role === "assistant" && (!m.agentId || m.agentId === "meta")) {
        return String(m.content ?? "").trim() === t;
      }
    }
    return false;
  }, [streaming, streamedAssistantText, visibleMessages]);

  const modelLabel = activeModel
    ? (activeProvider ? `${activeProvider} / ${activeModel}` : activeModel)
    : "未选择模型";
  const selectedSubAgentName = useMemo(() => {
    if (!selectedSubAgent) return "";
    return subAgents.find((item) => item.id === selectedSubAgent)?.name ?? selectedSubAgent;
  }, [selectedSubAgent, subAgents]);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      }
    });
  };

  const cancelStreamRenderFrame = () => {
    if (streamRafRef.current !== null) {
      window.cancelAnimationFrame(streamRafRef.current);
      streamRafRef.current = null;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [visibleMessages]);

  useEffect(() => {
    if (subAgents.length > 0) {
      setPanelOpen(true);
    }
  }, [subAgents.length]);

  useEffect(() => {
    subAgentsRef.current = subAgents;
    const next: Record<string, string> = {};
    for (const item of subAgents) next[item.id] = item.status;
    subAgentStatusRef.current = next;
  }, [subAgents]);

  useEffect(() => {
    ccBridgeLastSessionModeRef.current = "";
  }, [sessionId]);

  useEffect(() => {
    if (!commandPaletteOpen || isLite) return;
    setCommandOpen(true);
    setCommandQuery("");
    setCommandPaletteOpen(false);
  }, [commandPaletteOpen, setCommandPaletteOpen, isLite]);

  useEffect(() => {
    if (!keybindingsPanelOpen || isLite) return;
    setKeybindingsOpen(true);
    setKeybindingsPanelOpen(false);
  }, [keybindingsPanelOpen, setKeybindingsPanelOpen, isLite]);

  useEffect(() => {
    if (isLite) return;
    try {
      const raw = localStorage.getItem("agx.desktop.inputHistory");
      if (!raw) return;
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed)) setHistory(parsed.slice(0, 100));
    } catch {
      // ignore parse errors
    }
  }, [isLite]);

  const pushHistory = (value: string) => {
    if (!value.trim() || value.trim().startsWith("/")) {
      setHistoryIndex(-1);
      return;
    }
    setHistory((prev) => {
      const dedup = prev.filter((item) => item !== value);
      const next = [value, ...dedup].slice(0, 100);
      try {
        localStorage.setItem("agx.desktop.inputHistory", JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
    setHistoryIndex(-1);
  };

  const openDelegatedAvatarSession = useCallback(
    async (agentId: string) => {
      const sub = useAppStore.getState().subAgents.find((item) => item.id === agentId);
      const targetSessionId = (sub?.sessionId ?? "").trim();
      if (!targetSessionId) return false;

      const matchedAvatar = avatars.find((item) => item.name === (sub?.name ?? ""));
      if (matchedAvatar?.id) setActiveAvatarId(matchedAvatar.id);
      setSessionId(targetSessionId);
      setSelectedSubAgent(null);

      try {
        const result = await window.agenticxDesktop.loadSessionMessages(targetSessionId);
        clearMessages();
        if (result.ok && Array.isArray(result.messages)) {
          for (const item of result.messages) {
            const role = item.role === "user" || item.role === "assistant" || item.role === "tool" ? item.role : "assistant";
            addMessage(
              role,
              item.content,
              item.agent_id ?? "meta",
              item.provider,
              item.model,
              attachmentsFromSessionRow(item.attachments)
            );
          }
        }
      } catch {
        clearMessages();
      }
      return true;
    },
    [avatars, setActiveAvatarId, setSessionId, setSelectedSubAgent, clearMessages, addMessage]
  );

  const syncSubAgents = useCallback(async () => {
    if (!apiBase || !sessionId) return;
    try {
      const resp = await fetch(
        `${apiBase}/api/subagents/status?session_id=${encodeURIComponent(sessionId)}`,
        { headers: { "x-agx-desktop-token": apiToken } }
      );
      if (!resp.ok) return;
      const data = await resp.json() as {
        ok?: boolean;
        subagents?: Array<{
          agent_id: string;
          name?: string;
          role?: string;
          provider?: string;
          model?: string;
          task?: string;
          status?: "pending" | "running" | "completed" | "failed" | "cancelled";
          result_summary?: string;
          error_text?: string;
          recent_events?: Array<{ type?: string; data?: Record<string, unknown> }>;
        }>;
      };
      if (!Array.isArray(data.subagents)) return;
      for (const item of data.subagents) {
        const id = item.agent_id;
        if (!id) continue;
        const currentSubs = subAgentsRef.current;
        const exists = currentSubs.some((s) => s.id === id);
        if (!exists) {
          addSubAgent({
            id,
            name: item.name ?? id,
            role: item.role ?? "worker",
            provider: item.provider ?? undefined,
            model: item.model ?? undefined,
            task: item.task ?? "",
          });
        }
        const status = item.status ?? "running";
        const prevStatus = subAgentStatusRef.current[id];
        subAgentStatusRef.current[id] = status;
        const currentAction =
          status === "completed"
            ? (item.result_summary ? "已完成（见摘要）" : "已完成")
            : status === "failed"
              ? (item.error_text || "执行异常")
              : status === "cancelled"
                ? "已中断"
                : "执行中";
        const existing = currentSubs.find((s) => s.id === id);
        updateSubAgent(id, {
          status,
          currentAction,
          provider: item.provider ?? existing?.provider,
          model: item.model ?? existing?.model,
        });

        const transitionedToTerminal =
          prevStatus !== status && (status === "completed" || status === "failed" || status === "cancelled");
        if (transitionedToTerminal) {
          const summaryText =
            status === "completed"
              ? (item.result_summary || "子智能体任务已完成")
              : status === "cancelled"
                ? "子智能体已中断"
                : (item.error_text || "子智能体执行失败");
          addMessage("tool", `📌 ${item.name ?? id} (${id}) ${status === "completed" ? "已完成" : status === "cancelled" ? "已中断" : "失败"}\n${summaryText}`, "meta");
        }

        const seen = polledEventSeenRef.current[id] ?? new Set<string>();
        polledEventSeenRef.current[id] = seen;
        const recentEvents = Array.isArray(item.recent_events) ? item.recent_events : [];
        for (const evt of recentEvents) {
          const evtType = String(evt?.type ?? "");
          const evtData = (evt?.data ?? {}) as Record<string, unknown>;
          const signature = `${evtType}:${JSON.stringify(evtData)}`;
          if (seen.has(signature)) continue;
          seen.add(signature);
          if (seen.size > 300) {
            const first = seen.values().next().value as string | undefined;
            if (first) seen.delete(first);
          }
          const SILENT_TOOLS = new Set(["check_resources"]);
          let content = "";
          if (evtType === "tool_call") {
            if (SILENT_TOOLS.has(String(evtData.name ?? ""))) continue;
            const toolName = String(evtData.name ?? "tool");
            const toolArgs = evtData.arguments ?? {};
            content = `🔧 ${toolName}: ${JSON.stringify(toolArgs).slice(0, 120)}`;
            const livePreview = buildToolCallLivePreview(toolName, toolArgs);
            if (livePreview) {
              const sub = useAppStore.getState().subAgents.find((item) => item.id === id);
              const prev = sub?.liveOutput ?? "";
              updateSubAgent(id, { liveOutput: `${prev}${prev ? "\n\n" : ""}${livePreview}`.slice(-12000) });
            }
          } else if (evtType === "tool_result") {
            const result = typeof evtData.result === "string" ? evtData.result : JSON.stringify(evtData.result ?? {});
            const formatted = formatToolResultMessage(evtData.name, result);
            if (formatted.silent) continue;
            content = formatted.content;
            const toolName = String(evtData.name ?? "");
            if (toolName === "file_write" || toolName === "file_edit") {
              const sub = useAppStore.getState().subAgents.find((item) => item.id === id);
              const prev = sub?.liveOutput ?? "";
              updateSubAgent(id, { liveOutput: `${prev}\n\n# ${toolName} applied`.slice(-12000) });
            }
          } else if (evtType === "error") {
            content = `❌ ${String(evtData.text ?? "执行异常")}`;
          } else if (evtType === "confirm_required") {
            content = `⏸ 等待确认: ${String(evtData.question ?? "请确认执行")}`;
          } else if (typeof evtData.text === "string" && evtData.text.trim()) {
            content = evtData.text;
          } else {
            content = `${evtType || "event"}: ${JSON.stringify(evtData)}`;
          }
          addSubAgentEvent(id, { type: evtType || "event", content });
        }
      }
    } catch {
      // silent
    }
  }, [apiBase, sessionId, apiToken, addSubAgent, updateSubAgent, addMessage, addSubAgentEvent]);

  useEffect(() => {
    if (!apiBase || !sessionId) return;
    const hasAnySubagent = subAgentsRef.current.length > 0;
    void syncSubAgents();
    const interval = hasAnySubagent ? 2000 : 5000;
    const timer = window.setInterval(() => void syncSubAgents(), interval);
    return () => window.clearInterval(timer);
  }, [apiBase, sessionId, syncSubAgents, subAgents.length]);

  const onCancelSubAgent = async (agentId: string) => {
    if (!apiBase || !sessionId) return;
    updateSubAgent(agentId, { status: "cancelled", currentAction: "用户请求中断..." });
    try {
      const resp = await fetch(`${apiBase}/api/subagent/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({ session_id: sessionId, agent_id: agentId })
      });
      if (!resp.ok) throw new Error(await resp.text() || `HTTP ${resp.status}`);
      addSubAgentEvent(agentId, { type: "cancel", content: "已发送中断请求" });
    } catch (err) {
      updateSubAgent(agentId, { status: "cancelled", currentAction: "中断请求失败（后端未找到该任务）" });
      addSubAgentEvent(agentId, { type: "error", content: `中断请求失败: ${String(err)}` });
    }
  };

  const onRetrySubAgent = async (agentId: string) => {
    if (!apiBase || !sessionId) return;
    updateSubAgent(agentId, { status: "pending", currentAction: "正在重试..." });
    try {
      const resp = await fetch(`${apiBase}/api/subagent/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({ session_id: sessionId, agent_id: agentId })
      });
      if (!resp.ok) throw new Error(await resp.text() || `HTTP ${resp.status}`);
      addSubAgentEvent(agentId, { type: "retry", content: "已发送重试请求" });
      addMessage("tool", `🔁 已请求重试子智能体 ${agentId}`, "meta");
    } catch (err) {
      updateSubAgent(agentId, { status: "failed", currentAction: "重试失败" });
      addSubAgentEvent(agentId, { type: "error", content: `重试失败: ${String(err)}` });
    }
  };

  const sendChat = async (
    userText: string,
    opts?: { provider?: string; model?: string; insertAfterId?: string; agentId?: string }
  ) => {
    if (!userText || !apiBase || !sessionId) return;
    if (streaming) {
      abortedByUserRef.current = true;
      abortRef.current?.abort();
      const partial = streamTextRef.current.trim();
      if (partial && !isThinkingPlaceholderText(partial) && !streamCommittedRef.current) {
        addMessage("assistant", streamTextRef.current, "meta", activeProvider, activeModel);
        streamCommittedRef.current = true;
      }
      addMessage("tool", "已中断上一轮生成，开始处理新消息", "meta");
      streamTextRef.current = "";
      cancelStreamRenderFrame();
      setStreamedAssistantText("");
      setStreamingModel(null);
      setStatus("idle");
      setStreaming(false);
    }
    const reqProvider = opts?.provider ?? activeProvider;
    const reqModel = opts?.model ?? activeModel;
    const targetAgentId = (opts?.agentId ?? "meta").trim() || "meta";
    const effectiveUserText =
      userMode === "pro" && planMode && targetAgentId === "meta"
        ? `你现在处于计划模式。请只输出可执行计划与风险，不要调用工具，不要执行操作。\n\n用户需求：${userText}`
        : userText;
    const requestId = activeRequestIdRef.current + 1;
    activeRequestIdRef.current = requestId;
    const isCurrentRequest = () => activeRequestIdRef.current === requestId;
    let insertAfterCursor = opts?.insertAfterId;
    const appendAssistantMessage = (content: string) => {
      if (insertAfterCursor) {
        insertAfterCursor = insertMessageAfter(insertAfterCursor, {
          role: "assistant",
          content,
          agentId: "meta",
          provider: reqProvider,
          model: reqModel,
        });
        return;
      }
      addMessage("assistant", content, "meta", reqProvider, reqModel);
    };
    const commitCurrentStreamIfNeeded = () => {
      const raw = streamTextRef.current.trim();
      // Trim trailing colon ("：" or ":") that model writes just before calling a tool.
      const partial = raw.replace(/[：:]\s*$/, "").trimEnd();
      if (!partial || isThinkingPlaceholderText(partial) || streamCommittedRef.current) return false;
      appendAssistantMessage(partial);
      streamCommittedRef.current = true;
      lastMidStreamAssistantCommitRef.current = partial;
      return true;
    };
    const scheduleStreamTextUpdate = (nextText: string) => {
      streamTextRef.current = nextText;
      if (!isCurrentRequest()) return;
      if (streamRafRef.current !== null) return;
      streamRafRef.current = window.requestAnimationFrame(() => {
        streamRafRef.current = null;
        if (isCurrentRequest()) setStreamedAssistantText(streamTextRef.current);
      });
    };
    const resetStreamSegment = () => {
      streamTextRef.current = "";
      cancelStreamRenderFrame();
      if (isCurrentRequest()) setStreamedAssistantText("");
      streamCommittedRef.current = false;
    };

    if (!opts?.insertAfterId) {
      setInput("");
      if (targetAgentId === "meta") {
        addMessage("user", userText, "meta");
      } else {
        addSubAgentEvent(targetAgentId, { type: "user", content: userText });
        addMessage("tool", `🗣 发送给 ${selectedSubAgentName || targetAgentId}: ${userText}`, "meta");
      }
    }

    setStatus("processing");
    setStreaming(true);
    cancelStreamRenderFrame();
    setStreamedAssistantText("");
    setStreamingModel(reqModel ? { provider: reqProvider, model: reqModel } : null);
    streamTextRef.current = "";
    streamCommittedRef.current = false;
    lastMidStreamAssistantCommitRef.current = null;
    abortedByUserRef.current = false;
    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const body: Record<string, unknown> = { session_id: sessionId, user_input: effectiveUserText };
      if (reqProvider) body.provider = reqProvider;
      if (reqModel) body.model = reqModel;
      if (targetAgentId !== "meta") body.agent_id = targetAgentId;
      const resp = await fetch(`${apiBase}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify(body),
        signal: abortController.signal
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) { if (isCurrentRequest()) { setStatus("idle"); setStreaming(false); } return; }

      let full = "";
      let cumulativeFull = "";
      let buffer = "";
      while (true) {
        if (!isCurrentRequest()) return;
        const { value: chunk, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            const eventAgentId = payload.data?.agent_id ?? "meta";
            if (payload.type === "tool_progress") {
              if (!isCurrentRequest()) continue;
              const name = String(payload.data?.name ?? "tool");
              const sec = Number(payload.data?.elapsed_seconds ?? 0);
              const outputLine = payload.data?.line as string | undefined;
              const progressCallId = String(payload.data?.tool_call_id ?? payload.data?.id ?? "").trim();
              if (eventAgentId === "meta" && progressCallId) {
                const patch: ToolCallStreamPatch = {
                  toolStatus: "running",
                };
                if (Number.isFinite(sec)) patch.toolElapsedSec = sec;
                if (outputLine !== undefined) patch.appendStreamLine = String(outputLine);
                updateMessageByToolCallId(progressCallId, patch);
                continue;
              }
              if (outputLine !== undefined && eventAgentId === "meta" && !progressCallId) {
                continue;
              }
              if (eventAgentId === "meta") {
                continue;
              }
              if (name === "cc_bridge_send") {
                updateSubAgent(eventAgentId, {
                  currentAction: ccBridgeSendToolProgressLabel(sec, ccBridgeLastSessionModeRef.current),
                });
              } else {
                updateSubAgent(eventAgentId, {
                  currentAction: Number.isFinite(sec) ? `${name} 执行中… (${sec}s)` : `${name} 执行中…`,
                });
              }
              continue;
            }
            if (payload.type === "token") {
              if (eventAgentId !== "meta") { addSubAgentEvent(eventAgentId, { type: "token", content: "生成中..." }); continue; }
              const rawToken = String(payload.data?.text ?? "");
              // Strip backend-emitted ⏳ waiting placeholder from streamed tokens.
              const tokenText = rawToken.replace(/⏳\s*/g, "");
              if (!tokenText) continue;
              full += tokenText;
              cumulativeFull += tokenText;
              scheduleStreamTextUpdate(full);
            }
            if (payload.type === "tool_call") {
              const toolNameStr = String(payload.data?.name ?? "tool");
              const toolArgs = (payload.data?.arguments ?? payload.data?.args ?? {}) as Record<string, unknown>;
              const toolCallId = String(payload.data?.tool_call_id ?? payload.data?.id ?? "").trim();
              if (eventAgentId === "meta" && toolNameStr === "cc_bridge_start") {
                const modeHint = parseCcBridgeModeFromPayload(toolArgs);
                if (modeHint === "headless") {
                  ccBridgeLastSessionModeRef.current = "headless";
                } else if (modeHint === "visible_tui") {
                  ccBridgeLastSessionModeRef.current = "visible_tui";
                }
              }
              const SILENT_TOOLS_SSE = new Set(["check_resources"]);
              if (!SILENT_TOOLS_SSE.has(toolNameStr)) {
                if (eventAgentId === "meta") {
                  commitCurrentStreamIfNeeded();
                  full = "";
                  resetStreamSegment();
                  const globalMsgs = useAppStore.getState().messages;
                  const lastMsg = globalMsgs.length ? globalMsgs[globalMsgs.length - 1] : undefined;
                  const toolGroupId =
                    lastMsg?.role === "tool" && lastMsg.toolGroupId
                      ? lastMsg.toolGroupId
                      : crypto.randomUUID();
                  const rawArgs = JSON.stringify(toolArgs);
                  const content =
                    rawArgs.length > 80_000 ? `${rawArgs.slice(0, 80_000)}\n… (truncated)` : rawArgs;
                  if (toolCallId) {
                    addMessage("tool", content, "meta", undefined, undefined, undefined, {
                      toolCallId,
                      toolName: toolNameStr,
                      toolArgs,
                      toolStatus: "running",
                      toolGroupId,
                    });
                  } else {
                    const legacy = `\u{1F527} ${toolNameStr}: ${JSON.stringify(toolArgs).slice(0, 120)}`;
                    addMessage("tool", legacy, "meta");
                  }
                } else {
                  const legacy = `\u{1F527} ${toolNameStr}: ${JSON.stringify(toolArgs).slice(0, 120)}`;
                  updateSubAgent(eventAgentId, { status: "running", currentAction: `调用工具 ${toolNameStr}` });
                  addSubAgentEvent(eventAgentId, { type: "tool_call", content: legacy });
                  const livePreview = buildToolCallLivePreview(toolNameStr, toolArgs);
                  if (livePreview) {
                    const sub = useAppStore.getState().subAgents.find((item) => item.id === eventAgentId);
                    const prev = sub?.liveOutput ?? "";
                    updateSubAgent(eventAgentId, { liveOutput: `${prev}${prev ? "\n\n" : ""}${livePreview}`.slice(-12000) });
                  }
                }
              }
            }
            if (payload.type === "tool_result") {
              const toolName = payload.data?.name ?? "tool";
              let resultObjForCc: Record<string, unknown> | null = null;
              const resultRaw = payload.data?.result;
              if (typeof resultRaw === "string") {
                try {
                  const parsed = JSON.parse(resultRaw);
                  resultObjForCc = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
                } catch {
                  resultObjForCc = null;
                }
              } else if (resultRaw && typeof resultRaw === "object") {
                resultObjForCc = resultRaw as Record<string, unknown>;
              }
              if (eventAgentId === "meta" && toolName === "cc_bridge_start" && resultObjForCc) {
                const hint = parseCcBridgeModeFromPayload(resultObjForCc);
                if (hint) {
                  ccBridgeLastSessionModeRef.current = hint;
                }
              }
              const formatted = formatToolResultMessage(toolName, resultRaw);
              if (formatted.silent) continue;
              const resultCallId = String(payload.data?.tool_call_id ?? payload.data?.id ?? "").trim();
              const rawContent = serializeToolResultRaw(resultRaw);
              const preview = formatted.content.replace(/\s+/g, " ").trim().slice(0, 160);
              const mergedStatus = deriveToolStatusFromResult(resultRaw);
              if (eventAgentId === "meta" && resultCallId) {
                const merged = updateMessageByToolCallId(resultCallId, {
                  content: rawContent,
                  toolStatus: mergedStatus,
                  toolResultPreview: preview,
                  toolStreamLines: [],
                });
                if (!merged) {
                  addMessage("tool", formatted.content, "meta");
                }
              } else if (eventAgentId === "meta") {
                addMessage("tool", formatted.content, "meta");
              } else {
                addSubAgentEvent(eventAgentId, { type: "tool_result", content: formatted.content });
                if (toolName === "file_write" || toolName === "file_edit") {
                  const sub = useAppStore.getState().subAgents.find((item) => item.id === eventAgentId);
                  const prev = sub?.liveOutput ?? "";
                  updateSubAgent(eventAgentId, { liveOutput: `${prev}\n\n# ${toolName} applied`.slice(-12000) });
                }
              }
              if (
                eventAgentId === "meta" &&
                toolName === "cc_bridge_send" &&
                resultObjForCc &&
                resultObjForCc.mode === "visible_tui" &&
                resultObjForCc.ok === true &&
                String(resultObjForCc.parsed_response ?? "").trim().length > 0
              ) {
                addMessage("assistant", String(resultObjForCc.parsed_response), "meta", activeProvider, activeModel);
              }
            }
            if (payload.type === "confirm_required") {
              if (!isCurrentRequest()) continue;
              if (eventAgentId !== "meta") {
                updateSubAgent(eventAgentId, { status: "awaiting_confirm", currentAction: "等待你的确认" });
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
              if (!isCurrentRequest()) continue;
              await fetch(`${apiBase}/api/confirm`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
                body: JSON.stringify({ session_id: sessionId, request_id: payload.data?.id, approved: ok, agent_id: eventAgentId })
              });
            }
            if (payload.type === "confirm_response") {
              if (eventAgentId !== "meta") {
                const approved = !!payload.data?.approved;
                updateSubAgent(eventAgentId, {
                  status: approved ? "running" : "cancelled",
                  currentAction: approved ? "确认通过，继续执行" : "确认拒绝，已取消",
                });
                addSubAgentEvent(eventAgentId, {
                  type: "confirm_response",
                  content: approved ? "确认通过" : "确认拒绝",
                });
              }
            }
            if (payload.type === "final") {
              if (eventAgentId !== "meta") { updateSubAgent(eventAgentId, { status: "completed", currentAction: "已完成" }); addSubAgentEvent(eventAgentId, { type: "final", content: payload.data?.text ?? "" }); continue; }
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
                  normalizeStreamText(finalText) !== normalizeStreamText(full) &&
                  normalizeStreamText(finalText) !== normalizeStreamText(cumulativeFull) &&
                  !normalizeStreamText(full).includes(normalizeStreamText(finalText)) &&
                  !normalizeStreamText(cumulativeFull).includes(normalizeStreamText(finalText))
                ) {
                  const merged = full.trim() ? `\n\n${finalText}` : finalText;
                  full += merged;
                  cumulativeFull += merged;
                }
              }
              scheduleStreamTextUpdate(full);
            }
            if (payload.type === "subagent_started") {
              const subId = payload.data?.agent_id;
              if (subId) {
                const isDelegation = Boolean(payload.data?.delegation);
                addSubAgent({
                  id: subId,
                  name: payload.data?.name ?? subId,
                  role: payload.data?.role ?? (isDelegation ? "delegated avatar" : "worker"),
                  provider: payload.data?.provider ?? undefined,
                  model: payload.data?.model ?? undefined,
                  task: payload.data?.task ?? "",
                  sessionId: isDelegation ? sessionId : (typeof payload.data?.avatar_session_id === "string" ? payload.data.avatar_session_id : undefined),
                });
                updateSubAgent(subId, {
                  status: "running",
                  currentAction: isDelegation ? "委派执行中" : "执行中",
                });
                addSubAgentEvent(
                  subId,
                  {
                    type: isDelegation ? "delegation_started" : "started",
                    content: isDelegation ? `已委派给 ${payload.data?.name ?? subId}` : "已启动",
                  }
                );
              }
            }
            if (payload.type === "subagent_progress") { const subId = payload.data?.agent_id; if (subId) { updateSubAgent(subId, { currentAction: payload.data?.text ?? "执行中" }); addSubAgentEvent(subId, { type: "progress", content: payload.data?.text ?? "执行中" }); } }
            if (payload.type === "subagent_checkpoint") {
              const subId = payload.data?.agent_id;
              if (subId) {
                updateSubAgent(subId, { status: "running", currentAction: payload.data?.text ?? "阶段检查点" });
                addSubAgentEvent(subId, { type: "checkpoint", content: payload.data?.text ?? "阶段检查点" });
              }
            }
            if (payload.type === "subagent_paused") {
              const subId = payload.data?.agent_id;
              if (subId) {
                updateSubAgent(subId, { status: "failed", currentAction: payload.data?.text ?? "已暂停，等待指令" });
                addSubAgentEvent(subId, { type: "paused", content: payload.data?.text ?? "已暂停，等待指令" });
              }
            }
            if (payload.type === "subagent_completed") {
              const subId = payload.data?.agent_id;
              if (subId) {
                const isDelegation = Boolean(payload.data?.delegation);
                updateSubAgent(subId, {
                  status: "completed",
                  currentAction: isDelegation ? "委派完成" : "已完成",
                  sessionId: typeof payload.data?.avatar_session_id === "string" ? payload.data.avatar_session_id : undefined,
                });
                addSubAgentEvent(subId, {
                  type: isDelegation ? "delegation_completed" : "completed",
                  content: payload.data?.summary ?? (isDelegation ? "委派完成" : "完成"),
                });
              }
            }
            if (payload.type === "subagent_error") {
              const subId = payload.data?.agent_id;
              if (subId) {
                const isDelegation = Boolean(payload.data?.delegation);
                updateSubAgent(subId, {
                  status: payload.data?.status === "cancelled" ? "cancelled" : "failed",
                  currentAction: payload.data?.text ?? "执行异常",
                  sessionId: typeof payload.data?.avatar_session_id === "string" ? payload.data.avatar_session_id : undefined,
                });
                addSubAgentEvent(subId, {
                  type: isDelegation ? "delegation_error" : "error",
                  content: payload.data?.text ?? "执行异常",
                });
              }
            }
            if (payload.type === "error") {
              if (eventAgentId === "meta") addMessage("tool", `❌ ${payload.data?.text ?? "未知错误"}`, "meta");
              else { updateSubAgent(eventAgentId, { status: "failed", currentAction: payload.data?.text ?? "执行异常" }); addSubAgentEvent(eventAgentId, { type: "error", content: payload.data?.text ?? "未知错误" }); }
            }
          } catch { /* skip malformed SSE */ }
        }
        scrollToBottom();
      }

      const trimmedFull = full.trim();
      if (isCurrentRequest() && trimmedFull && !isThinkingPlaceholderText(full) && !streamCommittedRef.current) {
        const mid = lastMidStreamAssistantCommitRef.current;
        if (mid !== null && trimmedFull === mid) {
          streamCommittedRef.current = true;
        } else {
          appendAssistantMessage(full);
          streamCommittedRef.current = true;
        }
        void speak(full);
      }
    } catch (err) {
      if (!isCurrentRequest()) return;
      if (err instanceof DOMException && err.name === "AbortError") {
        if (!abortedByUserRef.current) {
          commitCurrentStreamIfNeeded();
          addMessage("tool", "已中断当前生成", "meta");
        }
      } else {
        addMessage("tool", `❌ 请求失败: ${String(err)}`, "meta");
      }
    } finally {
      if (!isCurrentRequest()) return;
      abortRef.current = null;
      cancelStreamRenderFrame();
      streamTextRef.current = "";
      setStreamedAssistantText("");
      setStreamingModel(null);
      setStatus("idle");
      setStreaming(false);
      scrollToBottom();
      void syncSubAgents();

      const nextQueued = useAppStore.getState().dequeuePaneMessage(liteQueueKey);
      if (nextQueued) {
        requestAnimationFrame(() => void sendChat(nextQueued.text));
      }
    }
  };

  const send = async (manualInput?: string) => {
    const toSend = (manualInput ?? input).trim();
    if (!isLite && (commandOpen || toSend.startsWith("/"))) {
      return;
    }
    pushHistory(toSend);
    await sendChat(toSend, {
      agentId: isLite ? undefined : (selectedSubAgent ?? undefined),
    });
  };

  const executeCommand = async (id: string) => {
    await registry.dispatch(id);
    setInput("");
    setCommandQuery("");
    setCommandOpen(false);
    setCommandPaletteOpen(false);
  };

  const stopStreaming = () => {
    if (!streaming) return;
    const sid = String(sessionId || "").trim();
    if (sid) {
      void window.agenticxDesktop.interruptSession?.(sid);
    }
    abortedByUserRef.current = true;
    abortRef.current?.abort();
    const partial = streamTextRef.current.trim();
    if (partial && !isThinkingPlaceholderText(partial) && !streamCommittedRef.current) { addMessage("assistant", streamTextRef.current, "meta", activeProvider, activeModel); streamCommittedRef.current = true; }
    addMessage("tool", "已发送中断请求", "meta");
    streamTextRef.current = "";
    cancelStreamRenderFrame();
    setStreamedAssistantText("⏹ 正在中断...");
    setStreamingModel(null);
    setStatus("idle");
    setStreaming(false);
    scrollToBottom();
  };

  const findPrecedingUserText = (msgId: string): string => {
    const idx = messages.findIndex((m) => m.id === msgId);
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === "user") return messages[i].content;
    }
    return "";
  };

  const onCopyMessage = (msg: Message) => {
    void navigator.clipboard.writeText(messagePlainTextForClipboard(msg));
  };

  const onRetryMessage = (msg: Message) => {
    const userText = findPrecedingUserText(msg.id);
    if (!userText) return;
    void sendChat(userText, { provider: msg.provider, model: msg.model });
  };

  const onReanswerMessage = (msgId: string) => {
    setReanswerTarget(msgId);
    setModelPickerOpen(true);
  };

  const onReanswerSelect = (provider: string, model: string) => {
    if (!reanswerTarget) return;
    const userText = findPrecedingUserText(reanswerTarget);
    if (!userText) return;
    void sendChat(userText, { provider, model, insertAfterId: reanswerTarget });
    setReanswerTarget(null);
  };

  const onKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    const isImeComposing =
      event.nativeEvent.isComposing ||
      imeComposingRef.current ||
      event.key === "Process" ||
      event.keyCode === 229;
    if (isImeComposing) return;
    if (!isLite && event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      if (history.length === 0) return;
      const nextIdx = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(nextIdx);
      setInput(history[nextIdx] ?? "");
      return;
    }
    if (!isLite && event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      if (history.length === 0) return;
      const nextIdx = historyIndex - 1;
      if (nextIdx < 0) {
        setHistoryIndex(-1);
        setInput("");
        return;
      }
      setHistoryIndex(nextIdx);
      setInput(history[nextIdx] ?? "");
      return;
    }
    if (!isLite && (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "p") {
      event.preventDefault();
      setPlanMode(!planMode);
      return;
    }
    if (!isLite && (event.ctrlKey || event.metaKey) && event.key === "/") {
      event.preventDefault();
      setKeybindingsOpen(true);
      setKeybindingsPanelOpen(false);
      return;
    }
    if (!isLite && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      setCommandOpen(true);
      setCommandQuery("");
      setCommandPaletteOpen(false);
      return;
    }
    if (event.key === "Escape") {
      if (commandOpen) {
        event.preventDefault();
        setCommandOpen(false);
        setCommandQuery("");
      } else if (streaming) {
        event.preventDefault();
        stopStreaming();
      }
      return;
    }
    if (commandOpen && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (commandResults[0]) {
        void executeCommand(commandResults[0].id);
      }
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!isLite && input.trim().startsWith("/")) {
        const query = input.trim().slice(1);
        const list = registry.search(query, userMode);
        if (list[0]) {
          void executeCommand(list[0].id);
        } else {
          setCommandOpen(true);
          setCommandQuery(query);
        }
        return;
      }
      void send();
    }
  };

  const onMicClick = () => {
    setStatus("listening");
    void startRecording(
      async (text) => { setStatus("processing"); await send(text); },
      (interim) => interruptOnInterimResult(interim)
    );
    window.setTimeout(() => { stopRecording(); }, 5000);
  };

  return (
    <div className="flex h-full min-w-0">
      <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* Title bar */}
      <div className="drag-region flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex w-20 items-center" />
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-muted">AgenticX</span>
          {!isLite && <span className="text-text-faint">·</span>}
          {!isLite && (
            <div className="relative">
              <button
                ref={modelBtnRef}
                className="no-drag flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-cyan-400"
                onClick={() => setHeaderModelPickerOpen((v) => !v)}
                title="切换模型"
              >
                <span className="max-w-[200px] truncate">{modelLabel}</span>
                <span className="text-[10px]">▾</span>
              </button>
              {headerModelPickerOpen && (
                <div className="absolute left-0 top-full z-40 mt-1">
                  <ModelPickerDropdown
                    onSelect={(p, m) => {
                      setActiveModel(p, m);
                      setHeaderModelPickerOpen(false);
                      void window.agenticxDesktop.saveConfig({ activeProvider: p, activeModel: m });
                    }}
                    onClose={() => setHeaderModelPickerOpen(false)}
                  />
                </div>
              )}
            </div>
          )}
          {status !== "idle" && (
            <span className="flex items-center gap-1.5 text-xs text-text-subtle">
              <span className={`inline-block h-2 w-2 rounded-full ${statusDot[status]}`} />
              {statusLabel[status]}
            </span>
          )}
          {!isLite && planMode && (
            <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-300">计划模式</span>
          )}
          {!isLite && (
            <span className="rounded bg-surface-hover px-2 py-0.5 text-[11px] text-text-muted">
              审批: {confirmModeLabel[confirmStrategy] ?? confirmStrategy}
            </span>
          )}
        </div>
        <div className="flex w-auto items-center justify-end gap-2">
          {/* Lite 模式已废弃，不再展示 Pro/Lite 切换入口。 */}
          {(subAgents.length > 0 || isLite) ? (
            <button
              className="no-drag rounded-md px-2 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
              onClick={() => setPanelOpen((v) => !v)}
              title="子智能体面板"
            >
              团队{subAgents.length > 0 ? `(${subAgents.length})` : ""}
            </button>
          ) : null}
          <button
            className="no-drag rounded-md px-2 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
            onClick={() => {
              const next = theme === "dark" || theme === "dim" ? "light" : "dark";
              setTheme(next);
              try {
                window.localStorage.setItem("agx-theme", next);
              } catch {
                // ignore storage errors
              }
            }}
            title={theme === "light" ? "切换到暗色" : "切换到亮色"}
            aria-label="切换主题"
          >
            {theme === "light" ? "🌙" : "☀"}
          </button>
          <button
            className="no-drag rounded-md px-2 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
            onClick={() => openSettings()}
            title="设置"
          >
            ⚙
          </button>
          {agxAccount.loggedIn ? (
            <button
              className="no-drag inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
              onClick={async () => {
                const r = await window.agenticxDesktop.confirmDialog({
                  title: "退出官网账号",
                  message: "确定要清除本机已保存的 Machi 官网登录状态吗？",
                  confirmText: "退出",
                  destructive: true,
                });
                if (!r.confirmed) return;
                await window.agenticxDesktop.agxAccountLogout();
                setAgxAccount({ loggedIn: false, email: "", displayName: "" });
              }}
              title={agxAccount.displayName || agxAccount.email || "已登录"}
            >
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-400/90 text-[9px] font-semibold text-black">
                {(agxAccount.displayName || agxAccount.email || "?").trim().charAt(0).toUpperCase()}
              </span>
              <span className="max-w-[80px] truncate">
                {agxAccount.displayName || agxAccount.email}
              </span>
            </button>
          ) : (
            <button
              className="no-drag rounded-md px-2 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
              disabled={loginBusy}
              onClick={async () => {
                if (loginBusy) return;
                setLoginBusy(true);
                try {
                  const r = await window.agenticxDesktop.agxAccountLoginStart();
                  if (!r.ok) {
                    await window.agenticxDesktop.confirmDialog({
                      title: "无法开始登录",
                      message: "未能开始官网账号登录，请稍后再试。",
                      detail: typeof r.error === "string" && r.error ? `错误：${r.error}` : undefined,
                      confirmText: "确定",
                    });
                  }
                } catch (e) {
                  await window.agenticxDesktop.confirmDialog({
                    title: "无法开始登录",
                    message: String(e),
                    confirmText: "确定",
                  });
                } finally {
                  setLoginBusy(false);
                }
              }}
              title="登录 Machi 官网账号"
            >
              {loginBusy ? "登录中..." : "登录"}
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3">
        {visibleMessages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center text-text-faint">
              <div className="mb-2 text-3xl">🤖</div>
              <div className="text-sm">{isLite ? "问我任何问题，或使用下方推荐操作" : "输入你的需求开始对话"}</div>
            </div>
          </div>
        )}
        <div className={`mx-auto max-w-3xl space-y-3 ${isLite ? "text-[15px]" : ""}`}>
          {(() => {
            const renderGroupedChatRow = (row: GroupedChatRow, reactWorkCol: boolean) => {
              if (row.kind === "message") {
                const m = row.message;
                return (
                  <div key={m.id} className={`${isLite ? "text-[15px]" : "text-sm"}`}>
                    <MessageRenderer
                      message={m}
                      assistantBadge={!isLite && m.role === "assistant" ? <ModelBadge provider={m.provider} model={m.model} /> : undefined}
                      assistantName="Machi"
                      imAssistantVisual={
                        m.role === "assistant" && reactWorkCol ? "compact-inline" : "default"
                      }
                      toolCardOmitLeadingSpacer={m.role === "tool" && reactWorkCol}
                    />
                    {!isLite && (
                      <MessageActions
                        msg={m}
                        onCopy={() => onCopyMessage(m)}
                        onRetry={() => onRetryMessage(m)}
                        onReanswer={() => onReanswerMessage(m.id)}
                      />
                    )}
                  </div>
                );
              }
              return (
                <TurnToolGroupCard
                  key={`tg-${row.groupId}`}
                  messages={row.messages}
                  renderExtras={(msg) => renderToolMessageExtras(msg, {})}
                  omitLeadingSpacer={reactWorkCol}
                />
              );
            };

            if (topLevelRowsIm) {
              return topLevelRowsIm.map((seg, segIdx) => {
                if (seg.kind === "user") {
                  return renderGroupedChatRow({ kind: "message", message: seg.message }, false);
                }
                const { workMessages, finalAssistant } = seg.block;
                const groupedWork = groupConsecutiveToolMessages(workMessages);
                const blockKey = `react-${workMessages[0]?.id ?? segIdx}-${finalAssistant?.id ?? ""}`;
                return (
                  <div key={blockKey} className="space-y-3">
                    <div className="flex min-w-0 items-start gap-2">
                      <div className="flex min-w-0 flex-1 flex-col gap-3">
                        {groupedWork.map((r) => renderGroupedChatRow(r, true))}
                      </div>
                    </div>
                    {finalAssistant ? renderGroupedChatRow({ kind: "message", message: finalAssistant }, false) : null}
                  </div>
                );
              });
            }
            return groupedVisibleMessages.map((row) => renderGroupedChatRow(row, false));
          })()}
          {streaming && !hideStreamOverlayAsDuplicate && (
            <div className={`${isLite ? "text-[15px]" : "text-sm"}`}>
              {chatStyle === "terminal" ? (
                <TerminalLine
                  message={{ id: "__stream__", role: "assistant", content: streamedAssistantText || "" }}
                  badge={!isLite && streamingModel ? <ModelBadge provider={streamingModel.provider} model={streamingModel.model} /> : undefined}
                />
              ) : chatStyle === "clean" ? (
                <CleanBlock
                  message={{ id: "__stream__", role: "assistant", content: streamedAssistantText || "" }}
                  badge={!isLite && streamingModel ? <ModelBadge provider={streamingModel.provider} model={streamingModel.model} /> : undefined}
                />
              ) : (
                <ImBubble
                  message={{ id: "__stream__", role: "assistant", content: streamedAssistantText || "" }}
                  badge={!isLite && streamingModel ? <ModelBadge provider={streamingModel.provider} model={streamingModel.model} /> : undefined}
                  assistantName="Machi"
                />
              )}
            </div>
          )}
          {queuedMessages.length > 0 && queuedMessages.map((qm, qi) => (
            <QueuedMessageBubble
              key={qm.id}
              msg={qm}
              index={qi}
              total={queuedMessages.length}
              onEdit={(id, newText) => editPendingMessage(liteQueueKey, id, newText)}
              onRemove={(id) => removePendingMessage(liteQueueKey, id)}
            />
          ))}
        </div>
      </div>

      {/* Input area */}
      <div className="relative shrink-0 border-t border-border bg-surface-panel/80 px-4 py-3">
        {!isLite && (
          <CommandPalette
            open={commandOpen}
            query={commandQuery}
            commands={commandResults}
            onQueryChange={setCommandQuery}
            onClose={() => {
              setCommandOpen(false);
              setCommandQuery("");
              setCommandPaletteOpen(false);
            }}
            onExecute={(id) => void executeCommand(id)}
          />
        )}
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          {selectedSubAgent ? (
            <div className="mb-2 w-full">
              <div className="inline-flex items-center gap-2 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-200">
                <span>当前对话目标: {selectedSubAgentName}</span>
                <button
                  className="rounded px-1 text-cyan-100 hover:bg-cyan-500/20"
                  onClick={() => setSelectedSubAgent(null)}
                >
                  切回 Meta
                </button>
              </div>
            </div>
          ) : null}
        </div>
        {isLite && <QuickActions onSend={(text) => { void send(text); }} />}
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => {
              interruptTtsOnUserSpeech(true);
              const value = e.target.value;
              setInput(value);
              if (!isLite && value.startsWith("/")) {
                setCommandOpen(true);
                setCommandQuery(value.slice(1));
              } else {
                setCommandOpen(false);
                setCommandQuery("");
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
            onKeyDown={onKeyDown}
            rows={input.split("\n").length > 3 ? 4 : input.includes("\n") ? 2 : 1}
            placeholder={canSend ? (isLite ? (selectedSubAgent ? `对 ${selectedSubAgentName} 发送消息...` : "问我任何问题...") : (planMode ? "计划模式：描述目标，我只返回可执行计划" : (selectedSubAgent ? `对 ${selectedSubAgentName} 发送补充指令，Enter 发送` : "输入需求，Enter 发送（生成中可直接追问）"))) : "连接中..."}
            disabled={!canSend && !streaming}
            className="min-h-[40px] max-h-[120px] flex-1 resize-none rounded-xl border border-border bg-surface-card px-3 py-2.5 text-sm outline-none transition placeholder:text-text-faint focus:border-cyan-500/50"
          />
          <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border text-lg transition hover:bg-surface-hover" onClick={onMicClick} title="语音输入">🎙</button>
          {streaming ? (
            <div className="flex items-center gap-2">
              <button className="flex h-10 shrink-0 items-center rounded-xl bg-rose-500 px-4 text-sm font-medium text-white transition hover:bg-rose-400" onClick={stopStreaming}>中断</button>
              <button className="flex h-10 shrink-0 items-center rounded-xl bg-cyan-500 px-4 text-sm font-medium text-black transition hover:bg-cyan-400 disabled:opacity-40 disabled:hover:bg-cyan-500" disabled={!canSend || !input.trim()} onClick={() => void send()}>追问</button>
              <button
                className="flex h-10 shrink-0 items-center rounded-xl border border-border px-4 text-sm font-medium text-text-subtle transition hover:bg-surface-hover disabled:opacity-40"
                disabled={!canSend || !input.trim()}
                onClick={() => {
                  const text = input.trim();
                  if (!text) return;
                  enqueuePaneMessage(liteQueueKey, {
                    id: crypto.randomUUID(),
                    text,
                    attachments: [],
                    contextFiles: [],
                    timestamp: Date.now(),
                  });
                  setInput("");
                }}
                title="不中断当前生成，排队等待发送"
              >排队</button>
            </div>
          ) : (
            <button className="flex h-10 shrink-0 items-center rounded-xl bg-cyan-500 px-4 text-sm font-medium text-black transition hover:bg-cyan-400 disabled:opacity-40 disabled:hover:bg-cyan-500" disabled={!canSend || !input.trim()} onClick={() => void send()}>发送</button>
          )}
        </div>
        {!isLite && <ShortcutHints />}
      </div>
      </div>
      <SubAgentPanel
        open={panelOpen}
        subAgents={subAgents}
        selectedSubAgent={selectedSubAgent}
        onToggle={() => setPanelOpen((v) => !v)}
        onCancel={onCancelSubAgent}
        onRetry={onRetrySubAgent}
        onChat={(id) => {
          const sub = subAgents.find((item) => item.id === id);
          const isDelegation = id.startsWith("dlg-") || !!(sub?.sessionId && sub?.events?.some((evt) => evt.type.startsWith("delegation")));
          if (isDelegation) {
            void openDelegatedAvatarSession(id);
            return;
          }
          setSelectedSubAgent(id);
        }}
        onSelect={(id) => setSelectedSubAgent(id)}
      />
      {/* Reanswer model picker */}
      {modelPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[300px] rounded-xl border border-border bg-surface-panel p-3">
            <div className="mb-2 text-sm font-medium text-text-muted">选择模型重新回答</div>
            <ModelPickerDropdown
              onSelect={(p, m) => { onReanswerSelect(p, m); setModelPickerOpen(false); }}
              onClose={() => { setModelPickerOpen(false); setReanswerTarget(null); }}
            />
            <button className="mt-2 w-full rounded-md border border-border py-1.5 text-xs text-text-subtle hover:bg-surface-hover" onClick={() => { setModelPickerOpen(false); setReanswerTarget(null); }}>取消</button>
          </div>
        </div>
      )}
      <KeybindingsPanel open={keybindingsOpen} mode={userMode} onClose={() => setKeybindingsOpen(false)} />
    </div>
  );
}

function ModelPickerDropdown({ onSelect, onClose }: { onSelect: (p: string, m: string) => void; onClose: () => void }) {
  const settings = useAppStore((s) => s.settings);
  const options = useMemo(() => {
    const result: { provider: string; model: string; label: string }[] = [];
    for (const [provName, entry] of Object.entries(settings.providers)) {
      if (entry.enabled === false) continue;
      if (!entry.apiKey) continue;
      const provLabel = getProviderDisplayName(provName, entry);
      if (entry.models.length > 0) {
        for (const m of entry.models) result.push({ provider: provName, model: m, label: `${provLabel} | ${m}` });
      } else if (entry.model) {
        result.push({ provider: provName, model: entry.model, label: `${provLabel} | ${entry.model}` });
      }
    }
    return result;
  }, [settings.providers]);

  if (options.length === 0) {
    return <div className="px-3 py-4 text-center text-xs text-text-faint">请先在设置中配置 Provider 和模型</div>;
  }
  return (
    <div className="max-h-[240px] overflow-y-auto">
      {options.map((opt) => (
        <button
          key={`${opt.provider}:${opt.model}`}
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-text-muted transition hover:font-bold hover:text-text-strong"
          onClick={() => { onSelect(opt.provider, opt.model); onClose(); }}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
          <span className="truncate">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}
