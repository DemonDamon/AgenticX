import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, MouseEvent as ReactMouseEvent } from "react";
import { Bookmark, Copy, Forward, LayoutList, Quote, RotateCcw, Pencil, X, ArrowUp, ArrowRight, AlertTriangle } from "lucide-react";
import type { Message, MessageAttachment } from "../../store";
import { useAppStore } from "../../store";
import type { SearchReference } from "../../types/search-references";
import { AttachmentCard } from "./AttachmentCard";
import { isWorkspaceReferenceAttachment, type FileReferenceOpenRequest } from "../../utils/reference-attachment";
import { ReasoningBlock } from "./ReasoningBlock";
import { resolvePersistedReasoningSeconds } from "./reasoning-duration-cache";
import { ReferencesCard } from "./ReferencesCard";
import { parseReasoningContent } from "./reasoning-parser";
import { getContainedSelectionText } from "../../utils/favorite-selection";
import { HoverTip } from "../ds/HoverTip";
import { CitationMarkdownBody } from "./CitationMarkdownBody";
import { renderUserMessageInlineBody } from "./user-message-inline";
import {
  ASSISTANT_ACTION_ICON_ONLY_CLASS,
  ASSISTANT_ACTION_ICON_ROW_CLASS,
  ASSISTANT_ACTION_RHYTHM_GAP_CLASS,
  ASSISTANT_FOLLOWUP_CHIP_CLASS,
  ASSISTANT_FOLLOWUP_LIST_CLASS,
  getAssistantActionStyle,
  getAssistantTextClassName,
  getAssistantTextStyle,
} from "./im-layout";
import { resolveMetaDisplayName } from "../../utils/display-name";
import { avatarBgClass, avatarFgClass } from "../../utils/avatar-color";
import { shouldShowAssistantFollowups, shouldShowAssistantIconButtons } from "../../utils/im-bubble-actions";
import { MessageTimestamp } from "./MessageTimestamp";

type Props = {
  message: Message;
  /** When message.references is empty, inherit from same-turn tool_result / embedded JSON. */
  resolvedReferences?: SearchReference[];
  highlightTerms?: string[];
  badge?: ReactNode;
  assistantName?: string;
  assistantAvatarUrl?: string;
  /**
   * IM assistant layout: compact row aligns with tool cards (spacer only, no avatar/name),
   * used inside a parent ReAct block that renders the primary avatar column.
   */
  assistantVisual?: "default" | "compact-inline" | "compact-inline-with-actions";
  /** When true and compact, remove inner bubble border so parent container provides the single border. */
  noBubbleBorder?: boolean;
  userName?: string;
  userAvatarUrl?: string;
  onCopyMessage?: (message: Message) => void;
  onQuoteMessage?: (message: Message, selectedText?: string) => void;
  onFavoriteMessage?: (message: Message, selectedText?: string) => void;
  onToggleSelectMessage?: (message: Message) => void;
  onForwardMessage?: (message: Message, selectedText?: string) => void;
  onRetryMessage?: (message: Message) => void;
  onEditMessage?: (message: Message, newContent: string) => void;
  selectable?: boolean;
  selected?: boolean;
  /** Clicking a follow-up chip sends this text as the next user message (assistant only). */
  onFollowupClick?: (text: string, ctx?: { ownerSessionId?: string }) => void;
  /** Open absolute file path in workspace preview (assistant markdown paths). */
  onRevealPath?: (path: string) => void;
  /** Open @file reference chip in workspace preview (optionally focused to a line range). */
  onOpenFileReference?: (request: FileReferenceOpenRequest) => void;
  /** Suppress in-bubble chips; used when parent renders them outside a unified ReAct container. */
  omitSuggestedQuestions?: boolean;
  /** Tighten trailing line-box before a peeled block-level action row (ReAct card). */
  actionRhythmBodyTail?: boolean;
  /** Render-only hint when this assistant reply was cut off by session token budget. */
  budgetIncompleteHint?: boolean;
  /** Group chat: show avatar + display name on every bubble (WeChat-style). */
  showSenderIdentity?: boolean;
  /** Group member avatars use rounded square; user stays circular. */
  senderAvatarVariant?: "circle" | "rounded-square";
  /** Fallback tint when no imageUrl (avatar id for color hash). */
  senderAvatarId?: string;
  /** When true, suppress action buttons on the last assistant bubble while the session is busy/stalled. */
  sessionBusy?: boolean;
  isLastAssistantInPane?: boolean;
  /** Replace animated streaming dots with a stalled indicator on the __stream__ placeholder. */
  streamStalled?: boolean;
  streamStalledSeconds?: number;
};

