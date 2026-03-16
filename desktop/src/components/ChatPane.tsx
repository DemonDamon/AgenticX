import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAppStore, type Message } from "../store";
import { startRecording, stopRecording } from "../voice/stt";
import { SessionHistoryPanel } from "./SessionHistoryPanel";

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
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-400 transition hover:bg-slate-800 hover:text-cyan-300"
        onClick={() => setOpen((v) => !v)}
        title="切换模型"
      >
        <span className="max-w-[180px] truncate">{currentLabel}</span>
        <span className="text-[9px]">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-40 mb-1 max-h-[220px] w-[240px] overflow-y-auto rounded-lg border border-border bg-slate-900 shadow-xl">
            {options.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs text-slate-500">
                请先在设置中配置模型
              </div>
            ) : (
              options.map((opt) => {
                const isActive = opt.provider === activeProvider && opt.model === activeModel;
                return (
                  <button
                    key={`${opt.provider}:${opt.model}`}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-cyan-500/10 hover:text-white ${
                      isActive ? "text-cyan-300 bg-cyan-500/10" : "text-slate-300"
                    }`}
                    onClick={() => handleSelect(opt.provider, opt.model)}
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? "bg-cyan-400" : "bg-slate-600"}`} />
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

const mdComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  h1: ({ children }) => <h1 className="mb-2 mt-3 text-base font-bold text-slate-100">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1.5 mt-2 text-sm font-bold text-slate-200">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-1.5 text-sm font-semibold text-slate-200">{children}</h3>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-0.5 pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-0.5 pl-4">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-slate-100">{children}</strong>,
  em: ({ children }) => <em className="italic text-slate-300">{children}</em>,
  a: ({ href, children }) => (
    <a href={href} className="text-cyan-400 underline hover:text-cyan-300" target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-slate-500 pl-3 text-slate-400 italic">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-slate-600/60" />,
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md bg-slate-900/80 px-4 py-3 text-xs leading-relaxed">
      {children}
    </pre>
  ),
  code: ({ children, className }) => {
    const isBlock = !!className;
    return isBlock ? (
      <code className={`${className ?? ""} font-mono`}>{children}</code>
    ) : (
      <code className="rounded bg-slate-900/60 px-1 py-0.5 text-xs font-mono text-cyan-300">{children}</code>
    );
  },
};

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
    <span className="mb-1 inline-block rounded bg-slate-600/60 px-1.5 py-0.5 text-[10px] text-slate-400">
      {label}
    </span>
  );
}

function isThinkingPlaceholderText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return /^[\s⏳….·.]+$/.test(trimmed);
}

