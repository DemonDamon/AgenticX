/**
 * Scratch-chat transcript: MessageScroller composition + Near message rendering.
 *
 * Author: Damon Li
 */

import { ArrowUp, ChevronDown, ChevronRight, Globe, Search, Terminal, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Message, PendingConfirm } from "../../store";
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
import { parseReasoningContent } from "../messages/reasoning-parser";
import { renderUserMessageInlineBody } from "../messages/user-message-inline";
import { isWorkspaceReferenceAttachment } from "../../utils/reference-attachment";
import { ScratchMatrixOrb, ScratchWaveText } from "./ScratchMatrixOrb";
import { ScratchMessageActions } from "./ScratchMessageActions";
import {
  ScratchMessageScroller,
  ScratchMessageScrollerButton,
  ScratchMessageScrollerContent,
  ScratchMessageScrollerItem,
  ScratchMessageScrollerProvider,
  ScratchMessageScrollerViewport,
} from "./ScratchChatScroller";

const SCRATCH_RAIL_CLASS =
  "flex h-3.5 w-3.5 min-w-3.5 max-w-3.5 shrink-0 items-center justify-center";

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

type ScratchTurn = { tools: Message[]; assistant: Message | null };

function groupScratchTurns(messages: Message[]): Array<{ kind: "user"; message: Message } | { kind: "turn"; turn: ScratchTurn }> {
  const blocks: Array<{ kind: "user"; message: Message } | { kind: "turn"; turn: ScratchTurn }> = [];
  let index = 0;
  while (index < messages.length) {
    const message = messages[index];
    if (message.role === "user") {
      blocks.push({ kind: "user", message });
      index += 1;
      continue;
    }
    const tools: Message[] = [];
    while (index < messages.length && messages[index]?.role === "tool") {
      tools.push(messages[index]);
      index += 1;
    }
    let assistant: Message | null = null;
    if (index < messages.length && messages[index]?.role === "assistant") {
      assistant = messages[index];
      index += 1;
    }
    if (tools.length > 0 || assistant) blocks.push({ kind: "turn", turn: { tools, assistant } });
    else index += 1;
  }
  return blocks;
}

function scratchToolKind(name: string): "search" | "fetch" | "command" | "call" {
  const normalized = name.toLowerCase();
  if (normalized.includes("search")) return "search";
  if (normalized.includes("fetch") || normalized.includes("http") || normalized === "liteparse") return "fetch";
  if (
    normalized.includes("bash") ||
    normalized.includes("shell") ||
    normalized.includes("command") ||
    normalized === "python"
  ) {
    return "command";
  }
  return "call";
}

