import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode, MouseEvent as ReactMouseEvent } from "react";
import { Bookmark, Copy, Forward, LayoutList, Quote, RotateCcw, Pencil, X, ArrowUp, ArrowRight, AlertTriangle, TextSelect, Search, MessageSquarePlus, ChevronDown, ChevronRight } from "lucide-react";
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
import { renderUserMessageInlineBody, UserQuoteRefChip, renderUserBubbleInlineContent } from "./user-message-inline";
import {
  parseQuotedContentItems,
  resolveUserMessageQuoteDisplay,
} from "../../utils/user-quote-display";
import {
  parseAssistantOutputForUi,
  reasoningDuplicatesVisibleBody,
} from "../../utils/assistant-output";
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
import { avatarBgClass, avatarFgClass, expertLabelChipStyle } from "../../utils/avatar-color";
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
  onWebSearchMessage?: (message: Message, selectedText: string) => void;
  onQuoteToNewPane?: (message: Message, selectedText?: string) => void;
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
  /**
   * Group chat: show a prominent expert name label (no avatar rail).
   * User bubbles match Meta layout (no name/avatar chrome).
   */
  showSenderIdentity?: boolean;
  /** @deprecated Avatars removed from group chat; kept for API compat. */
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
  onWebSearchMessage,
  onQuoteToNewPane,
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
  senderAvatarVariant: _senderAvatarVariant = "circle",
  senderAvatarId,
  sessionBusy = false,
  isLastAssistantInPane = false,
  streamStalled = false,
  streamStalledSeconds = 0,
}: Props) {
  void _senderAvatarVariant;
  void userAvatarUrl;
  void assistantAvatarUrl;
  const theme = useAppStore((s) => s.theme);
  const senderStoreColor = useAppStore((s) =>
    senderAvatarId && senderAvatarId !== "meta"
      ? s.avatars.find((a) => a.id === senderAvatarId)?.color
      : undefined,
  );
  const isUser = message.role === "user";
  const displayName = isUser ? (userName || "我") : (assistantName || "AI");
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
  /** Group expert label only — no WeChat avatar rail (align with Meta chrome). */
  const showExpertLabel = showSenderIdentity && !isUser && !compactAssistant;
  const expertChip = showExpertLabel
    ? expertLabelChipStyle(senderAvatarId, senderStoreColor, theme)
    : null;
  const hideActions = compactAssistant && assistantVisual !== "compact-inline-with-actions";
  const [expertCollapsed, setExpertCollapsed] = useState(false);
  const parsed = !isUser ? parseReasoningContent(message.content) : null;
  const protocolParsed = !isUser ? parseAssistantOutputForUi(message.content) : null;
  const hasThinkTag = parsed?.hasReasoningTag ?? false;
  /** True once </think> has arrived in the stream; lets us collapse reasoning and show waiting dots while a tool call runs. */
  const reasoningClosed =
    hasThinkTag && /<\/think>/i.test(String(message.content ?? ""));
  // Messages created in live state do not always pass through the history
  // mapper. Apply the same protocol parser at the final render boundary so a
  // malformed/unclosed <followups> tail can never become Markdown body text.
  const userQuoteDisplay = isUser
    ? resolveUserMessageQuoteDisplay(message.content, message.quotedContent)
    : null;
  const rawBodyText = !isUser
    ? (protocolParsed?.visibleBody ?? (hasThinkTag ? (parsed?.response ?? "") : message.content))
    : (userQuoteDisplay?.body ?? message.content);
  /** Drop leading `---` so Meta/PM reports don't leave a hole under the expert label. */
  const bodyText =
    showExpertLabel && !isUser
      ? String(rawBodyText ?? "").replace(/^(?:\s*---\s*(?:\n|$))+/, "").replace(/^\s+/, "")
      : rawBodyText;
  const displayQuotedItems = isUser
    ? (userQuoteDisplay?.quotedItems ?? [])
    : parseQuotedContentItems(message.quotedContent);
  const citationReferences =
    (resolvedReferences?.length ?? 0) > 0 ? resolvedReferences : message.references;
  const referenceAttachments = isUser
    ? (message.attachments ?? []).filter((attachment) => isWorkspaceReferenceAttachment(attachment))
    : [];
  const displayAttachments = isUser
    ? (message.attachments ?? []).filter((attachment) => !isWorkspaceReferenceAttachment(attachment))
    : [];
  const hasBody = !!bodyText?.trim() || displayQuotedItems.length > 0;
  const bubbleStyle: CSSProperties = isUser
    ? {
        background: "var(--chat-im-user-bg)",
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
  const [menuHasSelection, setMenuHasSelection] = useState(false);
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

  const runWebSearch = () => {
    const picked = getContainedSelectionText(msgContentRef.current);
    if (!picked) return;
    onWebSearchMessage?.(message, picked);
  };

  const runQuoteToNewPane = () => {
    const picked = getContainedSelectionText(msgContentRef.current);
    onQuoteToNewPane?.(message, picked ?? undefined);
  };

  const runSelectAll = () => {
    const root = msgContentRef.current;
    if (!root) return;
    const range = document.createRange();
    range.selectNodeContents(root);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const runCopy = async () => {
    const picked = getContainedSelectionText(msgContentRef.current);
    if (picked) {
      try {
        await navigator.clipboard.writeText(picked);
      } catch {
        /* clipboard may be unavailable */
      }
      return;
    }
    onCopyMessage?.(message);
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
      // Ignore the right-click that opened the menu (some platforms emit mousedown after contextmenu).
      if (ev.button === 2) return;
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setMenuOpen(false);
    };
    const attach = window.setTimeout(() => {
      window.addEventListener("mousedown", onDown, true);
      window.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      window.clearTimeout(attach);
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    // NOTE: Keyword highlight used to mutate React-managed DOM nodes directly,
    // which can trigger removeChild/not-a-child crashes during reconciliation.
    // Keep this as a no-op until a fully declarative highlight renderer is added.
  }, [highlightTerms, message.content, message.quotedContent, message.forwardedHistory, isStreaming, isGroupTyping, hasBody]);

  const openContextMenu = (ev: ReactMouseEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    setMenuHasSelection(Boolean(getContainedSelectionText(msgContentRef.current)));
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
  const headerBadge = showExpertLabel ? badge : null;
  const contentBadge = headerBadge ? null : badge;
  const userBubbleGutterPx = USER_BUBBLE_GUTTER_PX;
  const canFoldExpertReply =
    showExpertLabel && !isStreaming && !isGroupTyping && !isMetaPendingWork && hasBody;
  // Gutter 挂在 stack 上（非整气泡 margin），保证操作栏与气泡边框同宽、左右缘对齐。
  const userStackStyle = isUser
    ? {
        marginLeft: userBubbleGutterPx,
        marginRight: userBubbleGutterPx,
        maxWidth: `calc(100% - ${userBubbleGutterPx * 2}px)`,
      }
    : undefined;
  const userBubbleStyle = isUser
    ? {
        ...bubbleStyle,
        width: "fit-content",
        maxWidth: "100%",
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
            className={`rounded p-1 hover:bg-surface-hover ${
              selected
                ? "text-[rgb(var(--theme-color-rgb,59,130,246))] hover:opacity-90"
                : "hover:text-text-strong"
            }`}
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
      }${!railRow && pendingWorkCompact ? " -mt-1" : ""}`}
      onContextMenu={openContextMenu}
    >
      {selectable ? (
        <button
          type="button"
          className={`mt-8 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition ${
            selected
              ? "border-[rgb(var(--theme-color-rgb,6,182,212))] bg-[rgb(var(--theme-color-rgb,6,182,212))] text-[var(--theme-color-text)]"
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
      <div
        className={`flex min-w-0 flex-1 flex-col ${isUser ? "items-end" : "items-start"}${assistantActionRhythmStack ? ` agx-assistant-action-rhythm mb-6 ${ASSISTANT_ACTION_RHYTHM_GAP_CLASS}` : ""}`}
      >
        {showExpertLabel && expertChip ? (
          <div className="mb-1 flex max-w-full items-center gap-2 px-3">
            {canFoldExpertReply ? (
              <button
                type="button"
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] font-semibold transition hover:opacity-90"
                style={{
                  backgroundColor: expertChip.backgroundColor,
                  borderColor: expertChip.borderColor,
                }}
                onClick={() => setExpertCollapsed((v) => !v)}
                aria-expanded={!expertCollapsed}
                title={expertCollapsed ? "展开回复" : "折叠回复"}
              >
                {expertCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-subtle" strokeWidth={2.2} />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-subtle" strokeWidth={2.2} />
                )}
                <span className="min-w-0 truncate" style={{ color: expertChip.color }}>
                  {displayName}
                </span>
                {headerBadge ? (
                  <span className="shrink-0 font-medium" style={{ color: expertChip.color }}>
                    {headerBadge}
                  </span>
                ) : null}
                <span className="shrink-0 text-[11px] font-medium text-text-subtle">
                  {expertCollapsed ? "展开" : "折叠"}
                </span>
              </button>
            ) : (
              <span
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] font-semibold"
                style={{
                  backgroundColor: expertChip.backgroundColor,
                  borderColor: expertChip.borderColor,
                }}
              >
                <span className="min-w-0 truncate" style={{ color: expertChip.color }}>
                  {displayName}
                </span>
                {headerBadge ? (
                  <span className="shrink-0 font-medium" style={{ color: expertChip.color }}>
                    {headerBadge}
                  </span>
                ) : null}
              </span>
            )}
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
        ) : isUser ? (
          <div className="agx-im-user-stack" style={userStackStyle}>
            {/* Trae-style: attachment chips sit above the text bubble, not inside it. */}
            {displayAttachments.length > 0 ? (
              <div className="mb-1.5 flex flex-wrap justify-end gap-2">
                {displayAttachments.map((attachment) => (
                  <AttachmentCard
                    key={`${attachment.name}:${attachment.size}:${attachment.mimeType}`}
                    attachment={attachment}
                  />
                ))}
              </div>
            ) : null}
            {hasBody || message.forwardedHistory || contentBadge ? (
            <div
              className="agx-im-user-bubble relative min-w-0 max-w-full rounded-xl border-0 px-3.5 py-2.5 text-[var(--agx-chat-im-body-font-size)] leading-relaxed rounded-tr-[4px]"
              style={userBubbleStyle}
            >
              <div ref={msgContentRef} className="msg-content min-w-0 break-words">
                {contentBadge}
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
                ) : bodyText.trim() || displayQuotedItems.length > 0 ? (
                  <div className="whitespace-pre-wrap break-words">
                    {renderUserBubbleInlineContent(
                      bodyText,
                      displayQuotedItems,
                      referenceAttachments,
                      onOpenFileReference
                    )}
                  </div>
                ) : null}
              </div>
            </div>
            ) : (
              <div ref={msgContentRef} className="hidden" aria-hidden />
            )}
            {hideActions ? null : (
              <div className="agx-im-user-actions">
                <div className="agx-im-user-actions-icons">
                  <MessageTimestamp ts={message.timestamp} align="right" />
                  <HoverTip label="复制">
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onCopyMessage?.(message)}
                    >
                      <Copy size={13} strokeWidth={1.5} />
                    </button>
                  </HoverTip>
                  <HoverTip label="引用">
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={runQuote}>
                      <Quote size={13} strokeWidth={1.5} />
                    </button>
                  </HoverTip>
                  <HoverTip label="收藏">
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={runFavorite}>
                      <Bookmark size={13} strokeWidth={1.5} />
                    </button>
                  </HoverTip>
                  <HoverTip label="转发">
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={runForward}>
                      <Forward size={13} strokeWidth={1.5} />
                    </button>
                  </HoverTip>
                  {onEditMessage ? (
                    <HoverTip label="修改">
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setEditContent(message.content);
                          setIsEditing(true);
                        }}
                      >
                        <Pencil size={13} strokeWidth={1.5} />
                      </button>
                    </HoverTip>
                  ) : null}
                  {onRetryMessage ? (
                    <HoverTip label="重试">
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onRetryMessage(message)}
                      >
                        <RotateCcw size={13} strokeWidth={1.5} />
                      </button>
                    </HoverTip>
                  ) : null}
                  <HoverTip label="多选" tooltipAlign="end">
                    <button
                      type="button"
                      className={
                        selected
                          ? "text-[rgb(var(--theme-color-rgb,59,130,246))] hover:opacity-90"
                          : undefined
                      }
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onToggleSelectMessage?.(message)}
                    >
                      <LayoutList size={13} strokeWidth={1.5} />
                    </button>
                  </HoverTip>
                </div>
              </div>
            )}
          </div>
        ) : expertCollapsed && canFoldExpertReply ? (
          <>
            {/* Body hidden while folded — expand via expert label. Keep root for copy/quote. */}
            <div ref={msgContentRef} className="hidden" aria-hidden>
              {bodyText}
            </div>
            {hideActions || !assistantIconButtons ? null : (
              <div className={ASSISTANT_ACTION_ICON_ONLY_CLASS}>
                <div className={ASSISTANT_ACTION_ICON_ROW_CLASS} style={assistantActionStyle}>
                  {assistantIconButtons}
                  <MessageTimestamp ts={message.timestamp} align="left" />
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div
              className={
                compactAssistant && noBubbleBorder
                  ? `relative min-w-0 w-full px-3 py-0 text-[var(--agx-chat-im-body-font-size)] ${assistantBodyLeadingClass}`
                  : isMetaPendingWork
                    ? `relative min-w-0 w-full px-3 py-0 text-[var(--agx-chat-im-body-font-size)] ${assistantBodyLeadingClass}`
                    : showExpertLabel
                      ? `agx-expert-body relative min-w-0 w-full px-3 pt-0 pb-0 text-[var(--agx-chat-im-body-font-size)] ${assistantBodyLeadingClass}`
                      : (message.references?.length ?? 0) > 0
                        ? `relative min-w-0 w-full px-3 pt-1 pb-0 text-[var(--agx-chat-im-body-font-size)] ${assistantBodyLeadingClass}`
                        : `relative min-w-0 w-full px-3 pt-3 pb-0 text-[var(--agx-chat-im-body-font-size)] ${assistantBodyLeadingClass}`
              }
              style={compactAssistant && noBubbleBorder ? undefined : userBubbleStyle}
            >
              <div ref={msgContentRef} className="msg-content min-w-0 break-words">
                {contentBadge}
                {displayQuotedItems.length > 0 ? (
                  <div className="mb-1.5">
                    {displayQuotedItems.map((quoted, idx) => (
                      <span key={`aq-${idx}-${quoted.slice(0, 12)}`}>
                        <UserQuoteRefChip quoted={quoted} />
                        {idx < displayQuotedItems.length - 1 ? " " : null}
                      </span>
                    ))}
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
                  bodyText?.trim() ? (
                    <div className="flex min-w-0 items-center gap-2 text-[13px] text-text-muted">
                      <span className="min-w-0 break-words leading-[1.65]">{bodyText.trim()}</span>
                      <StreamingDots compact />
                    </div>
                  ) : (
                    <StreamingDots compact />
                  )
                ) : (
                  <>
                    {(citationReferences?.length ?? 0) > 0 ? (
                      <ReferencesCard
                        references={citationReferences ?? []}
                        searchedQueries={message.searchedQueries}
                      />
                    ) : null}
                    {message.reasoning &&
                    !isStreaming &&
                    !reasoningDuplicatesVisibleBody(message.reasoning, bodyText) ? (
                      <ReasoningBlock
                        text={message.reasoning}
                        seconds={resolvePersistedReasoningSeconds(message.reasoning, message.reasoningSeconds)}
                      />
                    ) : null}
                    {!message.reasoning &&
                    parsed?.reasoning &&
                    !reasoningDuplicatesVisibleBody(parsed.reasoning, bodyText) ? (
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
                    {isStreaming && !hasBody && (!hasThinkTag || reasoningClosed) ? (
                      streamStalled ? (
                        <StalledStreamIndicator silentSeconds={streamStalledSeconds} />
                      ) : (
                        <StreamingDots compact={compactAssistant && noBubbleBorder} />
                      )
                    ) : null}
                    {hasBody ? (
                      <div
                        className={showExpertLabel ? undefined : assistantTextClassName}
                        style={assistantTextStyle}
                      >
                        <CitationMarkdownBody
                          content={bodyText}
                          references={citationReferences}
                          isStreaming={isStreaming}
                          onQuoteText={(text) => onQuoteMessage?.(message, text)}
                          onRevealPath={onRevealPath}
                        />
                      </div>
                    ) : null}
                    {isStreaming && hasBody && (!hasThinkTag || reasoningClosed) ? (
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
            {hideActions || showAssistantFollowups || !assistantIconButtons ? null : (
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
      {menuOpen ? createPortal(
        <div
          ref={menuRef}
          className="fixed z-[200] w-44 rounded-lg border border-border bg-surface-base p-1 shadow-2xl"
          style={{ left: menuPos.x, top: menuPos.y }}
          role="menu"
        >
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { void runCopy(); setMenuOpen(false); }}
          >
            <Copy size={12} className="shrink-0 text-text-faint" />复制
          </button>
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setMenuOpen(false); runQuote(); }}
          >
            <Quote size={12} className="shrink-0 text-text-faint" />引用至当前对话
          </button>
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setMenuOpen(false); runSelectAll(); }}
          >
            <TextSelect size={12} className="shrink-0 text-text-faint" />全选
          </button>
          <button
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-surface-hover ${
              menuHasSelection && onWebSearchMessage
                ? "text-text-primary"
                : "cursor-not-allowed text-text-faint opacity-50"
            }`}
            disabled={!menuHasSelection || !onWebSearchMessage}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setMenuOpen(false); runWebSearch(); }}
          >
            <Search size={12} className="shrink-0 text-text-faint" />用网络搜索
          </button>
          {onQuoteToNewPane ? (
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setMenuOpen(false); runQuoteToNewPane(); }}
            >
              <MessageSquarePlus size={12} className="shrink-0 text-text-faint" />引用至新对话
            </button>
          ) : null}
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
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