function StreamingThinkingIndicator() {
  return (
    <div className="flex items-center gap-2">
      <span className="relative inline-flex h-3 w-3">
        <span className="absolute inline-flex h-full w-full rounded-full bg-cyan-400/50 animate-ping" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-cyan-300 animate-pulse" />
      </span>
      <span className="text-xs font-medium tracking-wide text-cyan-200/90">AgenticX 正在深度思考</span>
    </div>
  );
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
        const counts = rows.reduce(
          (acc, row) => {
            const s = String(row.status ?? "unknown");
            acc[s] = (acc[s] ?? 0) + 1;
            return acc;
          },
          {} as Record<string, number>
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

export function ChatPane({ paneId, focused, onFocus, onOpenConfirm }: Props) {
  const pane = useAppStore((s) => s.panes.find((item) => item.id === paneId));
  const removePane = useAppStore((s) => s.removePane);
  const togglePaneHistory = useAppStore((s) => s.togglePaneHistory);
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
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [recording, setRecording] = useState(false);
  const [streamedAssistantText, setStreamedAssistantText] = useState("");
  const [streamingModel, setStreamingModel] = useState<{ provider: string; model: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const visibleMessages = useMemo(
    () => (pane?.messages ?? []).filter((item) => !item.agentId || item.agentId === "meta"),
    [pane?.messages]
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

  if (!pane) return null;

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

    const targetAgentId = (selectedSubAgent ?? "meta").trim() || "meta";
    if (targetAgentId === "meta") {
      addPaneMessage(pane.id, "user", text, "meta");
    } else {
      addSubAgentEvent(targetAgentId, { type: "user", content: text });
      addPaneMessage(pane.id, "tool", `🗣 发送给 ${targetAgentId}: ${text}`, "meta");
    }
    setInput("");
    setStreaming(true);
    setStreamedAssistantText("");
    setStreamingModel(activeModel ? { provider: activeProvider, model: activeModel } : null);
    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const body: Record<string, unknown> = { session_id: requestSessionId, user_input: text };
      if (activeProvider) body.provider = activeProvider;
      if (activeModel) body.model = activeModel;
      if (targetAgentId !== "meta") body.agent_id = targetAgentId;
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
                full += payload.data?.text ?? "";
                setStreamedAssistantText(full);
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
                if (eventAgentId === "meta") addPaneMessage(pane.id, "tool", content, "meta");
                else {
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
                if (!full.trim() || isThinkingPlaceholderText(full)) {
                  full = finalText || full;
                } else if (finalText && !full.includes(finalText)) {
                  full += "\n\n" + finalText;
                }
                setStreamedAssistantText(full);
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

      if (full.trim() && !isThinkingPlaceholderText(full)) {
        addPaneMessage(pane.id, "assistant", full, "meta", activeProvider, activeModel);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        addPaneMessage(pane.id, "tool", `❌ 请求失败: ${String(error)}`, "meta");
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      setStreamedAssistantText("");
      setStreamingModel(null);
    }
  };

  const createNewTopic = (inherit = true) => {
    const prevSessionId = pane.sessionId;
    clearPaneMessages(pane.id);
    setPaneSessionId(pane.id, "");
    setPaneContextInherited(pane.id, false);
    const avatarId =
      pane.avatarId && pane.avatarId.startsWith("group:") ? undefined : pane.avatarId ?? undefined;
    void (async () => {
      const result = await window.agenticxDesktop.createSession({
        avatar_id: avatarId,
        ...(inherit && prevSessionId ? { inherit_from_session_id: prevSessionId } : {}),
      });
      if (result.ok && result.session_id) {
        setPaneSessionId(pane.id, result.session_id);
        if (result.inherited) {
          setPaneContextInherited(pane.id, true);
        }
      }
    })();
  };

  return (
    <div
      className={`flex h-full min-w-0 flex-1 rounded-md border ${
        focused ? "border-cyan-500/40" : "border-border/60"
      } bg-slate-950/60`}
      onMouseDown={onFocus}
    >
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <div className="drag-region flex h-10 shrink-0 items-center justify-between border-b border-border/60 px-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-200">{pane.avatarName}</div>
            <div className="flex items-center gap-1.5 truncate text-[10px] text-slate-500">
              <span>session: {pane.sessionId ? pane.sessionId.slice(0, 8) + "…" : "-"}</span>
              {visibleMessages.length > 0 && (
                <span className="rounded bg-slate-700/50 px-1 text-slate-400">{visibleMessages.length} 条</span>
              )}
              {pane.contextInherited && (
                <span className="rounded bg-emerald-500/20 px-1 text-emerald-400">已继承</span>
              )}
            </div>
          </div>
          <div className="no-drag flex items-center gap-1">
            <button
              className="rounded px-2 py-0.5 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-cyan-300"
              onClick={() => togglePaneHistory(pane.id)}
              title="切换历史面板"
            >
              历史
            </button>
            <button
              className="rounded px-2 py-0.5 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-rose-300"
              onClick={() => removePane(pane.id)}
              title="关闭窗格"
            >
              关闭
            </button>
          </div>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2">
          {!pane.sessionId ? (
            <div className="flex h-full items-center justify-center text-xs text-slate-500">
              <span className="animate-pulse">正在初始化会话...</span>
            </div>
          ) : visibleMessages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-slate-500">暂无消息</div>
          ) : (
            <div className="space-y-2">
              {visibleMessages.map((message) => (
                <div
                  key={message.id}
                  className={
                    message.role === "user"
                      ? "ml-6 min-w-0 overflow-hidden rounded-xl rounded-tr-sm bg-cyan-500/20 px-3 py-2 text-sm"
                      : message.role === "assistant"
                        ? "mr-6 min-w-0 overflow-hidden rounded-xl rounded-tl-sm bg-slate-700/50 px-3 py-2 text-sm"
                        : "min-w-0 overflow-hidden rounded-lg border border-border/50 bg-slate-800/40 px-3 py-1.5 text-xs text-slate-300"
                  }
                >
                  {message.role === "assistant" && <ModelBadge provider={message.provider} model={message.model} />}
                  {message.role === "tool" ? (
                    <span className="break-all">{message.content}</span>
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                      {message.content}
                    </ReactMarkdown>
                  )}
                </div>
              ))}
              {streaming && (
                <div className="mr-6 min-w-0 overflow-hidden rounded-xl rounded-tl-sm bg-slate-700/50 px-3 py-2 text-sm">
                  {streamingModel && (
                    <ModelBadge provider={streamingModel.provider} model={streamingModel.model} />
                  )}
                  {streamedAssistantText && !isThinkingPlaceholderText(streamedAssistantText) ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                      {streamedAssistantText}
                    </ReactMarkdown>
                  ) : (
                    <StreamingThinkingIndicator />
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border/60 bg-slate-900/60 px-3 py-2">
          {selectedSubAgent ? (
            <div className="mb-1 inline-flex items-center gap-2 rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-200">
              对话目标: {selectedSubAgent}
              <button
                className="rounded px-1 hover:bg-cyan-500/20"
                onClick={() => setSelectedSubAgent(null)}
              >
                切回 Meta
              </button>
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <div className="relative flex shrink-0">
              <button
                className="h-9 rounded-l-lg border border-r-0 border-border px-2.5 text-xs text-slate-300 transition hover:bg-slate-800"
                onClick={() => void createNewTopic(true)}
                title="新话题（继承上下文）"
              >
                新话题
              </button>
              <button
                className="h-9 rounded-r-lg border border-border px-1.5 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-cyan-300"
                onClick={() => void createNewTopic(false)}
                title="新话题（不继承上下文）"
              >
                ✕
              </button>
            </div>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
                  e.preventDefault();
                  void createNewTopic(true);
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendChat(input);
                }
              }}
              rows={input.includes("\n") ? 2 : 1}
              placeholder="输入消息，Enter 发送..."
              className="min-h-[36px] flex-1 resize-none rounded-lg border border-border bg-slate-950/80 px-2.5 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50"
            />
            {streaming ? (
              <button
                className="h-9 shrink-0 rounded-lg bg-rose-500 px-3 text-xs font-medium text-white transition hover:bg-rose-400"
                onClick={() => abortRef.current?.abort()}
              >
                中断
              </button>
            ) : (
              <>
                <button
                  className={`h-9 w-9 shrink-0 rounded-lg border border-border text-base transition ${
                    recording ? "bg-rose-500/30 text-rose-200 hover:bg-rose-500/40" : "text-slate-200 hover:bg-slate-800"
                  }`}
                  onClick={onMicClick}
                  title={recording ? "结束语音输入" : "语音输入"}
                >
                  🎙
                </button>
                <button
                  className="h-9 shrink-0 rounded-lg bg-cyan-500 px-3 text-xs font-medium text-black transition hover:bg-cyan-400 disabled:opacity-40"
                  disabled={!input.trim() || !pane.sessionId}
                  onClick={() => void sendChat(input)}
                >
                  发送
                </button>
              </>
            )}
          </div>
          <div className="mt-1.5 flex items-center">
            <PaneModelPicker />
          </div>
        </div>
      </div>

      <SessionHistoryPanel pane={pane} />
    </div>
  );
}