function scratchHostLabel(message: Message): string {
  const args = message.toolArgs ?? {};
  const raw = String(args.url ?? args.uri ?? args.href ?? args.link ?? "").trim();
  if (raw) {
    try {
      return new URL(raw).host;
    } catch {
      return raw.replace(/^https?:\/\//, "").slice(0, 28);
    }
  }
  const found = String(message.content ?? message.toolResultPreview ?? "").match(/https?:\/\/([^/\s]+)/);
  return found?.[1] ?? "";
}

function scratchCallLabel(message: Message): string {
  const args = message.toolArgs ?? {};
  return String(args.tool ?? args.name ?? args.server ?? message.toolName ?? "").trim();
}

function scratchSearchHasNoResults(message: Message): boolean {
  const text = `${message.toolResultPreview ?? ""} ${message.content ?? ""}`.toLowerCase();
  return /no results|无结果|未找到|0 results|^\s*\[\s*\]\s*$/.test(text);
}

function ScratchToolLine({
  message,
  onResolveConfirm,
}: {
  message: Message;
  onResolveConfirm?: (confirm: PendingConfirm, approved: boolean) => void;
}) {
  const { t } = useTranslation("workspace");
  const running = message.toolStatus === "running" || message.toolStatus === "pending";
  const name = String(message.toolName ?? "tool").trim() || "tool";
  const kind = scratchToolKind(name);
  const host = kind === "fetch" ? scratchHostLabel(message) : "";
  const call = kind === "call" ? scratchCallLabel(message) : "";
  let verb = running ? t("work.scratchCalling") : t("work.scratchCalled");
  if (kind === "search") {
    verb = running
      ? t("work.scratchSearching")
      : scratchSearchHasNoResults(message)
        ? t("work.scratchSearchedNone")
        : t("work.scratchSearched");
  } else if (kind === "fetch") {
    verb = running ? t("work.scratchFetching") : t("work.scratchFetched");
  } else if (kind === "command") {
    verb = running ? t("work.scratchRunningCommand") : t("work.scratchRanCommand");
  }
  const pill = host || (kind === "call" ? call : "");
  const waiting = Boolean(message.inlineConfirm);
  const Icon = kind === "search" ? Search : kind === "fetch" ? Globe : kind === "command" ? Terminal : Search;
  const label = waiting ? t("work.scratchAwaitingConfirm") : verb;
  return (
    <div
      data-slot="scratch-tool"
      data-tool-name={name}
      data-tool-status={waiting ? "awaiting_confirm" : (message.toolStatus ?? (running ? "running" : "done"))}
      className="py-0.5 text-[13px] leading-6 text-text-muted"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className={SCRATCH_RAIL_CLASS}>
          <Icon className="h-3.5 w-3.5 text-text-faint" strokeWidth={1.8} />
        </span>
        {running || waiting ? <ScratchWaveText text={label} /> : <span className="shrink-0">{label}</span>}
        {!waiting && pill ? (
          <span className="min-w-0 truncate rounded-full bg-surface-card-strong px-2 py-0.5 text-[11px] leading-4 text-text-subtle">
            {pill}
          </span>
        ) : null}
      </div>
      {waiting && message.inlineConfirm ? (
        <div data-slot="scratch-confirm" className="mt-1 flex flex-col gap-1.5 pl-[22px]">
          <div className="text-[12px] leading-5 text-text-subtle">{message.inlineConfirm.question}</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-full border border-border bg-surface-card-strong px-3 py-1 text-[12px] text-text-strong"
              onClick={() => onResolveConfirm?.(message.inlineConfirm!, true)}
            >
              {t("work.scratchAllow")}
            </button>
            <button
              type="button"
              className="rounded-full border border-border px-3 py-1 text-[12px] text-text-strong"
              onClick={() => onResolveConfirm?.(message.inlineConfirm!, false)}
            >
              {t("work.scratchDeny")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ScratchThoughtLine({ text, streaming }: { text: string; streaming: boolean }) {
  const { t } = useTranslation("workspace");
  const [open, setOpen] = useState(streaming);
  useEffect(() => {
    if (streaming) setOpen(true);
  }, [streaming]);
  const body = text.trim();
  if (!body && !streaming) return null;
  return (
    <div data-slot="scratch-thought">
      <button
        type="button"
        className="inline-flex items-center gap-1 py-0.5 text-[13px] leading-6 text-text-muted"
        onClick={() => setOpen((value) => !value)}
      >
        <span>{streaming ? t("work.scratchThinking") : t("work.scratchThought")}</span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} />
        )}
      </button>
      {open && body ? (
        <div className="pb-1 pl-4 text-[13px] leading-6 text-text-faint">{body}</div>
      ) : null}
    </div>
  );
}

function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live]);
  return now;
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

function scratchWorkedSeconds(turn: ScratchTurn, live: boolean, now: number): number {
  const stamped = Number(turn.assistant?.metadata?.scratchWorkedSeconds);
  if (!live && Number.isFinite(stamped) && stamped >= 1) return Math.round(stamped);
  const started = turn.assistant?.timestamp ?? turn.tools[0]?.timestamp ?? 0;
  if (!live || !started) return 0;
  return Math.max(1, Math.round((now - started) / 1000));
}

function ScratchTurnMessage({
  turn,
  streaming,
  failed,
  selected,
  canRetry,
  onCopy,
  onQuote,
  onRetry,
  onSelect,
  onResolveConfirm,
}: {
  turn: ScratchTurn;
  streaming: boolean;
  failed?: boolean;
  selected: boolean;
  canRetry: boolean;
  onCopy: () => void;
  onQuote: () => void;
  onRetry?: () => void;
  onSelect: () => void;
  onResolveConfirm?: (confirm: PendingConfirm, approved: boolean) => void;
}) {
  const { t } = useTranslation("workspace");
  const now = useNow(streaming);
  const message = turn.assistant;
  const parsed = message ? parseReasoningContent(message.content) : null;
  const bodyText = message ? assistantVisibleBodyForUi(message.content) : "";
  const hasThinkTag = Boolean(parsed?.hasReasoningTag);
  const reasoningClosed = hasThinkTag && /<\/think>/i.test(String(message?.content ?? ""));
  const hasBody = Boolean(bodyText.trim());
  const reasoningText = parsed?.reasoning ?? "";
  const showThought =
    Boolean(reasoningText.trim()) && !reasoningDuplicatesVisibleBody(reasoningText, bodyText);
  const thoughtStreaming = streaming && hasThinkTag && !reasoningClosed;
  const seconds = scratchWorkedSeconds(turn, streaming, now);
  const [traceOpen, setTraceOpen] = useState(true);
  const showTrace = turn.tools.length > 0 || showThought || thoughtStreaming;
  const showActions = Boolean(message) && !streaming;

  return (
    <div className="flex justify-start" data-align="start" data-selected={selected ? "true" : undefined}>
      <div className="agx-im-body-type min-w-0 w-full max-w-full break-words text-[var(--agx-chat-im-body-font-size)] leading-[var(--agx-chat-im-body-line-height)] text-text-strong">
        {streaming && seconds > 0 ? (
          <div
            data-slot="scratch-working"
            className="flex items-center gap-2 py-0.5 text-[13px] leading-6 text-text-muted"
          >
            <span className={SCRATCH_RAIL_CLASS}>
              <ScratchMatrixOrb size={14} dots={5} />
            </span>
            <ScratchWaveText text={t("work.scratchWorking", { seconds })} />
          </div>
        ) : null}
        {!streaming && seconds > 0 ? (
          <button
            type="button"
            data-slot="scratch-worked"
            className="inline-flex items-center gap-1 py-0.5 text-[13px] leading-6 text-text-muted"
            onClick={() => setTraceOpen((value) => !value)}
          >
            <span>{t("work.scratchWorked", { seconds })}</span>
            {traceOpen ? (
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} />
            )}
          </button>
        ) : null}
        {showTrace && (streaming || traceOpen) ? (
          <div className="flex flex-col">
            {showThought || thoughtStreaming ? (
              <ScratchThoughtLine text={reasoningText} streaming={thoughtStreaming} />
            ) : null}
            {turn.tools.map((tool) => (
              <ScratchToolLine key={tool.id} message={tool} onResolveConfirm={onResolveConfirm} />
            ))}
          </div>
        ) : null}
        {hasBody ? (
          <div
            data-slot="scratch-assistant-body"
            className={`scratch-md msg-content min-w-0 overflow-x-auto ${showTrace ? "mt-2" : ""}`}
          >
            <CitationMarkdownBody content={bodyText} isStreaming={streaming} />
          </div>
        ) : null}
        {failed && !streaming && !hasBody ? (
          <div data-slot="scratch-failed" className="text-[12px] text-text-faint">
            {t("work.scratchEmptyReply")}
          </div>
        ) : null}
        {showActions && message ? (
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
  onResolveConfirm,
}: {
  messages: Message[];
  sending?: boolean;
  onRetry?: (userMessageId: string, editText?: string) => void;
  onQuote?: (text: string) => void;
  onResolveConfirm?: (confirm: PendingConfirm, approved: boolean) => void;
}) {
  const { t } = useTranslation("workspace");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const streamingId = sending ? lastAssistantId(messages) : null;
  const blocks = groupScratchTurns(messages);
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
              {blocks.map((block) => {
                if (block.kind === "user") {
                  const message = block.message;
                  return (
                    <ScratchMessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor
                    >
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
                    </ScratchMessageScrollerItem>
                  );
                }
                const message = block.turn.assistant;
                const anchorId = message?.id ?? block.turn.tools[0]?.id ?? "scratch-turn";
                return (
                  <ScratchMessageScrollerItem key={anchorId} messageId={anchorId}>
                    <ScratchTurnMessage
                      turn={block.turn}
                      streaming={Boolean(message) && streamingId === message?.id}
                      failed={Boolean(message) && failedAssistantId === message?.id}
                      selected={Boolean(message) && selectedSet.has(message.id)}
                      canRetry={
                        Boolean(message) &&
                        !sending &&
                        Boolean(onRetry) &&
                        Boolean(precedingScratchUserId(messages, message.id))
                      }
                      onCopy={() => message && copyMessage(message)}
                      onQuote={() => message && quoteMessage(message)}
                      onRetry={!sending && message && onRetry ? () => retryFrom(message) : undefined}
                      onSelect={() => message && toggleSelect(message.id)}
                      onResolveConfirm={onResolveConfirm}
                    />
                  </ScratchMessageScrollerItem>
                );
              })}
            </ScratchMessageScrollerContent>
          </ScratchMessageScrollerViewport>
          <ScratchMessageScrollerButton />
        </ScratchMessageScroller>
      </ScratchMessageScrollerProvider>
    </div>
  );
}
