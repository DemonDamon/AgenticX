import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../../store";

type Props = {
  message: Message;
  badge?: ReactNode;
};

export function CleanBlock({ message, badge }: Props) {
  const isUser = message.role === "user";
  return (
    <div
      className={`w-full border-b border-border/60 py-2 ${isUser ? "pl-3" : "rounded-md border px-3 py-2"}`}
      style={
        isUser
          ? {
              borderLeft: "3px solid var(--chat-clean-user-accent)",
              background: "var(--chat-clean-user-bg)",
            }
          : {
              background: "var(--chat-clean-assistant-bg)",
              borderColor: "var(--chat-clean-assistant-border)",
            }
      }
    >
      <div className="msg-content break-words">
        {badge}
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
      </div>
    </div>
  );
}
