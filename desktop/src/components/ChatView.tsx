import { useEffect, useMemo, useRef, useState, type KeyboardEventHandler } from "react";
import ReactMarkdown from "react-markdown";
import { useAppStore } from "../store";
import { interruptOnInterimResult, interruptTtsOnUserSpeech } from "../voice/interrupt";
import { speak } from "../voice/tts";
import { startRecording, stopRecording } from "../voice/stt";

type Props = {
  onOpenConfirm: (requestId: string, question: string, diff?: string) => Promise<boolean>;
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

export function ChatView({ onOpenConfirm }: Props) {
  const apiBase = useAppStore((s) => s.apiBase);
  const sessionId = useAppStore((s) => s.sessionId);
  const apiToken = useAppStore((s) => s.apiToken);
  const messages = useAppStore((s) => s.messages);
  const status = useAppStore((s) => s.status);
  const addMessage = useAppStore((s) => s.addMessage);
  const setStatus = useAppStore((s) => s.setStatus);
  const openSettings = useAppStore((s) => s.openSettings);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const canSend = useMemo(() => !!(apiBase && sessionId && !streaming), [apiBase, sessionId, streaming]);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      }
    });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const send = async (manualInput?: string) => {
    const value = (manualInput ?? input).trim();
    if (!value || !apiBase || !sessionId || streaming) return;
    setInput("");
    addMessage("user", value);
    setStatus("processing");
    setStreaming(true);

    try {
      const resp = await fetch(`${apiBase}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agx-desktop-token": apiToken
        },
        body: JSON.stringify({ session_id: sessionId, user_input: value })
      });
      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) {
        setStatus("idle");
        setStreaming(false);
        return;
      }

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
            if (payload.type === "token") {
              full += payload.data?.text ?? "";
            }
            if (payload.type === "tool_call") {
              addMessage("tool", `🔧 ${payload.data?.name ?? "tool"}: ${JSON.stringify(payload.data?.args ?? {}).slice(0, 120)}`);
            }
            if (payload.type === "confirm_required") {
              const ok = await onOpenConfirm(
                payload.data?.id ?? "",
                payload.data?.question ?? "是否确认执行？",
                payload.data?.context?.diff
              );
              await fetch(`${apiBase}/api/confirm`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-agx-desktop-token": apiToken
                },
                body: JSON.stringify({
                  session_id: sessionId,
                  request_id: payload.data?.id,
                  approved: ok
                })
              });
            }
            if (payload.type === "final") {
              full = payload.data?.text ?? full;
            }
            if (payload.type === "error") {
              addMessage("tool", `❌ ${payload.data?.text ?? "未知错误"}`);
            }
          } catch {
            // skip malformed SSE frames
          }
        }
        scrollToBottom();
      }

      if (full) {
        addMessage("assistant", full);
        void speak(full);
      }
    } catch (err) {
      addMessage("tool", `❌ 请求失败: ${String(err)}`);
    } finally {
      setStatus("idle");
      setStreaming(false);
      scrollToBottom();
    }
  };

  const onKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  const onMicClick = () => {
    setStatus("listening");
    void startRecording(
      async (text) => {
        setStatus("processing");
        await send(text);
      },
      (interim) => interruptOnInterimResult(interim)
    );
    window.setTimeout(() => {
      stopRecording();
    }, 5000);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Title bar - draggable */}
      <div className="drag-region flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex w-20 items-center" />
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-300">AgenticX</span>
          {status !== "idle" && (
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <span className={`inline-block h-2 w-2 rounded-full ${statusDot[status]}`} />
              {statusLabel[status]}
            </span>
          )}
        </div>
        <div className="flex w-20 items-center justify-end">
          <button
            className="no-drag rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-700 hover:text-white"
            onClick={() => openSettings()}
            title="设置"
          >
            ⚙
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center text-slate-500">
              <div className="mb-2 text-3xl">🤖</div>
              <div className="text-sm">输入你的需求开始对话</div>
            </div>
          </div>
        )}
        <div className="mx-auto max-w-2xl space-y-3">
          {messages.map((m) => (
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
              <div className="msg-content break-words">
                {m.role === "tool" ? (
                  <span>{m.content}</span>
                ) : (
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                )}
              </div>
            </div>
          ))}
          {streaming && (
            <div className="mr-8 rounded-xl rounded-tl-sm bg-slate-700/50 px-3 py-2 text-sm">
              <span className="inline-flex gap-1 text-slate-400">
                <span className="animate-bounce">·</span>
                <span className="animate-bounce" style={{ animationDelay: "0.1s" }}>·</span>
                <span className="animate-bounce" style={{ animationDelay: "0.2s" }}>·</span>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-border bg-panel/80 px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => {
              interruptTtsOnUserSpeech(true);
              setInput(e.target.value);
            }}
            onKeyDown={onKeyDown}
            rows={input.split("\n").length > 3 ? 4 : input.includes("\n") ? 2 : 1}
            placeholder={canSend ? "输入需求，Enter 发送，Shift+Enter 换行" : streaming ? "等待回复中..." : "连接中..."}
            disabled={!canSend && !streaming}
            className="min-h-[40px] max-h-[120px] flex-1 resize-none rounded-xl border border-border bg-slate-900/80 px-3 py-2.5 text-sm outline-none transition placeholder:text-slate-500 focus:border-cyan-500/50"
          />
          <button
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border text-lg transition hover:bg-slate-700"
            onClick={onMicClick}
            title="语音输入"
          >
            🎙
          </button>
          <button
            className="flex h-10 shrink-0 items-center rounded-xl bg-cyan-500 px-4 text-sm font-medium text-black transition hover:bg-cyan-400 disabled:opacity-40 disabled:hover:bg-cyan-500"
            disabled={!canSend || !input.trim()}
            onClick={() => void send()}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
