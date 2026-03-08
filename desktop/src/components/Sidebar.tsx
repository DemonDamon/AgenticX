import { useMemo, useRef, useState, type KeyboardEventHandler } from "react";
import ReactMarkdown from "react-markdown";

import { CodePreview } from "./CodePreview";
import { useAppStore } from "../store";
import { interruptOnInterimResult, interruptTtsOnUserSpeech } from "../voice/interrupt";
import { speak } from "../voice/tts";
import { startRecording, stopRecording } from "../voice/stt";

type Props = {
  onClose: () => void;
  onOpenConfirm: (requestId: string, question: string, diff?: string) => Promise<boolean>;
};

export function Sidebar({ onClose, onOpenConfirm }: Props) {
  const apiBase = useAppStore((s) => s.apiBase);
  const sessionId = useAppStore((s) => s.sessionId);
  const apiToken = useAppStore((s) => s.apiToken);
  const messages = useAppStore((s) => s.messages);
  const addMessage = useAppStore((s) => s.addMessage);
  const setStatus = useAppStore((s) => s.setStatus);
  const codePreview = useAppStore((s) => s.codePreview);
  const setCodePreview = useAppStore((s) => s.setCodePreview);
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const canSend = useMemo(() => apiBase && sessionId, [apiBase, sessionId]);

  const scrollToBottom = () => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  };

  const send = async (manualInput?: string) => {
    const value = (manualInput ?? input).trim();
    if (!value || !canSend) return;
    setInput("");
    addMessage("user", value);
    setStatus("processing");

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
        const payload = JSON.parse(line.slice(6));
        if (payload.type === "token") {
          full += payload.data?.text ?? "";
        }
        if (payload.type === "tool_call") {
          addMessage("tool", `调用工具: ${payload.data?.name ?? ""}`);
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
      }
      scrollToBottom();
    }

    addMessage("assistant", full || "(empty)");
    setCodePreview(full);
    speak(full || "");
    setStatus("idle");
    scrollToBottom();
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
    }, 3500);
  };

  return (
    <div className="fixed right-0 top-0 z-20 grid h-screen w-[420px] grid-rows-[56px_1fr_180px_96px] border-l border-border bg-panel">
      <div className="flex items-center justify-between px-4">
        <strong>AgenticX Sidebar</strong>
        <button className="rounded-md border border-border px-2 py-1 text-xs" onClick={onClose}>
          关闭
        </button>
      </div>

      <div ref={listRef} className="space-y-3 overflow-auto px-3 py-2">
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "user"
                ? "ml-14 rounded-lg bg-cyan-500/25 p-2 text-right"
                : m.role === "assistant"
                  ? "mr-14 rounded-lg bg-slate-700/60 p-2"
                  : "mx-8 rounded-lg border border-border bg-slate-800/60 p-2 text-xs"
            }
          >
            <ReactMarkdown>{m.content}</ReactMarkdown>
          </div>
        ))}
      </div>

      <div className="p-3">
        <CodePreview code={codePreview} />
      </div>

      <div className="grid grid-cols-[1fr_auto_auto] gap-2 p-3">
        <textarea
          value={input}
          onChange={(e) => {
            interruptTtsOnUserSpeech(true);
            setInput(e.target.value);
          }}
          onKeyDown={onKeyDown}
          placeholder={canSend ? "输入需求，Enter发送，Shift+Enter换行" : "等待会话初始化..."}
          className="h-20 resize-none rounded-md border border-border bg-slate-900 p-2 text-sm outline-none"
        />
        <button className="rounded-md border border-border px-2 text-xs" onClick={onMicClick}>
          🎙
        </button>
        <button
          className="rounded-md bg-cyan-400 px-3 text-sm text-black disabled:opacity-50"
          disabled={!canSend}
          onClick={() => void send()}
        >
          发送
        </button>
      </div>
    </div>
  );
}
