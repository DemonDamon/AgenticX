import type { ReactNode } from "react";
import type { Message } from "../../store";
import { ReferencesCard } from "./ReferencesCard";
import { ReasoningBlock } from "./ReasoningBlock";
import { parseReasoningContent } from "./reasoning-parser";
import { CitationMarkdownBody } from "./CitationMarkdownBody";
import { renderUserMessageInlineBody } from "./user-message-inline";
import { isWorkspaceReferenceAttachment, type FileReferenceOpenRequest } from "../../utils/reference-attachment";

type Props = {
  message: Message;
  badge?: ReactNode;
  onRevealPath?: (path: string) => void;
  onOpenFileReference?: (request: FileReferenceOpenRequest) => void;
};

export function CleanBlock({ message, badge, onRevealPath, onOpenFileReference }: Props) {
  const isUser = message.role === "user";
  const isStreaming = message.id === "__stream__";
  const parsed = !isUser ? parseReasoningContent(message.content) : null;
  const hasThinkTag = parsed?.hasReasoningTag ?? false;
  const reasoningClosed =
    hasThinkTag && /<\/think>/i.test(String(message.content ?? ""));
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
        {!isUser && (message.references?.length ?? 0) > 0 ? (
          <ReferencesCard references={message.references ?? []} searchedQueries={message.searchedQueries} />
        ) : null}
        {!isUser && parsed?.reasoning ? (
          <ReasoningBlock
            text={parsed.reasoning}
            streaming={isStreaming && !reasoningClosed && (hasThinkTag || !hasBody)}
          />
        ) : null}
        {hasBody ? (
          isUser ? (
            renderUserMessageInlineBody(
              bodyText,
              (message.attachments ?? []).filter((a) => isWorkspaceReferenceAttachment(a)),
              onOpenFileReference
            )
          ) : (
            <div className={!isUser && parsed?.reasoning ? "mt-2" : undefined}>
              <CitationMarkdownBody content={bodyText} references={message.references} isStreaming={isStreaming} onRevealPath={onRevealPath} />
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
