import { useEffect, useMemo, useRef, useState, type KeyboardEventHandler } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAppStore, type Message } from "../store";
import { SubAgentPanel } from "./SubAgentPanel";
import { interruptOnInterimResult, interruptTtsOnUserSpeech } from "../voice/interrupt";
import { speak } from "../voice/tts";
import { startRecording, stopRecording } from "../voice/stt";

type Props = {
  onOpenConfirm: (requestId: string, question: string, diff?: string, agentId?: string) => Promise<boolean>;
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

const markdownComponents: Components = {
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse border border-slate-600 text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-slate-600 bg-slate-800 px-2 py-1 text-left text-slate-200">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border border-slate-700 px-2 py-1 align-top text-slate-300">{children}</td>
  )
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
    <div className="mt-1.5 flex items-center gap-3 text-[11px] text-slate-500">
      <button className="transition hover:text-slate-300" onClick={onCopy} title="复制">
        复制
      </button>
      <button className="transition hover:text-slate-300" onClick={onRetry} title="重试">
        重试
      </button>
      <button className="transition hover:text-cyan-400" onClick={onReanswer} title="换模型回答">
        @换模型
      </button>
    </div>
  );
}

export function ChatView({ onOpenConfirm }: Props) {
  const apiBase = useAppStore((s) => s.apiBase);
  const sessionId = useAppStore((s) => s.sessionId);
  const apiToken = useAppStore((s) => s.apiToken);
  const messages = useAppStore((s) => s.messages);
  const status = useAppStore((s) => s.status);
  const addMessage = useAppStore((s) => s.addMessage);
  const insertMessageAfter = useAppStore((s) => s.insertMessageAfter);
  const setStatus = useAppStore((s) => s.setStatus);
  const openSettings = useAppStore((s) => s.openSettings);
  const activeProvider = useAppStore((s) => s.activeProvider);
  const activeModel = useAppStore((s) => s.activeModel);
  const setActiveModel = useAppStore((s) => s.setActiveModel);
  const subAgents = useAppStore((s) => s.subAgents);
  const selectedSubAgent = useAppStore((s) => s.selectedSubAgent);
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
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamTextRef = useRef("");
  const streamCommittedRef = useRef(false);
  const abortedByUserRef = useRef(false);
  const activeRequestIdRef = useRef(0);
  const modelBtnRef = useRef<HTMLButtonElement | null>(null);

  const canSend = useMemo(() => !!(apiBase && sessionId), [apiBase, sessionId]);
  const visibleMessages = useMemo(
    () => messages.filter((item) => !item.agentId || item.agentId === "meta"),
    [messages]
  );

  const modelLabel = activeModel
    ? (activeProvider ? `${activeProvider} / ${activeModel}` : activeModel)
    : "未选择模型";

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      }
    });
  };

  useEffect(() => {
    scrollToBottom();
  }, [visibleMessages]);

  useEffect(() => {
    if (subAgents.length > 0) {
      setPanelOpen(true);
    }
  }, [subAgents.length]);

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
      updateSubAgent(agentId, { status: "running", currentAction: "中断失败，继续执行" });
      addSubAgentEvent(agentId, { type: "error", content: `中断失败: ${String(err)}` });
    }
  };

  const sendChat = async (
    userText: string,
    opts?: { provider?: string; model?: string; insertAfterId?: string }
  ) => {
    if (!userText || !apiBase || !sessionId) return;
    if (streaming) {
      abortedByUserRef.current = true;
      abortRef.current?.abort();
      const partial = streamTextRef.current.trim();
      if (partial && !streamCommittedRef.current) {
        addMessage("assistant", streamTextRef.current, "meta", activeProvider, activeModel);
        streamCommittedRef.current = true;
      }
      addMessage("tool", "已中断上一轮生成，开始处理新消息", "meta");
      streamTextRef.current = "";
      setStreamedAssistantText("");
      setStreamingModel(null);
      setStatus("idle");
      setStreaming(false);
    }
    const reqProvider = opts?.provider ?? activeProvider;
    const reqModel = opts?.model ?? activeModel;
    const requestId = activeRequestIdRef.current + 1;
    activeRequestIdRef.current = requestId;
    const isCurrentRequest = () => activeRequestIdRef.current === requestId;

    if (!opts?.insertAfterId) {
      setInput("");
      addMessage("user", userText, "meta");
    }

    setStatus("processing");
    setStreaming(true);
    setStreamedAssistantText("");
    setStreamingModel(reqModel ? { provider: reqProvider, model: reqModel } : null);
    streamTextRef.current = "";
    streamCommittedRef.current = false;
    abortedByUserRef.current = false;
    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const body: Record<string, unknown> = { session_id: sessionId, user_input: userText };
      if (reqProvider) body.provider = reqProvider;
      if (reqModel) body.model = reqModel;
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
            if (payload.type === "token") {
              if (eventAgentId !== "meta") { addSubAgentEvent(eventAgentId, { type: "token", content: "生成中..." }); continue; }
              full += payload.data?.text ?? "";
              if (isCurrentRequest()) { streamTextRef.current = full; setStreamedAssistantText(full); }
            }
            if (payload.type === "tool_call") {
              const content = `🔧 ${payload.data?.name ?? "tool"}: ${JSON.stringify(payload.data?.arguments ?? payload.data?.args ?? {}).slice(0, 120)}`;
              if (eventAgentId === "meta") addMessage("tool", content, "meta");
              else { updateSubAgent(eventAgentId, { status: "running", currentAction: `调用工具 ${payload.data?.name ?? "tool"}` }); addSubAgentEvent(eventAgentId, { type: "tool_call", content }); }
            }
            if (payload.type === "confirm_required") {
              if (!isCurrentRequest()) continue;
              const ok = await onOpenConfirm(payload.data?.id ?? "", payload.data?.question ?? "是否确认执行？", payload.data?.context?.diff, eventAgentId);
              if (!isCurrentRequest()) continue;
              await fetch(`${apiBase}/api/confirm`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
                body: JSON.stringify({ session_id: sessionId, request_id: payload.data?.id, approved: ok, agent_id: eventAgentId })
              });
            }
            if (payload.type === "final") {
              if (eventAgentId !== "meta") { updateSubAgent(eventAgentId, { status: "completed", currentAction: "已完成" }); addSubAgentEvent(eventAgentId, { type: "final", content: payload.data?.text ?? "" }); continue; }
              full = payload.data?.text ?? full;
              if (isCurrentRequest()) { streamTextRef.current = full; setStreamedAssistantText(full); }
            }
            if (payload.type === "subagent_started") { const subId = payload.data?.agent_id; if (subId) { addSubAgent({ id: subId, name: payload.data?.name ?? subId, role: payload.data?.role ?? "worker", task: payload.data?.task ?? "" }); addSubAgentEvent(subId, { type: "started", content: "已启动" }); } }
            if (payload.type === "subagent_progress") { const subId = payload.data?.agent_id; if (subId) { updateSubAgent(subId, { currentAction: payload.data?.text ?? "执行中" }); addSubAgentEvent(subId, { type: "progress", content: payload.data?.text ?? "执行中" }); } }
            if (payload.type === "subagent_completed") { const subId = payload.data?.agent_id; if (subId) { updateSubAgent(subId, { status: "completed", currentAction: "已完成" }); addSubAgentEvent(subId, { type: "completed", content: payload.data?.summary ?? "完成" }); } }
            if (payload.type === "subagent_error") { const subId = payload.data?.agent_id; if (subId) { updateSubAgent(subId, { status: payload.data?.status === "cancelled" ? "cancelled" : "failed", currentAction: payload.data?.text ?? "执行异常" }); addSubAgentEvent(subId, { type: "error", content: payload.data?.text ?? "执行异常" }); } }
            if (payload.type === "error") {
              if (eventAgentId === "meta") addMessage("tool", `❌ ${payload.data?.text ?? "未知错误"}`, "meta");
              else { updateSubAgent(eventAgentId, { status: "failed", currentAction: payload.data?.text ?? "执行异常" }); addSubAgentEvent(eventAgentId, { type: "error", content: payload.data?.text ?? "未知错误" }); }
            }
          } catch { /* skip malformed SSE */ }
        }
        scrollToBottom();
      }

      if (isCurrentRequest() && full && !streamCommittedRef.current) {
        if (opts?.insertAfterId) {
          insertMessageAfter(opts.insertAfterId, { role: "assistant", content: full, agentId: "meta", provider: reqProvider, model: reqModel });
        } else {
          addMessage("assistant", full, "meta", reqProvider, reqModel);
        }
        streamCommittedRef.current = true;
        void speak(full);
      }
    } catch (err) {
      if (!isCurrentRequest()) return;
      if (err instanceof DOMException && err.name === "AbortError") {
        if (!abortedByUserRef.current) {
          const partial = streamTextRef.current.trim();
          if (partial && !streamCommittedRef.current) { addMessage("assistant", streamTextRef.current, "meta", reqProvider, reqModel); streamCommittedRef.current = true; }
          addMessage("tool", "已中断当前生成", "meta");
        }
      } else {
        addMessage("tool", `❌ 请求失败: ${String(err)}`, "meta");
      }
    } finally {
      if (!isCurrentRequest()) return;
      abortRef.current = null;
      streamTextRef.current = "";
      setStreamedAssistantText("");
      setStreamingModel(null);
      setStatus("idle");
      setStreaming(false);
      scrollToBottom();
    }
  };

  const send = async (manualInput?: string) => {
    await sendChat((manualInput ?? input).trim());
  };

  const stopStreaming = () => {
    if (!streaming) return;
    abortedByUserRef.current = true;
    abortRef.current?.abort();
    const partial = streamTextRef.current.trim();
    if (partial && !streamCommittedRef.current) { addMessage("assistant", streamTextRef.current, "meta", activeProvider, activeModel); streamCommittedRef.current = true; }
    addMessage("tool", "已中断当前生成", "meta");
    streamTextRef.current = "";
    setStreamedAssistantText("");
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
    void navigator.clipboard.writeText(msg.content);
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
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); }
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
          <span className="text-sm font-medium text-slate-300">AgenticX</span>
          <span className="text-slate-600">·</span>
          <div className="relative">
            <button
              ref={modelBtnRef}
              className="no-drag flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-slate-400 transition hover:bg-slate-700 hover:text-cyan-400"
              onClick={() => setHeaderModelPickerOpen((v) => !v)}
              title="切换模型"
            >
              <span className="max-w-[200px] truncate">{modelLabel}</span>
              <span className="text-[10px]">▾</span>
            </button>
            {headerModelPickerOpen && (
              <div className="absolute left-0 top-full z-40 mt-1">
                <ModelPickerDropdown
                  onSelect={(p, m) => { setActiveModel(p, m); setHeaderModelPickerOpen(false); }}
                  onClose={() => setHeaderModelPickerOpen(false)}
                />
              </div>
            )}
          </div>
          {status !== "idle" && (
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <span className={`inline-block h-2 w-2 rounded-full ${statusDot[status]}`} />
              {statusLabel[status]}
            </span>
          )}
        </div>
        <div className="flex w-20 items-center justify-end">
          {subAgents.length > 0 ? (
            <button className="no-drag mr-2 rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-700 hover:text-white" onClick={() => setPanelOpen((v) => !v)} title="子智能体面板">团队</button>
          ) : null}
          <button className="no-drag rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-700 hover:text-white" onClick={() => openSettings()} title="设置">⚙</button>
        </div>
      </div>

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3">
        {visibleMessages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center text-slate-500">
              <div className="mb-2 text-3xl">🤖</div>
              <div className="text-sm">输入你的需求开始对话</div>
            </div>
          </div>
        )}
        <div className="mx-auto max-w-2xl space-y-3">
          {visibleMessages.map((m) => (
            <div
              key={m.id}
              className={
                m.role === "user"
                  ? "ml-8 rounded-xl rounded-tr-sm bg-cyan-500/20 px-3 py-2 text-sm"
                  : m.role === "assistant"
                    ? "mr-8 rounded-xl rounded-tl-sm bg-slate-700/50 px-3 py-2 text-sm"
                    : "mx-4 rounded-lg border border-border/50 bg-slate-800/40 px-3 py-1.5 text-xs text-slate-400"
              }
            >
              {m.role === "assistant" && <ModelBadge provider={m.provider} model={m.model} />}
              <div className="msg-content break-words">
                {m.role === "tool" ? (
                  <span>{m.content}</span>
                ) : (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {m.content}
                  </ReactMarkdown>
                )}
              </div>
              <MessageActions
                msg={m}
                onCopy={() => onCopyMessage(m)}
                onRetry={() => onRetryMessage(m)}
                onReanswer={() => onReanswerMessage(m.id)}
              />
            </div>
          ))}
          {streaming && (
            <div className="mr-8 rounded-xl rounded-tl-sm bg-slate-700/50 px-3 py-2 text-sm">
              {streamingModel && <ModelBadge provider={streamingModel.provider} model={streamingModel.model} />}
              <div className="msg-content break-words">
                {streamedAssistantText ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {streamedAssistantText}
                  </ReactMarkdown>
                ) : (
                  <span className="inline-flex gap-1 text-slate-400">
                    <span className="animate-bounce">·</span>
                    <span className="animate-bounce" style={{ animationDelay: "0.1s" }}>·</span>
                    <span className="animate-bounce" style={{ animationDelay: "0.2s" }}>·</span>
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-border bg-panel/80 px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => { interruptTtsOnUserSpeech(true); setInput(e.target.value); }}
            onKeyDown={onKeyDown}
            rows={input.split("\n").length > 3 ? 4 : input.includes("\n") ? 2 : 1}
            placeholder={canSend ? "输入需求，Enter 发送（生成中可直接追问）" : "连接中..."}
            disabled={!canSend && !streaming}
            className="min-h-[40px] max-h-[120px] flex-1 resize-none rounded-xl border border-border bg-slate-900/80 px-3 py-2.5 text-sm outline-none transition placeholder:text-slate-500 focus:border-cyan-500/50"
          />
          <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border text-lg transition hover:bg-slate-700" onClick={onMicClick} title="语音输入">🎙</button>
          {streaming ? (
            <div className="flex items-center gap-2">
              <button className="flex h-10 shrink-0 items-center rounded-xl bg-rose-500 px-4 text-sm font-medium text-white transition hover:bg-rose-400" onClick={stopStreaming}>中断</button>
              <button className="flex h-10 shrink-0 items-center rounded-xl bg-cyan-500 px-4 text-sm font-medium text-black transition hover:bg-cyan-400 disabled:opacity-40 disabled:hover:bg-cyan-500" disabled={!canSend || !input.trim()} onClick={() => void send()}>追问</button>
            </div>
          ) : (
            <button className="flex h-10 shrink-0 items-center rounded-xl bg-cyan-500 px-4 text-sm font-medium text-black transition hover:bg-cyan-400 disabled:opacity-40 disabled:hover:bg-cyan-500" disabled={!canSend || !input.trim()} onClick={() => void send()}>发送</button>
          )}
        </div>
      </div>
      </div>
      <SubAgentPanel
        open={panelOpen}
        subAgents={subAgents}
        selectedSubAgent={selectedSubAgent}
        onToggle={() => setPanelOpen((v) => !v)}
        onCancel={onCancelSubAgent}
        onSelect={(id) => setSelectedSubAgent(id)}
      />
      {/* Reanswer model picker */}
      {modelPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[300px] rounded-xl border border-border bg-slate-900 p-3">
            <div className="mb-2 text-sm font-medium text-slate-300">选择模型重新回答</div>
            <ModelPickerDropdown
              onSelect={(p, m) => { onReanswerSelect(p, m); setModelPickerOpen(false); }}
              onClose={() => { setModelPickerOpen(false); setReanswerTarget(null); }}
            />
            <button className="mt-2 w-full rounded-md border border-border py-1.5 text-xs text-slate-400 hover:bg-slate-800" onClick={() => { setModelPickerOpen(false); setReanswerTarget(null); }}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ModelPickerDropdown({ onSelect, onClose }: { onSelect: (p: string, m: string) => void; onClose: () => void }) {
  const settings = useAppStore((s) => s.settings);
  const options = useMemo(() => {
    const result: { provider: string; model: string; label: string }[] = [];
    for (const [provName, entry] of Object.entries(settings.providers)) {
      if (!entry.apiKey) continue;
      if (entry.models.length > 0) {
        for (const m of entry.models) result.push({ provider: provName, model: m, label: `${provName} | ${m}` });
      } else if (entry.model) {
        result.push({ provider: provName, model: entry.model, label: `${provName} | ${entry.model}` });
      }
    }
    return result;
  }, [settings.providers]);

  if (options.length === 0) {
    return <div className="px-3 py-4 text-center text-xs text-slate-500">请先在设置中配置 Provider 和模型</div>;
  }
  return (
    <div className="max-h-[240px] overflow-y-auto">
      {options.map((opt) => (
        <button
          key={`${opt.provider}:${opt.model}`}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-300 transition hover:bg-cyan-500/10 hover:text-white"
          onClick={() => { onSelect(opt.provider, opt.model); onClose(); }}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
          <span className="truncate">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}
