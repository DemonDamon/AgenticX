import type { CSSProperties, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../../store";
import { AttachmentCard } from "./AttachmentCard";

type Props = {
  message: Message;
  badge?: ReactNode;
  assistantName?: string;
  assistantAvatarUrl?: string;
  userName?: string;
};

function Avatar({ label, imageUrl }: { label: string; imageUrl?: string }) {
  const char = label.slice(0, 1) || "?";
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={label}
        className="h-8 w-8 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
      style={{
        background: "var(--chat-im-avatar-bg)",
        color: "var(--text-strong)",
      }}
    >
      {char}
    </div>
  );
}

export function ImBubble({ message, badge, assistantName, assistantAvatarUrl, userName }: Props) {
  const isUser = message.role === "user";
  const displayName = isUser ? (userName || "我") : (assistantName || "AI");
  const avatarUrl = isUser ? undefined : assistantAvatarUrl;
  const bubbleStyle: CSSProperties = isUser
    ? {
        background: "var(--chat-im-user-bg)",
        borderColor: "var(--chat-im-user-border)",
        color: "var(--chat-im-user-text)",
      }
    : {
        background: "var(--chat-im-assistant-bg)",
        borderColor: "var(--chat-im-assistant-border)",
        color: "var(--chat-im-assistant-text)",
      };

  return (
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div className="flex shrink-0 flex-col items-center gap-0.5 pt-0.5">
        <Avatar label={displayName} imageUrl={avatarUrl} />
      </div>
      <div className={`flex min-w-0 max-w-[80%] flex-col ${isUser ? "items-end" : "items-start"}`}>
        <span className="mb-0.5 px-1 text-[11px] text-text-faint">{displayName}</span>
        <div
          className={`relative min-w-0 rounded-xl border px-3 py-2 text-sm ${isUser ? "rounded-tr-[4px]" : "rounded-tl-[4px]"}`}
          style={bubbleStyle}
        >
          {isUser && message.attachments && message.attachments.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {message.attachments.map((attachment) => (
                <AttachmentCard
                  key={`${attachment.name}:${attachment.size}:${attachment.mimeType}`}
                  attachment={attachment}
                />
              ))}
            </div>
          ) : null}
          <div className="msg-content break-words">
            {badge}
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}