/** Cycling 1→3 dots for group-chat typing rows (name shown in header only). */
function TypingDots() {
  const [count, setCount] = useState(1);
  useEffect(() => {
    const id = window.setInterval(() => {
      setCount((c) => (c >= 3 ? 1 : c + 1));
    }, 400);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="inline-block min-w-[1em] tabular-nums" aria-hidden>
      {".".repeat(count)}
    </span>
  );
}

function StalledStreamIndicator({ silentSeconds }: { silentSeconds: number }) {
  return (
    <div
      className="inline-flex items-center gap-1.5 py-1.5 text-xs text-amber-300/90"
      aria-live="polite"
      aria-label="任务已停滞"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{silentSeconds > 0 ? `已停滞 ${silentSeconds}s` : "已停滞"}</span>
    </div>
  );
}

/** Doubao-style 3-dot bouncing indicator for streaming gaps (reasoning done → tool call → first body token). */
function StreamingDots({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`inline-flex items-center gap-1.5 ${compact ? "py-0" : "py-1.5"}`}
      aria-live="polite"
      aria-label="正在处理"
    >
      <span
        className="h-1.5 w-1.5 rounded-full agx-dot-pulse"
        style={{ background: "var(--text-faint)" }}
      />
      <span
        className="h-1.5 w-1.5 rounded-full agx-dot-pulse"
        style={{ background: "var(--text-faint)", animationDelay: "0.2s" }}
      />
      <span
        className="h-1.5 w-1.5 rounded-full agx-dot-pulse"
        style={{ background: "var(--text-faint)", animationDelay: "0.4s" }}
      />
    </div>
  );
}

