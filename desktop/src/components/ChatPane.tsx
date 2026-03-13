import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAppStore, type Message } from "../store";
import { SessionHistoryPanel } from "./SessionHistoryPanel";

function PaneModelPicker() {
  const settings = useAppStore((s) => s.settings);
  const activeProvider = useAppStore((s) => s.activeProvider);
  const activeModel = useAppStore((s) => s.activeModel);
  const setActiveModel = useAppStore((s) => s.setActiveModel);
  const [open, setOpen] = useState(false);

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
                    onClick={() => {
                      setActiveModel(opt.provider, opt.model);
                      setOpen(false);
                    }}
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

  if (!pane) return null;

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
            if (payload.type === "token" && eventAgentId === "meta") {
              full += payload.data?.text ?? "";
              setStreamedAssistantText(full);
            }
            if (payload.type === "tool_call") {
              const content = `🔧 ${payload.data?.name ?? "tool"}: ${JSON.stringify(
                payload.data?.arguments ?? payload.data?.args ?? {}
              ).slice(0, 120)}`;
              if (eventAgentId === "meta") addPaneMessage(pane.id, "tool", content, "meta");
              else addSubAgentEvent(eventAgentId, { type: "tool_call", content });
            }
            if (payload.type === "tool_result") {
              const content = `✅ ${payload.data?.name ?? "tool"} 结果: ${String(payload.data?.result ?? "").slice(
                0,
                500
              )}`;
              if (eventAgentId === "meta") addPaneMessage(pane.id, "tool", content, "meta");
              else addSubAgentEvent(eventAgentId, { type: "tool_result", content });
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
              if (subId) {
                addSubAgent({
                  id: subId,
                  name: payload.data?.name ?? subId,
                  role: payload.data?.role ?? "worker",
                  task: payload.data?.task ?? "",
                  sessionId: requestSessionId || undefined,
                });
              }
            }
            if (payload.type === "subagent_progress") {
              const subId = payload.data?.agent_id;
              if (subId) updateSubAgent(subId, { currentAction: payload.data?.text ?? "执行中" });
            }
            if (payload.type === "subagent_checkpoint") {
              const subId = payload.data?.agent_id;
              if (subId) updateSubAgent(subId, { status: "running", currentAction: payload.data?.text ?? "阶段检查点" });
            }
            if (payload.type === "subagent_paused") {
              const subId = payload.data?.agent_id;
              if (subId) updateSubAgent(subId, { status: "failed", currentAction: payload.data?.text ?? "已暂停，等待指令" });
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
              }
            }
            if (payload.type === "subagent_error") {
              const subId = payload.data?.agent_id;
              if (subId) {
                updateSubAgent(subId, {
                  status: payload.data?.status === "cancelled" ? "cancelled" : "failed",
                  currentAction: payload.data?.text ?? "执行异常",
                });
              }
            }
            if (payload.type === "final") {
              if (eventAgentId === "meta") {
                full = payload.data?.text ?? full;
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

      if (full.trim()) {
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
                  {streamedAssistantText ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                      {streamedAssistantText}
                    </ReactMarkdown>
                  ) : (
                    <span className="text-slate-500">思考中...</span>
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
              <button
                className="h-9 shrink-0 rounded-lg bg-cyan-500 px-3 text-xs font-medium text-black transition hover:bg-cyan-400 disabled:opacity-40"
                disabled={!input.trim() || !pane.sessionId}
                onClick={() => void sendChat(input)}
              >
                发送
              </button>
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
