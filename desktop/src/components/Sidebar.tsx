import { useState } from "react";
import { interruptTtsOnUserSpeech } from "../voice/interrupt";
import { speak } from "../voice/tts";

type Message = { role: "user" | "assistant" | "tool"; content: string };

type Props = {
  sessionId: string;
  onStatusChange: (status: "idle" | "listening" | "processing") => void;
  onClose: () => void;
};

export function Sidebar({ sessionId, onStatusChange, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState("");

  const send = async () => {
    if (!input.trim()) return;
    const value = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: value }]);
    onStatusChange("processing");

    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, user_input: value })
    });
    const reader = resp.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) {
      onStatusChange("idle");
      return;
    }
    let full = "";
    while (true) {
      const { value: chunk, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(chunk, { stream: true });
      for (const line of text.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          const payload = JSON.parse(line.slice(6));
          if (payload.type === "token") {
            full += payload.data?.text ?? "";
          }
          if (payload.type === "tool_call") {
            setMessages((prev) => [
              ...prev,
              { role: "tool", content: `调用工具: ${payload.data?.name ?? ""}` }
            ]);
          }
          if (payload.type === "final") {
            full = payload.data?.text ?? full;
            speak(full);
          }
        } catch {
          // ignore parse errors from partial chunks
        }
      }
    }
    setMessages((prev) => [...prev, { role: "assistant", content: full || "(empty)" }]);
    setPreview(full);
    onStatusChange("idle");
  };

  return (
    <div
      style={{
        position: "fixed",
        right: 0,
        top: 0,
        width: 380,
        height: "100vh",
        background: "#121a2d",
        borderLeft: "1px solid #27304a",
        display: "grid",
        gridTemplateRows: "56px 1fr 160px 72px"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px" }}>
        <strong>AgenticX Sidebar</strong>
        <button onClick={onClose}>关闭</button>
      </div>
      <div style={{ padding: 12, overflow: "auto" }}>
        {messages.map((m, idx) => (
          <div key={idx} style={{ marginBottom: 8, opacity: m.role === "tool" ? 0.8 : 1 }}>
            <strong>{m.role}:</strong> {m.content}
          </div>
        ))}
      </div>
      <div style={{ padding: 12, borderTop: "1px solid #27304a", overflow: "auto" }}>
        <strong>代码预览</strong>
        <pre style={{ whiteSpace: "pre-wrap" }}>{preview}</pre>
      </div>
      <div style={{ display: "flex", gap: 8, padding: 12 }}>
        <input
          value={input}
          onChange={(e) => {
            interruptTtsOnUserSpeech(true);
            setInput(e.target.value);
          }}
          placeholder="输入需求..."
          style={{ flex: 1 }}
        />
        <button onClick={send}>发送</button>
      </div>
    </div>
  );
}