/** Shared with ReAct block shell so top-of-stack avatar matches IM bubbles. */
export function ChatImAvatar({
  label,
  imageUrl,
  variant = "circle",
  avatarId,
  color,
}: {
  label: string;
  imageUrl?: string;
  variant?: "circle" | "rounded-square";
  avatarId?: string;
  /** Palette key or empty (= Meta / theme). When omitted and avatarId set, looked up from store. */
  color?: string;
}) {
  const storeColor = useAppStore((s) =>
    avatarId ? s.avatars.find((a) => a.id === avatarId)?.color : undefined,
  );
  const resolvedColor = color ?? storeColor ?? "";
  const char = label.slice(0, 1) || "?";
  const rounded = variant === "rounded-square" ? "rounded-[6px]" : "rounded-full";
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={label}
        className={`h-8 w-8 shrink-0 object-cover ${rounded}`}
      />
    );
  }
  const tintClass = avatarId ? `${avatarBgClass(resolvedColor)} ${avatarFgClass(resolvedColor)}` : "";
  return (
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center text-xs font-bold ${rounded} ${tintClass}`}
      style={
        avatarId
          ? undefined
          : {
              background: "var(--chat-im-avatar-bg)",
              color: "var(--chat-im-avatar-fg, var(--text-strong))",
            }
      }
    >
      {char}
    </div>
  );
}

export function ImBubble({
  message,
  resolvedReferences,
  highlightTerms,
  badge,
  assistantName,
  assistantAvatarUrl,
  userName,
  userAvatarUrl,
  onCopyMessage,
  onQuoteMessage,
  onFavoriteMessage,
  onToggleSelectMessage,
  onForwardMessage,
  onRetryMessage,
  onEditMessage,
  selectable,
  selected,
  assistantVisual = "default",
  noBubbleBorder = false,
  onFollowupClick,
  onRevealPath,
  onOpenFileReference,
  omitSuggestedQuestions = false,
  actionRhythmBodyTail = false,
  budgetIncompleteHint = false,
  showSenderIdentity = false,
  senderAvatarVariant = "circle",
  senderAvatarId,
  sessionBusy = false,
  isLastAssistantInPane = false,
  streamStalled = false,
  streamStalledSeconds = 0,
}: Props) {
  const isUser = message.role === "user";
  const displayName = isUser ? (userName || "我") : (assistantName || "AI");
  const avatarUrl = isUser ? userAvatarUrl : assistantAvatarUrl;
  const isStreaming = message.id === "__stream__";
  const isMetaPendingWork = !isUser && message.id === "typing-meta";
  const isGroupTyping =
    !isUser &&
    typeof message.id === "string" &&
    message.id.startsWith("typing-") &&
    message.id !== "typing-meta";
  const compactAssistant =
    !isUser &&
    (assistantVisual === "compact-inline" || assistantVisual === "compact-inline-with-actions") &&
    !isGroupTyping &&
    !isMetaPendingWork;
  const showIdentityRail = showSenderIdentity && !compactAssistant;
  const hideActions = compactAssistant && assistantVisual !== "compact-inline-with-actions";
  const parsed = !isUser ? parseReasoningContent(message.content) : null;
  const hasThinkTag = parsed?.hasReasoningTag ?? false;
  /** True once </think> has arrived in the stream; lets us collapse reasoning and show waiting dots while a tool call runs. */
  const reasoningClosed =
    hasThinkTag && /<\/think>/i.test(String(message.content ?? ""));
  const bodyText = !isUser && hasThinkTag ? (parsed?.response ?? "") : message.content;
  const citationReferences =
    (resolvedReferences?.length ?? 0) > 0 ? resolvedReferences : message.references;
  const referenceAttachments = isUser
    ? (message.attachments ?? []).filter((attachment) => isWorkspaceReferenceAttachment(attachment))
    : [];
  const displayAttachments = isUser
    ? (message.attachments ?? []).filter((attachment) => !isWorkspaceReferenceAttachment(attachment))
    : [];
  const hasBody = !!bodyText?.trim();
  const bubbleStyle: CSSProperties = isUser
    ? {
        background: "var(--chat-im-user-bg)",
        borderColor: "var(--chat-im-user-border)",
        color: "var(--chat-im-user-text)",
      }
    : {
        // Frameless assistant text (e.g. Doubao-style): sit on chat surface; keep semantic text color.
        background: "transparent",
        borderColor: "transparent",
        color: "var(--chat-im-assistant-text)",
      };
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement | null>(null);
  const msgContentRef = useRef<HTMLDivElement | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const editInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (isEditing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.setSelectionRange(editInputRef.current.value.length, editInputRef.current.value.length);
      // Auto-resize initially
      editInputRef.current.style.height = "auto";
      editInputRef.current.style.height = `${Math.min(editInputRef.current.scrollHeight, 200)}px`;
    }
  }, [isEditing]);

  const runFavorite = () => {
    const picked = getContainedSelectionText(msgContentRef.current);
    onFavoriteMessage?.(message, picked ?? undefined);
  };

  const runQuote = () => {
    const picked = getContainedSelectionText(msgContentRef.current);
    onQuoteMessage?.(message, picked ?? undefined);
  };

  const runForward = () => {
    const picked = getContainedSelectionText(msgContentRef.current);
    onForwardMessage?.(message, picked ?? undefined);
  };

  const formatForwardSender = (sender?: string) => {
    const raw = String(sender || "").trim();
    if (!raw) return "AI";
    return resolveMetaDisplayName(raw.toLowerCase() === "meta" ? null : raw);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (ev: globalThis.MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  useEffect(() => {
    // NOTE: Keyword highlight used to mutate React-managed DOM nodes directly,
    // which can trigger removeChild/not-a-child crashes during reconciliation.
    // Keep this as a no-op until a fully declarative highlight renderer is added.
  }, [highlightTerms, message.content, message.quotedContent, message.forwardedHistory, isStreaming, isGroupTyping, hasBody]);

  const openContextMenu = (ev: ReactMouseEvent) => {
    if (compactAssistant) return;
    ev.preventDefault();
    setMenuPos({ x: ev.clientX, y: ev.clientY });
    setMenuOpen(true);
  };

  const showAssistantFollowups = shouldShowAssistantFollowups({
    isUser,
    isStreaming,
    isGroupTyping,
    omitSuggestedQuestions,
    hasBody,
    hasSuggestedQuestions: Boolean(message.suggestedQuestions?.length),
    hasFollowupHandler: Boolean(onFollowupClick),
    sessionBusy,
    isLastAssistantInPane,
  });
  const assistantTextClassName = !isUser
    ? getAssistantTextClassName({
        hasReasoning: Boolean(parsed?.reasoning),
        inReActRow: compactAssistant,
      })
    : undefined;
  const assistantTextStyle = !isUser
    ? getAssistantTextStyle({ hasReasoning: Boolean(parsed?.reasoning), inReActRow: compactAssistant })
    : undefined;
  const assistantActionStyle = getAssistantActionStyle({ inReActRow: compactAssistant });
  const USER_BUBBLE_GUTTER_PX = 14;
  const groupIdentityLayout = showIdentityRail && !compactAssistant;
  const headerBadge = groupIdentityLayout && !isUser ? badge : null;
  const contentBadge = headerBadge ? null : badge;
  const userBubbleGutterPx = groupIdentityLayout && isUser ? 0 : USER_BUBBLE_GUTTER_PX;
  const userBubbleStyle = isUser
    ? {
        ...bubbleStyle,
        marginLeft: userBubbleGutterPx,
        marginRight: userBubbleGutterPx,
        width: "fit-content",
        maxWidth: `calc(100% - ${userBubbleGutterPx * 2}px)`,
      }
    : bubbleStyle;

  const assistantIconButtons = shouldShowAssistantIconButtons({
    hideActions,
    isUser,
    isStreaming,
    isGroupTyping,
    isMetaPendingWork,
    hasBody,
    sessionBusy,
    isLastAssistantInPane,
  }) ? (
      <>
        <HoverTip label="复制">
          <button
            type="button"
            className="rounded p-1 hover:bg-surface-hover hover:text-text-strong"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onCopyMessage?.(message)}
          >
            <Copy size={13} />
          </button>
        </HoverTip>
        <HoverTip label="引用">
          <button type="button" className="rounded p-1 hover:bg-surface-hover hover:text-text-strong" onMouseDown={(e) => e.preventDefault()} onClick={runQuote}>
            <Quote size={13} />
          </button>
        </HoverTip>
        <HoverTip label="收藏">
          <button type="button" className="rounded p-1 hover:bg-surface-hover hover:text-text-strong" onMouseDown={(e) => e.preventDefault()} onClick={runFavorite}>
            <Bookmark size={13} />
          </button>
        </HoverTip>
        <HoverTip label="转发">
          <button type="button" className="rounded p-1 hover:bg-surface-hover hover:text-text-strong" onMouseDown={(e) => e.preventDefault()} onClick={runForward}>
            <Forward size={13} />
          </button>
        </HoverTip>
        {onRetryMessage ? (
          <HoverTip label="重试">
            <button
              type="button"
              className="rounded p-1 hover:bg-surface-hover hover:text-text-strong"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onRetryMessage(message)}
            >
              <RotateCcw size={13} />
            </button>
          </HoverTip>
        ) : null}
        <HoverTip label="多选">
          <button
            type="button"
            className="rounded p-1 hover:bg-surface-hover hover:text-text-strong"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onToggleSelectMessage?.(message)}
          >
            <LayoutList size={13} />
          </button>
        </HoverTip>
      </>
    ) : null;

  const assistantFollowupChipButtons =
    showAssistantFollowups && message.suggestedQuestions ? (
      <>
        {message.suggestedQuestions.slice(0, 3).map((q, qi) => (
          <button
            key={`${qi}-${q}`}
            type="button"
            className={ASSISTANT_FOLLOWUP_CHIP_CLASS}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              onFollowupClick?.(q, { ownerSessionId: message.ownerSessionId })
            }
          >
            <span>{q}</span>
            <ArrowRight className="h-3 w-3 shrink-0 opacity-50 transition group-hover:opacity-80" />
          </button>
        ))}
      </>
    ) : null;

  const pendingWorkCompact = isMetaPendingWork || (compactAssistant && isStreaming && !hasBody);
  // Inside the ReAct rail (compact-inline rows stacked flush with no parent gap),
  // every row must rely solely on its own `py-1` for a uniform 8px rhythm. The
  // streaming `!mt-1` / `-mt-1` nudges are meant for the standalone assistant
  // bubble and, when applied to a streaming reasoning/dots row in the rail, make
  // that row sit 4px higher/lower than the committed rows above it — the uneven
  // line spacing reported in production. Neutralize them for rail rows only.
  const railRow = compactAssistant && noBubbleBorder;
  const assistantActionRhythmStack = !isUser && showAssistantFollowups;
  const tightenAssistantBodyLeading = assistantActionRhythmStack || actionRhythmBodyTail;
  const assistantBodyLeadingClass = tightenAssistantBodyLeading ? "leading-snug" : "leading-relaxed";

  return (
    <div
      className={`group relative flex min-w-0 items-start gap-2${
        !railRow && isStreaming && !pendingWorkCompact ? " !mt-1" : ""
      }${!railRow && pendingWorkCompact ? " -mt-1" : ""}${
        groupIdentityLayout && !isUser ? " pl-4" : ""
      }`}
      onContextMenu={openContextMenu}
    >
      {selectable ? (
        <button
          type="button"
          className={`mt-8 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition ${
            selected
              ? "border-[rgb(var(--theme-color-rgb,6,182,212))] bg-[rgb(var(--theme-color-rgb,6,182,212))] text-white"
              : "border-text-faint bg-transparent text-transparent"
          }`}
          onClick={() => onToggleSelectMessage?.(message)}
          aria-label={selected ? "取消选择消息" : "选择消息"}
        >
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3.5 8.5L6.5 11.5L12.5 4.5" />
          </svg>
        </button>
      ) : null}
      {groupIdentityLayout && isUser ? <div className="min-h-px min-w-0 flex-1" aria-hidden /> : null}
      {groupIdentityLayout && !isUser ? (
        <div className="mt-0.5 shrink-0 self-start">
          <ChatImAvatar
            label={displayName}
            imageUrl={avatarUrl}
            variant={senderAvatarVariant}
            avatarId={senderAvatarId}
          />
        </div>
      ) : null}
      <div
        className={`flex min-w-0 flex-col ${isUser ? "items-end" : "items-start"}${groupIdentityLayout && isUser ? " w-auto max-w-[calc(100%-2.5rem)] shrink-0" : " min-w-0 flex-1"}${assistantActionRhythmStack ? ` agx-assistant-action-rhythm mb-6 ${ASSISTANT_ACTION_RHYTHM_GAP_CLASS}` : ""}`}
      >
        {groupIdentityLayout && isUser ? (
          <div className="mb-1 w-full min-w-0 text-right">
            <span className="max-w-full truncate text-[12px] font-medium text-text-muted">{displayName}</span>
          </div>
        ) : groupIdentityLayout && !isUser ? (
          <div className="mb-0.5 flex max-w-full items-center gap-2 px-3 text-[12px] font-medium text-text-muted">
            <span className="min-w-0 truncate">{displayName}</span>
            {headerBadge ? <span className="shrink-0">{headerBadge}</span> : null}
          </div>
        ) : null}
        {isEditing ? (
          <div className="flex w-full max-w-3xl items-end gap-2">
            <button
              type="button"
              className="mb-1 p-1.5 text-text-faint hover:text-text-strong transition"
              onClick={() => setIsEditing(false)}
            >
              <X size={16} />
            </button>
            <div className="flex-1 rounded-xl border border-[rgb(var(--theme-color-rgb,6,182,212))] bg-surface-card flex items-end p-1">
              <textarea
                ref={editInputRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full resize-none bg-transparent px-2 py-1.5 text-[var(--agx-chat-im-body-font-size)] text-text-strong outline-none"
                rows={1}
                onKeyDown={(e) => {
                  const isImeComposing = e.nativeEvent.isComposing || e.key === "Process" || e.keyCode === 229;
                  if (isImeComposing) return;
                  
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (editContent.trim() && onEditMessage) {
                      onEditMessage(message, editContent);
                      setIsEditing(false);
                    }
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsEditing(false);
                  }
                }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = "auto";
                  target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
                }}
              />
              <button
                type="button"
                className="m-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--theme-color-rgb,6,182,212))] text-white transition hover:opacity-90 disabled:opacity-50"
                disabled={!editContent.trim()}
                onClick={() => {
                  if (editContent.trim() && onEditMessage) {
                    onEditMessage(message, editContent);
                    setIsEditing(false);
                  }
                }}
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        ) : (
          <>
            <div
              className={
                compactAssistant && noBubbleBorder
                  ? `relative min-w-0 w-full px-3 py-0 text-[var(--agx-chat-im-body-font-size)] ${assistantBodyLeadingClass}`
                  : isUser
                    ? "agx-im-user-bubble relative min-w-0 w-fit max-w-full rounded-xl border px-3 py-3 text-[var(--agx-chat-im-body-font-size)] leading-relaxed rounded-tr-[4px]"
                    : isMetaPendingWork
                      ? `relative min-w-0 w-full px-3 py-0 text-[var(--agx-chat-im-body-font-size)] ${assistantBodyLeadingClass}`
                    : groupIdentityLayout
                      ? `relative min-w-0 w-full px-3 pt-1 pb-0 text-[var(--agx-chat-im-body-font-size)] ${assistantBodyLeadingClass}`
                      : (message.references?.length ?? 0) > 0
                        ? `relative min-w-0 w-full px-3 pt-1 pb-0 text-[var(--agx-chat-im-body-font-size)] ${assistantBodyLeadingClass}`
                        : `relative min-w-0 w-full px-3 pt-3 pb-0 text-[var(--agx-chat-im-body-font-size)] ${assistantBodyLeadingClass}`
              }
              style={compactAssistant && noBubbleBorder ? undefined : userBubbleStyle}
            >
              {isUser && displayAttachments.length > 0 ? (
                <div className="mb-2 flex flex-wrap gap-2">
                  {displayAttachments.map((attachment) => (
                    <AttachmentCard
                      key={`${attachment.name}:${attachment.size}:${attachment.mimeType}`}
                      attachment={attachment}
                    />
                  ))}
                </div>
              ) : null}
              <div ref={msgContentRef} className="msg-content min-w-0 break-words">
                {contentBadge}
                {message.quotedContent ? (
                  <div className="mb-2 rounded-md border border-border bg-surface-panel/70 px-2 py-1 text-xs text-text-faint">
                    <span className="line-clamp-2">{message.quotedContent}</span>
                  </div>
                ) : null}
                {message.forwardedHistory ? (
                  <div className="space-y-2">
                    <div className="rounded-md border border-border bg-surface-panel/70 px-2 py-1 text-xs text-text-faint">
                      {message.forwardedHistory.note ? (
                        <div className="mb-1 break-words text-text-primary">{message.forwardedHistory.note}</div>
                      ) : null}
                      <div className="space-y-1">
                        {message.forwardedHistory.items.slice(0, 2).map((item, index) => (
                          <div
                            key={`${item.sender}-${index}-${item.content.slice(0, 20)}`}
                            className="line-clamp-2 break-words"
                          >
                            {formatForwardSender(item.sender)}: {item.content}
                          </div>
                        ))}
                        {message.forwardedHistory.items.length > 2 ? (
                          <div className="text-[11px] text-text-faint">...</div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : isMetaPendingWork ? (
                  streamStalled ? (
                    <StalledStreamIndicator silentSeconds={streamStalledSeconds} />
                  ) : (
                    <StreamingDots compact />
                  )
                ) : isGroupTyping ? (
                  <span className="inline-flex items-baseline gap-0.5" aria-live="polite" aria-label="正在输入">
                    <span>正在输入</span>
                    <TypingDots />
                  </span>
                ) : (
                  <>
                    {!isUser && (citationReferences?.length ?? 0) > 0 ? (
                      <ReferencesCard
                        references={citationReferences ?? []}
                        searchedQueries={message.searchedQueries}
                      />
                    ) : null}
                    {!isUser && message.reasoning && !isStreaming ? (
                      <ReasoningBlock
                        text={message.reasoning}
                        seconds={resolvePersistedReasoningSeconds(message.reasoning, message.reasoningSeconds)}
                      />
                    ) : null}
                    {!isUser &&
                    !message.reasoning &&
                    parsed?.reasoning ? (
                      <ReasoningBlock
                        text={parsed.reasoning}
                        seconds={
                          isStreaming
                            ? undefined
                            : resolvePersistedReasoningSeconds(parsed.reasoning, message.reasoningSeconds)
                        }
                        streaming={isStreaming && hasThinkTag && !reasoningClosed}
                      />
                    ) : null}
                    {!isUser && isStreaming && !hasBody && (!hasThinkTag || reasoningClosed) ? (
                      streamStalled ? (
                        <StalledStreamIndicator silentSeconds={streamStalledSeconds} />
                      ) : (
                        <StreamingDots compact={compactAssistant && noBubbleBorder} />
                      )
                    ) : null}
                    {hasBody ? (
                      isUser ? (
                        <div className="whitespace-pre-wrap break-words">
                          {renderUserMessageInlineBody(bodyText, referenceAttachments, onOpenFileReference)}
                        </div>
                      ) : (
                        <div className={assistantTextClassName} style={assistantTextStyle}>
                          <CitationMarkdownBody
                            content={bodyText}
                            references={citationReferences}
                            isStreaming={isStreaming}
                            onQuoteText={(text) => onQuoteMessage?.(message, text)}
                            onRevealPath={onRevealPath}
                          />
                        </div>
                      )
                    ) : null}
                    {!isUser &&
                    isStreaming &&
                    hasBody &&
                    (!hasThinkTag || reasoningClosed) ? (
                      streamStalled ? (
                        <StalledStreamIndicator silentSeconds={streamStalledSeconds} />
                      ) : (
                        <StreamingDots compact={compactAssistant && noBubbleBorder} />
                      )
                    ) : null}
                  </>
                )}
              </div>
            </div>
            {budgetIncompleteHint ? (
              <p className="-mt-0.5 mb-1 px-3 text-[11px] leading-relaxed text-text-faint">
                此回复因会话预算上限被截停，未完成
              </p>
            ) : null}
            {showAssistantFollowups && assistantIconButtons ? (
              <>
                <div className={ASSISTANT_ACTION_ICON_ROW_CLASS} style={assistantActionStyle}>
                  {assistantIconButtons}
                  <MessageTimestamp ts={message.timestamp} align="left" />
                </div>
                <div className={ASSISTANT_FOLLOWUP_LIST_CLASS} style={assistantActionStyle}>
                  {assistantFollowupChipButtons}
                </div>
              </>
            ) : showAssistantFollowups ? (
              <div className={ASSISTANT_FOLLOWUP_LIST_CLASS} style={assistantActionStyle}>
                {assistantFollowupChipButtons}
              </div>
            ) : null}
            {hideActions ? null : isUser ? (
              <div className="mt-0.5 flex w-full flex-wrap items-center justify-end gap-0.5 pb-0 leading-none pr-2 text-text-faint">
                <MessageTimestamp ts={message.timestamp} align="right" />
                <HoverTip label="复制">
                  <button
                    type="button"
                    className="rounded p-1 hover:bg-surface-hover hover:text-text-strong"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onCopyMessage?.(message)}
                  >
                    <Copy size={13} />
                  </button>
                </HoverTip>
                <HoverTip label="引用">
                  <button type="button" className="rounded p-1 hover:bg-surface-hover hover:text-text-strong" onMouseDown={(e) => e.preventDefault()} onClick={runQuote}>
                    <Quote size={13} />
                  </button>
                </HoverTip>
                <HoverTip label="收藏">
                  <button type="button" className="rounded p-1 hover:bg-surface-hover hover:text-text-strong" onMouseDown={(e) => e.preventDefault()} onClick={runFavorite}>
                    <Bookmark size={13} />
                  </button>
                </HoverTip>
                <HoverTip label="转发">
                  <button type="button" className="rounded p-1 hover:bg-surface-hover hover:text-text-strong" onMouseDown={(e) => e.preventDefault()} onClick={runForward}>
                    <Forward size={13} />
                  </button>
                </HoverTip>
                {onEditMessage ? (
                  <HoverTip label="修改">
                    <button
                      type="button"
                      className="rounded p-1 hover:bg-surface-hover hover:text-text-strong"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setEditContent(message.content);
                        setIsEditing(true);
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                  </HoverTip>
                ) : null}
                {onRetryMessage ? (
                  <HoverTip label="重试">
                    <button
                      type="button"
                      className="rounded p-1 hover:bg-surface-hover hover:text-text-strong"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onRetryMessage(message)}
                    >
                      <RotateCcw size={13} />
                    </button>
                  </HoverTip>
                ) : null}
                <HoverTip label="多选">
                  <button
                    type="button"
                    className="rounded p-1 hover:bg-surface-hover hover:text-text-strong"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onToggleSelectMessage?.(message)}
                  >
                    <LayoutList size={13} />
                  </button>
                </HoverTip>
              </div>
            ) : showAssistantFollowups || !assistantIconButtons ? null : (
              <div className={ASSISTANT_ACTION_ICON_ONLY_CLASS}>
                <div className={ASSISTANT_ACTION_ICON_ROW_CLASS} style={assistantActionStyle}>
                  {assistantIconButtons}
                  <MessageTimestamp ts={message.timestamp} align="left" />
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {groupIdentityLayout && isUser ? (
        <div className="mt-0.5 shrink-0 self-start">
          <ChatImAvatar
            label={displayName}
            imageUrl={avatarUrl}
            variant={senderAvatarVariant}
            avatarId={senderAvatarId ?? "user-self"}
          />
        </div>
      ) : null}
      {menuOpen && !compactAssistant ? (
        <div
          ref={menuRef}
          className="fixed z-[80] w-36 rounded-lg border border-border bg-surface-base p-1 shadow-2xl"
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setMenuOpen(false); onCopyMessage?.(message); }}
          >
            <Copy size={12} className="shrink-0 text-text-faint" />复制
          </button>
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setMenuOpen(false); runQuote(); }}
          >
            <Quote size={12} className="shrink-0 text-text-faint" />引用
          </button>
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setMenuOpen(false); runFavorite(); }}
          >
            <Bookmark size={12} className="shrink-0 text-text-faint" />收藏
          </button>
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setMenuOpen(false); runForward(); }}
          >
            <Forward size={12} className="shrink-0 text-text-faint" />转发
          </button>
          {onEditMessage ? (
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setMenuOpen(false);
                setEditContent(message.content);
                setIsEditing(true);
              }}
            >
              <Pencil size={12} className="shrink-0 text-text-faint" />修改
            </button>
          ) : null}
          {onRetryMessage ? (
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setMenuOpen(false); onRetryMessage(message); }}
            >
              <RotateCcw size={12} className="shrink-0 text-text-faint" />重试
            </button>
          ) : null}
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setMenuOpen(false); onToggleSelectMessage?.(message); }}
          >
            <LayoutList size={12} className="shrink-0 text-text-faint" />多选
          </button>
        </div>
      ) : null}
    </div>
  );
}
