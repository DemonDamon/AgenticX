/**
 * Scratch-chat transcript: MessageScroller composition + Near message rendering.
 *
 * Author: Damon Li
 */

import { ArrowUp, Check, Loader2, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Message } from "../../store";
import { messagePlainTextForClipboard } from "../../utils/markdown-copy-format";
import {
  isScratchReplyIncomplete,
  lastScratchUserMessage,
  precedingScratchUserId,
} from "../../utils/scratch-chat-runtime";
import {
  assistantVisibleBodyForUi,
  reasoningDuplicatesVisibleBody,
} from "../../utils/assistant-output";
import { CitationMarkdownBody } from "../messages/CitationMarkdownBody";
import { ReasoningBlock } from "../messages/ReasoningBlock";
import { parseReasoningContent } from "../messages/reasoning-parser";
import { renderUserMessageInlineBody } from "../messages/user-message-inline";
import { isWorkspaceReferenceAttachment } from "../../utils/reference-attachment";
import { ScratchMessageActions } from "./ScratchMessageActions";
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

function pickQuoteText(fallback: string): string {
  const selected = typeof window !== "undefined" ? window.getSelection()?.toString().trim() : "";
  return selected || fallback;
}

async function writeClipboard(text: string): Promise<void> {
  const next = text.trim();
  if (!next) return;
  try {
    await navigator.clipboard.writeText(next);
  } catch {
    // ignore clipboard failures
  }
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

function ScratchUserEdit({
  value,
  onCancel,
  onSubmit,
}: {
  value: string;
  onCancel: () => void;
  onSubmit: (text: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <div className="flex w-full max-w-[min(36rem,100%)] items-end gap-2" data-slot="scratch-edit">
      <button
        type="button"
        className="mb-1 p-1.5 text-text-faint transition hover:text-text-strong"
        onClick={onCancel}
      >
        <X size={16} />
      </button>
      <div className="flex flex-1 items-end rounded-xl border border-[rgb(var(--theme-color-rgb,6,182,212))] bg-surface-card p-1">
        <textarea
          value={draft}
          rows={1}
          className="w-full resize-none bg-transparent px-2 py-1.5 text-[var(--agx-chat-im-body-font-size)] text-text-strong outline-none"
          onChange={(event) => {
            setDraft(event.target.value);
            event.target.style.height = "auto";
            event.target.style.height = `${Math.min(event.target.scrollHeight, 200)}px`;
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.key === "Process" || event.keyCode === 229) {
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              const text = draft.trim();
              if (text) onSubmit(text);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
        />
        <button
          type="button"
          className="m-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--theme-color-rgb,6,182,212))] text-white transition hover:opacity-90 disabled:opacity-50"
          disabled={!draft.trim()}
          onClick={() => {
            const text = draft.trim();
            if (text) onSubmit(text);
          }}
        >
          <ArrowUp size={16} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

function ScratchUserMessage({
  message,
  selected,
  canAct,
  editing,
  onCopy,
  onQuote,
  onEdit,
  onRetry,
  onSelect,
  onCancelEdit,
  onSubmitEdit,
}: {
  message: Message;
  selected: boolean;
  canAct: boolean;
  editing: boolean;
  onCopy: () => void;
  onQuote: () => void;
  onEdit: () => void;
  onRetry?: () => void;
  onSelect: () => void;
  onCancelEdit: () => void;
  onSubmitEdit: (text: string) => void;
}) {
  const { t } = useTranslation("workspace");
  const referenceAttachments = (message.attachments ?? []).filter((item) =>
    isWorkspaceReferenceAttachment(item),
  );
  const quote = String(message.quotedContent ?? "").trim();
  if (editing) {
    return (
      <div className="flex justify-end" data-align="end">
        <ScratchUserEdit value={message.content} onCancel={onCancelEdit} onSubmit={onSubmitEdit} />
      </div>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1" data-align="end" data-selected={selected ? "true" : undefined}>
      {quote ? (
        <div
          data-slot="scratch-message-quote"
          className="max-w-[min(78%,36rem)] rounded-xl border border-border/70 bg-surface-card px-3 py-2"
        >
          <div className="text-[10px] leading-4 text-text-faint">{t("work.scratchQuote")}</div>
          <div className="line-clamp-3 text-[12px] leading-relaxed text-text-subtle">{quote}</div>
        </div>
      ) : null}
      <div
        className="agx-im-user-bubble agx-im-body-type min-w-0 max-w-[min(78%,36rem)] overflow-hidden border-0 px-3.5 py-2.5 text-[var(--agx-chat-im-body-font-size)] leading-[var(--agx-chat-im-body-line-height)]"
        style={{
          background: "var(--chat-im-user-bg)",
          color: "var(--chat-im-user-text)",
        }}
      >
        <div className="msg-content min-w-0 break-words">
          {renderUserMessageInlineBody(message.content, referenceAttachments)}
        </div>
      </div>
      <ScratchMessageActions
        align="end"
        selected={selected}
        canEdit={canAct}
        canRetry={canAct && Boolean(onRetry)}
        onCopy={onCopy}
        onQuote={onQuote}
        onEdit={canAct ? onEdit : undefined}
        onRetry={canAct ? onRetry : undefined}
        onSelect={onSelect}
      />
    </div>
  );
}

function ScratchAssistantMessage({
  message,
  streaming,
  failed,
  selected,
  canRetry,
  onCopy,
  onQuote,
  onRetry,
  onSelect,
}: {
  message: Message;
  streaming: boolean;
  failed?: boolean;
  selected: boolean;
  canRetry: boolean;
  onCopy: () => void;
  onQuote: () => void;
  onRetry?: () => void;
  onSelect: () => void;
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
  const showActions = !streaming;

  return (
    <div className="flex justify-start" data-align="start" data-selected={selected ? "true" : undefined}>
      <div className="agx-im-body-type min-w-0 w-full max-w-full break-words text-[var(--agx-chat-im-body-font-size)] leading-[var(--agx-chat-im-body-line-height)] text-text-strong">
        {showReasoning ? (
          <ReasoningBlock
            text={parsed.reasoning}
            streaming={streaming && hasThinkTag && !reasoningClosed}
          />
        ) : null}
        {hasBody ? (
          <div
            data-slot="scratch-assistant-body"
            className={`scratch-md msg-content min-w-0 overflow-x-auto ${showReasoning ? "mt-2" : ""}`}
          >
            <CitationMarkdownBody content={bodyText} isStreaming={streaming} />
          </div>
        ) : null}
        {showDots ? <ScratchStreamingDots /> : null}
        {failed && !streaming && !hasBody ? (
          <div data-slot="scratch-failed" className="text-[12px] text-text-faint">
            {t("work.scratchEmptyReply")}
          </div>
        ) : null}
        {showActions ? (
          <ScratchMessageActions
            align="start"
            selected={selected}
            canRetry={canRetry}
            onCopy={onCopy}
            onQuote={onQuote}
            onRetry={canRetry ? onRetry : undefined}
            onSelect={onSelect}
          />
        ) : null}
      </div>
    </div>
  );
}

export function ScratchChatTranscript({
  messages,
  sending = false,
  onRetry,
  onQuote,
}: {
  messages: Message[];
  sending?: boolean;
  onRetry?: (userMessageId: string, editText?: string) => void;
  onQuote?: (text: string) => void;
}) {
  const { t } = useTranslation("workspace");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const streamingId = sending ? lastAssistantId(messages) : null;
  const incomplete = !sending && isScratchReplyIncomplete(messages);
  const failedAssistantId = incomplete ? lastAssistantId(messages) : null;
  const selectedSet = new Set(selectedIds);

  const toggleSelect = (id: string) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const copyMessage = (message: Message) => {
    void writeClipboard(messagePlainTextForClipboard(message));
  };

  const quoteMessage = (message: Message) => {
    onQuote?.(pickQuoteText(messagePlainTextForClipboard(message)));
  };

  const retryFrom = (message: Message) => {
    const userId = precedingScratchUserId(messages, message.id);
    if (userId && onRetry) onRetry(userId);
  };

  const copySelected = () => {
    const parts = messages
      .filter((item) => selectedSet.has(item.id) && item.role !== "tool")
      .map((item) => {
        const role =
          item.role === "user" ? t("work.scratchCopyRoleUser") : t("work.scratchCopyRoleAssistant");
        return `${role}\n${messagePlainTextForClipboard(item)}`;
      });
    void writeClipboard(parts.join("\n\n"));
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {selectedIds.length > 0 ? (
        <div
          data-slot="scratch-select-bar"
          className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-2 text-[12px] text-text-muted"
        >
          <span className="min-w-0 flex-1">{t("work.scratchSelected", { count: selectedIds.length })}</span>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-text-strong transition hover:bg-surface-hover"
            onClick={() => void copySelected()}
          >
            {t("work.scratchCopySelected")}
          </button>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-text-strong transition hover:bg-surface-hover"
            onClick={() => setSelectedIds([])}
          >
            {t("work.scratchCancelSelect")}
          </button>
        </div>
      ) : null}
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
                      selected={selectedSet.has(message.id)}
                      canAct={!sending && Boolean(onRetry)}
                      editing={editingId === message.id}
                      onCopy={() => copyMessage(message)}
                      onQuote={() => quoteMessage(message)}
                      onEdit={() => setEditingId(message.id)}
                      onRetry={!sending && onRetry ? () => onRetry(message.id) : undefined}
                      onSelect={() => toggleSelect(message.id)}
                      onCancelEdit={() => setEditingId(null)}
                      onSubmitEdit={(text) => {
                        setEditingId(null);
                        onRetry?.(message.id, text);
                      }}
                    />
                  ) : message.role === "tool" ? (
                    <ScratchToolMessage message={message} />
                  ) : (
                    <ScratchAssistantMessage
                      message={message}
                      streaming={streamingId === message.id}
                      failed={failedAssistantId === message.id}
                      selected={selectedSet.has(message.id)}
                      canRetry={!sending && Boolean(onRetry) && Boolean(precedingScratchUserId(messages, message.id))}
                      onCopy={() => copyMessage(message)}
                      onQuote={() => quoteMessage(message)}
                      onRetry={!sending && onRetry ? () => retryFrom(message) : undefined}
                      onSelect={() => toggleSelect(message.id)}
                    />
                  )}
                </ScratchMessageScrollerItem>
              ))}
            </ScratchMessageScrollerContent>
          </ScratchMessageScrollerViewport>
          <ScratchMessageScrollerButton />
        </ScratchMessageScroller>
      </ScratchMessageScrollerProvider>
    </div>
  );
}
