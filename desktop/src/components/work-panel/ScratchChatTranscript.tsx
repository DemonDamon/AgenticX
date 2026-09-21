/**
 * Scratch-chat transcript: MessageScroller composition + Near message rendering.
 *
 * Author: Damon Li
 */

import { Check, Loader2, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Message } from "../../store";
import { isScratchReplyIncomplete, lastScratchUserMessage } from "../../utils/scratch-chat-runtime";
import {
  assistantVisibleBodyForUi,
  reasoningDuplicatesVisibleBody,
} from "../../utils/assistant-output";
import { CitationMarkdownBody } from "../messages/CitationMarkdownBody";
import { ReasoningBlock } from "../messages/ReasoningBlock";
import { parseReasoningContent } from "../messages/reasoning-parser";
import { renderUserMessageInlineBody } from "../messages/user-message-inline";
import { isWorkspaceReferenceAttachment } from "../../utils/reference-attachment";
import {
  ScratchMessageScroller,
  ScratchMessageScrollerButton,
  ScratchMessageScrollerContent,
  ScratchMessageScrollerItem,
  ScratchMessageScrollerProvider,
  ScratchMessageScrollerViewport,
} from "./ScratchChatScroller";

function lastAssistantId(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "assistant") return messages[i].id;
  }
  return null;
}

function ScratchToolMessage({ message }: { message: Message }) {
  const running = message.toolStatus === "running" || message.toolStatus === "pending";
  const name = String(message.toolName ?? "tool").trim() || "tool";
  const preview = String(message.toolResultPreview ?? "").trim();
  return (
    <div
      data-slot="scratch-tool"
      data-tool-status={message.toolStatus ?? (running ? "running" : "done")}
      className="flex min-w-0 items-center gap-2 text-[12px] leading-5 text-text-faint"
    >
      {running ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={2} />
      ) : (
        <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      )}
      <span className="shrink-0 font-medium text-text-subtle">{name}</span>
      {preview ? <span className="min-w-0 truncate">{preview}</span> : null}
    </div>
  );
}

function ScratchStreamingDots() {
  return (
    <div className="flex items-center gap-1 py-1" aria-hidden>
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-faint" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-faint [animation-delay:120ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-faint [animation-delay:240ms]" />
    </div>
  );
}

function ScratchUserMessage({
  message,
  onRetry,
}: {
  message: Message;
  onRetry?: () => void;
}) {
  const { t } = useTranslation("workspace");
  const referenceAttachments = (message.attachments ?? []).filter((item) =>
    isWorkspaceReferenceAttachment(item),
  );
  return (
    <div className="flex flex-col items-end gap-1" data-align="end">
      <div
        className="agx-im-user-bubble agx-im-body-type min-w-0 max-w-[85%] overflow-hidden border-0 px-3.5 py-2.5 text-[var(--agx-chat-im-body-font-size)] leading-[var(--agx-chat-im-body-line-height)]"
        style={{
          background: "var(--chat-im-user-bg)",
          color: "var(--chat-im-user-text)",
        }}
      >
        <div className="msg-content min-w-0 break-words">
          {renderUserMessageInlineBody(message.content, referenceAttachments)}
        </div>
      </div>
      {onRetry ? (
        <button
          type="button"
          data-slot="scratch-retry"
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] text-text-faint hover:bg-surface-hover hover:text-text-strong"
          aria-label={t("work.scratchRetry")}
          onClick={onRetry}
        >
          <RotateCcw className="h-3 w-3" strokeWidth={2} />
          {t("work.scratchRetry")}
        </button>
      ) : null}
    </div>
  );
}

function ScratchAssistantMessage({
  message,
  streaming,
  failed,
  onRetry,
}: {
  message: Message;
  streaming: boolean;
  failed?: boolean;
  onRetry?: () => void;
}) {
  const { t } = useTranslation("workspace");
  const parsed = parseReasoningContent(message.content);
  const bodyText = assistantVisibleBodyForUi(message.content);
  const hasThinkTag = parsed.hasReasoningTag;
  const reasoningClosed = hasThinkTag && /<\/think>/i.test(String(message.content ?? ""));
  const hasBody = Boolean(bodyText.trim());
  const showReasoning =
    Boolean(parsed.reasoning) && !reasoningDuplicatesVisibleBody(parsed.reasoning, bodyText);
  const showDots = streaming && !hasBody && (!hasThinkTag || reasoningClosed);

  return (
    <div className="flex justify-start" data-align="start">
      <div className="agx-im-body-type msg-content min-w-0 w-full max-w-full break-words text-[var(--agx-chat-im-body-font-size)] leading-[var(--agx-chat-im-body-line-height)] text-text-strong">
        {showReasoning ? (
          <ReasoningBlock
            text={parsed.reasoning}
            streaming={streaming && hasThinkTag && !reasoningClosed}
          />
        ) : null}
        {hasBody ? (
          <div className={showReasoning ? "mt-2" : undefined}>
            <CitationMarkdownBody content={bodyText} isStreaming={streaming} />
          </div>
        ) : null}
        {showDots ? <ScratchStreamingDots /> : null}
        {failed && !streaming && !hasBody ? (
          <div data-slot="scratch-failed" className="flex flex-col items-start gap-1.5 text-[12px] text-text-faint">
            <span>{t("work.scratchEmptyReply")}</span>
            {onRetry ? (
              <button
                type="button"
                data-slot="scratch-retry"
                className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-card px-2 py-1 text-[11px] text-text-subtle hover:bg-surface-hover hover:text-text-strong"
                onClick={onRetry}
              >
                <RotateCcw className="h-3 w-3" strokeWidth={2} />
                {t("work.scratchRetry")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ScratchChatTranscript({
  messages,
  sending = false,
  onRetry,
}: {
  messages: Message[];
  sending?: boolean;
  onRetry?: (userMessageId: string) => void;
}) {
  const streamingId = sending ? lastAssistantId(messages) : null;
  const incomplete = !sending && isScratchReplyIncomplete(messages);
  const retryUserId = incomplete ? lastScratchUserMessage(messages)?.id ?? null : null;
  const failedAssistantId = incomplete ? lastAssistantId(messages) : null;

  return (
    <ScratchMessageScrollerProvider autoScroll defaultScrollPosition="last-anchor" busy={sending}>
      <ScratchMessageScroller>
        <ScratchMessageScrollerViewport>
          <ScratchMessageScrollerContent busy={sending}>
            {messages.map((message) => (
              <ScratchMessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.role === "user"}
              >
                {message.role === "user" ? (
                  <ScratchUserMessage
                    message={message}
                    onRetry={
                      !sending && onRetry
                        ? () => onRetry(message.id)
                        : undefined
                    }
                  />
                ) : message.role === "tool" ? (
                  <ScratchToolMessage message={message} />
                ) : (
                  <ScratchAssistantMessage
                    message={message}
                    streaming={streamingId === message.id}
                    failed={failedAssistantId === message.id}
                    onRetry={
                      failedAssistantId === message.id && retryUserId && onRetry
                        ? () => onRetry(retryUserId)
                        : undefined
                    }
                  />
                )}
              </ScratchMessageScrollerItem>
            ))}
          </ScratchMessageScrollerContent>
        </ScratchMessageScrollerViewport>
        <ScratchMessageScrollerButton />
      </ScratchMessageScroller>
    </ScratchMessageScrollerProvider>
  );
}
