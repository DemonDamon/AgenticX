import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Message } from "../../store";
import { ReasoningBlock } from "./ReasoningBlock";
import { parseReasoningContent } from "./reasoning-parser";
import {
  chatMarkdownComponents,
  chatRehypePlugins,
  chatRemarkPlugins,
  normalizeChatMarkdownContent,
} from "./markdown-components";

type Props = {
  message: Message;
  badge?: ReactNode;
};

export function CleanBlock({ message, badge }: Props) {
  const isUser = message.role === "user";
  const isStreaming = message.id === "__stream__";
  const parsed = !isUser ? parseReasoningContent(message.content) : null;
  const hasThinkTag = parsed?.hasReasoningTag ?? false;
  const bodyText = !isUser && hasThinkTag ? (parsed?.response ?? "") : message.content;
  const hasBody = !!bodyText?.trim();
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
        {!isUser && isStreaming && (hasThinkTag || !hasBody) ? (
          <ReasoningBlock text={parsed?.reasoning ?? ""} streaming />
        ) : !isUser && !isStreaming && parsed?.reasoning ? (
          <ReasoningBlock text={parsed.reasoning} />
        ) : null}
        {hasBody ? (
          <ReactMarkdown
            remarkPlugins={chatRemarkPlugins}
            rehypePlugins={chatRehypePlugins}
            components={chatMarkdownComponents}
          >
            {normalizeChatMarkdownContent(bodyText)}
          </ReactMarkdown>
        ) : null}
      </div>
    </div>
  );
}
