import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../../store";

type Props = {
  message: Message;
  badge?: ReactNode;
};

export function TerminalLine({ message, badge }: Props) {
  const isUser = message.role === "user";
  return (
    <div className="font-mono text-[13px] leading-6">
      <div className="flex items-start gap-2">
        <span
          className="mt-[2px] select-none text-xs"
          style={{ color: isUser ? "var(--chat-terminal-user)" : "var(--chat-terminal-meta)" }}
        >
          {isUser ? ">" : "┃"}
        </span>
        <div
          className="msg-content min-w-0 flex-1 break-words"
          style={{ color: isUser ? "var(--chat-terminal-user)" : "var(--chat-terminal-assistant)" }}
        >
          {badge}
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
