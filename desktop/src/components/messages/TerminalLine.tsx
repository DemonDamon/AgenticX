import type { ReactNode } from "react";
import type { Message } from "../../store";
import { ReferencesCard } from "./ReferencesCard";
import { ReasoningBlock } from "./ReasoningBlock";
import { parseReasoningContent } from "./reasoning-parser";
import { CitationMarkdownBody } from "./CitationMarkdownBody";
import { renderUserMessageInlineBody } from "./user-message-inline";

type Props = {
  message: Message;
  badge?: ReactNode;
};

export function TerminalLine({ message, badge }: Props) {
  const isUser = message.role === "user";
  const isStreaming = message.id === "__stream__";
  const parsed = !isUser ? parseReasoningContent(message.content) : null;
  const hasThinkTag = parsed?.hasReasoningTag ?? false;
  const bodyText = !isUser && hasThinkTag ? (parsed?.response ?? "") : message.content;
  const hasBody = !!bodyText?.trim();
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
          {!isUser && (message.references?.length ?? 0) > 0 ? (
            <ReferencesCard references={message.references ?? []} searchedQueries={message.searchedQueries} />
          ) : null}
          {!isUser && isStreaming && (hasThinkTag || !hasBody) ? (
            <ReasoningBlock text={parsed?.reasoning ?? ""} streaming />
          ) : !isUser && !isStreaming && parsed?.reasoning ? (
            <ReasoningBlock text={parsed.reasoning} />
          ) : null}
          {hasBody ? (
            isUser ? (
              renderUserMessageInlineBody(
                bodyText,
                (message.attachments ?? []).filter((a) => !!a.referenceToken)
              )
            ) : (
              <CitationMarkdownBody content={bodyText} references={message.references} isStreaming={isStreaming} />
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
