import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode, MouseEvent as ReactMouseEvent } from "react";
import { Bookmark, Copy, Forward, LayoutList, Quote, RotateCcw, Pencil, X, ArrowUp, ArrowRight, AlertTriangle, TextSelect, Search, MessageSquarePlus } from "lucide-react";
import { ContinueInNewTaskIcon } from "./ContinueInNewTaskIcon";
import { OrbBurst } from "../brand/OrbBurst";
import type { Message, MessageAttachment } from "../../store";
import { useAppStore } from "../../store";
import { isRegistryAvatarId, preferCostumeOverBrandMark, preferLiveAvatarUrl } from "../../utils/live-avatar-url";
import { ThemedAvatarImage } from "../ds/ThemedAvatarImage";
import type { SearchReference } from "../../types/search-references";
import { AttachmentCard } from "./AttachmentCard";
import { isWorkspaceReferenceAttachment, type FileReferenceOpenRequest } from "../../utils/reference-attachment";
import { ReasoningBlock } from "./ReasoningBlock";
import { resolvePersistedReasoningSeconds } from "./reasoning-duration-cache";
import { ReferencesCard } from "./ReferencesCard";
import { CitationSourcesCard } from "./WebSearchSources";
import { withBibliographyFallback } from "./source-attribution-parse";
import { parseReasoningContent } from "./reasoning-parser";
import { getContainedSelectionText } from "../../utils/favorite-selection";
import { isPeerHumanSpeakerId, resolveUserBubbleName } from "../../utils/peer-human-speaker";
import { HoverTip } from "../ds/HoverTip";
import { CitationMarkdownBody } from "./CitationMarkdownBody";
import { InlineImageBlock } from "./InlineImageBlock";
import { hasImageBlock, readyLightboxImages, type ImageContentBlock } from "../../utils/content-blocks";
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
  ASSISTANT_ACTION_LINE_CLASS,
  ASSISTANT_ACTION_RHYTHM_GAP_CLASS,
  ASSISTANT_HOVER_REVEAL_CLASS,
  ASSISTANT_FOLLOWUP_CHIP_CLASS,
  ASSISTANT_FOLLOWUP_LIST_CLASS,
  ASSISTANT_ICON_RAIL_CLASS,
  META_PENDING_ORB_PX,
  getAssistantActionStyle,
  getAssistantTextClassName,
  getAssistantTextStyle,
} from "./im-layout";
import { resolveMetaDisplayName } from "../../utils/display-name";
import { avatarBgClass, avatarFgClass } from "../../utils/avatar-color";
import {
  BUNDLED_META_AVATAR_IM_ZOOM_CLASS,
  NEAR_CUBE_AVATAR_FIT_CLASS,
  resolveBundledMetaAvatarUrl,
  isBundledMetaAvatarUrl,
} from "../../constants/meta-avatar";
import { isNearCubePortraitUrl } from "../../utils/theme-portrait";
import { shouldShowAssistantFollowups, shouldShowAssistantIconButtons } from "../../utils/im-bubble-actions";
import { isGroupStreamMessageId, stripTrailingFinalMarker } from "../../utils/group-stream-text";
import { MessageTimestamp } from "./MessageTimestamp";
import { MessageTurnMeta } from "./MessageTurnMeta";
import { Shimmer } from "../ds/Shimmer";
import { MaybeConversationBubble, MaybeConversationContent } from "./Conversation";
import { GroupTalkReportCard } from "./GroupTalkReportCard";
import { usePacedStreamText } from "./usePacedStreamText";
import { splitGroupTalkFromReport } from "../../utils/group-talk-report";

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
  onContinueFromMessage?: (message: Message) => void;
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
  /** Same sender as the previous visible group row: hide name/avatar. */
  clusterContinue?: boolean;
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
  /** Ready images in the current user turn; lightbox arrows switch within this set. */
  lightboxGallery?: ImageContentBlock[];
  /** Deliverable cards after the body; copy/quote sit to the right of the cards. */
  afterBody?: ReactNode;
  /** Open WorkPanel「参考信息」for this turn's web citations. */
  onOpenWorkspaceRefs?: () => void;
  /** Session-level web refs so the chip still shows when this row omitted `references`. */
  sessionWebRefs?: SearchReference[];
};

function StalledStreamIndicator({ silentSeconds }: { silentSeconds: number }) {
  const { t } = useTranslation("chat");
  return (
    <div
      className="inline-flex items-center gap-1.5 py-1.5 text-xs text-amber-300/90"
      aria-live="polite"
      aria-label={t("status.stalledAria")}
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{silentSeconds > 0 ? t("status.stalledSeconds", { seconds: silentSeconds }) : t("status.stalled")}</span>
    </div>
  );
}

/** Doubao-style 3-dot bouncing indicator for streaming gaps (reasoning done → tool call → first body token). */
function StreamingDots({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation("chat");
  const orb = (
    <OrbBurst
      width={compact ? META_PENDING_ORB_PX : 32}
      height={compact ? META_PENDING_ORB_PX : 32}
    />
  );
  return (
    <div
      className={`inline-flex items-center gap-2 ${compact ? "py-0" : "py-1.5"}`}
      aria-live="polite"
      aria-label={t("status.processingAria")}
    >
      {compact ? (
        <span className={ASSISTANT_ICON_RAIL_CLASS} data-pending-orb-rail="meta">
          {orb}
        </span>
      ) : (
        orb
      )}
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
  size = "md",
}: {
  label: string;
  imageUrl?: string;
  variant?: "circle" | "rounded-square";
  avatarId?: string;
  /** Palette key or empty (= Meta / theme). When omitted and avatarId set, looked up from store. */
  color?: string;
  size?: "sm" | "md";
}) {
  const userCostumeUrl = useAppStore((s) => s.userAvatarUrl);
  const liveExpert = useAppStore((s) => {
    const id = String(avatarId ?? "").trim();
    if (!isRegistryAvatarId(id)) return undefined;
    return s.avatars.find((item) => item.id === id);
  });
  const resolvedColor = color ?? liveExpert?.color ?? "";
  const resolvedImage = preferCostumeOverBrandMark(
    preferLiveAvatarUrl(liveExpert?.avatarUrl, imageUrl),
    userCostumeUrl,
  );
  const char = label.slice(0, 1) || "?";
  const rounded = variant === "rounded-square" ? "rounded-[6px]" : "rounded-full";
  const dim = size === "sm" ? "h-7 w-7 text-[11px]" : "h-8 w-8 text-xs";
  if (resolvedImage) {
    if (isBundledMetaAvatarUrl(resolvedImage)) {
      return (
        <span
          className={`agx-im-avatar ${dim} relative inline-flex shrink-0 overflow-hidden ${rounded}`}
          data-avatar-fit="logo"
        >
          <img
            src={resolveBundledMetaAvatarUrl(resolvedImage)}
            alt={label}
            className={`h-full w-full origin-center object-cover ${BUNDLED_META_AVATAR_IM_ZOOM_CLASS}`}
          />
        </span>
      );
    }
    if (isNearCubePortraitUrl(resolvedImage)) {
      return (
        <span
          className={`agx-im-avatar ${dim} relative inline-flex shrink-0 overflow-visible`}
          data-avatar-fit="cube"
        >
          <img
            src={resolvedImage}
            alt={label}
            className={`h-full w-full ${NEAR_CUBE_AVATAR_FIT_CLASS}`}
          />
        </span>
      );
    }
    return (
      <ThemedAvatarImage
        src={resolvedImage}
        alt={label}
        className={`agx-im-avatar ${dim} shrink-0 object-cover ${rounded}`}
      />
    );
  }
  const tintClass = avatarId ? `${avatarBgClass(resolvedColor)} ${avatarFgClass(resolvedColor)}` : "";
  return (
    <div
      className={`agx-im-avatar flex ${dim} shrink-0 items-center justify-center font-bold ${rounded} ${tintClass}`}
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

const MESSAGE_CONTEXT_MENU_MARGIN = 8;

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
  onContinueFromMessage,
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
  clusterContinue = false,
  senderAvatarVariant: _senderAvatarVariant = "circle",
  senderAvatarId,
  sessionBusy = false,
  isLastAssistantInPane = false,
  streamStalled = false,
  streamStalledSeconds = 0,
  lightboxGallery,
  afterBody,
  onOpenWorkspaceRefs,
  sessionWebRefs,
}: Props) {
  const { t } = useTranslation("chat");
  void _senderAvatarVariant;
  void userAvatarUrl;
  const isUser = message.role === "user";
  const imageGallery = lightboxGallery ?? readyLightboxImages(message.blocks);
  const fallbackMe = userName || t("actions.me");
  const displayName = isUser
    ? resolveUserBubbleName({
        speakerUserId: message.speakerUserId,
        speakerName: message.speakerName,
        fallbackMe,
      })
    : (assistantName || "AI");
  const isPeerHuman = isUser && isPeerHumanSpeakerId(message.speakerUserId);
  const isStreaming = message.id === "__stream__" || isGroupStreamMessageId(message.id);
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
  const isGroupAssistant = showSenderIdentity && !isUser && !compactAssistant;
  const showGroupIdentityChrome = isGroupAssistant && !clusterContinue;
  const showExpertLabel = showGroupIdentityChrome;
  const hideActions = compactAssistant && assistantVisual !== "compact-inline-with-actions";
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
  const strippedBody = !isUser ? stripTrailingFinalMarker(String(rawBodyText ?? "")) : rawBodyText;
  const bodyText =
    isGroupAssistant
      ? String(strippedBody ?? "").replace(/^(?:\s*---\s*(?:\n|$))+/, "").replace(/^\s+/, "")
      : strippedBody;
  const groupStreamActive = isGroupAssistant && isStreaming;
  const pacedBodyText = usePacedStreamText(String(bodyText ?? ""), groupStreamActive);
  const canPeelGroupReport =
    isGroupAssistant &&
    !isStreaming &&
    !isGroupTyping &&
    !isMetaPendingWork &&
    !hasImageBlock(message.blocks);
  const peeled = canPeelGroupReport
    ? splitGroupTalkFromReport(String(bodyText ?? ""))
    : { talk: String(bodyText ?? ""), report: null as string | null };
  const assistantBodyText = groupStreamActive ? pacedBodyText : peeled.talk;
  const displayQuotedItems = isUser
    ? (userQuoteDisplay?.quotedItems ?? [])
    : parseQuotedContentItems(message.quotedContent);
  const citationReferences = useMemo(
    () =>
      withBibliographyFallback(
        (resolvedReferences?.length ?? 0) > 0 ? resolvedReferences : message.references,
        String(bodyText ?? ""),
      ),
    [resolvedReferences, message.references, bodyText],
  );
  const kbReferences = useMemo(
    () => citationReferences.filter((ref) => ref.source === "kb"),
    [citationReferences],
  );
  const webReferences = useMemo(
    () => citationReferences.filter((ref) => ref.source !== "kb"),
    [citationReferences],
  );
  const referenceAttachments = isUser
    ? (message.attachments ?? []).filter((attachment) => isWorkspaceReferenceAttachment(attachment))
    : [];
  const displayAttachments = isUser
    ? (message.attachments ?? []).filter((attachment) => !isWorkspaceReferenceAttachment(attachment))
    : [];
  const hasBody =
    !!bodyText?.trim() || displayQuotedItems.length > 0 || hasImageBlock(message.blocks);
  const renderInlineBlocks = hasImageBlock(message.blocks);
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
  const [menuLayout, setMenuLayout] = useState<{ x: number; y: number } | null>(null);
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

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuLayout(null);
      return;
    }

    const reposition = () => {
      const menu = menuRef.current;
      if (!menu) return;
      const rect = menu.getBoundingClientRect();
      const maxLeft = Math.max(
        MESSAGE_CONTEXT_MENU_MARGIN,
        window.innerWidth - rect.width - MESSAGE_CONTEXT_MENU_MARGIN,
      );
      const maxTop = Math.max(
        MESSAGE_CONTEXT_MENU_MARGIN,
        window.innerHeight - rect.height - MESSAGE_CONTEXT_MENU_MARGIN,
      );
      const left = Math.min(
        Math.max(menuPos.x, MESSAGE_CONTEXT_MENU_MARGIN),
        maxLeft,
      );
      const top =
        menuPos.y + rect.height <= window.innerHeight - MESSAGE_CONTEXT_MENU_MARGIN
          ? Math.min(Math.max(menuPos.y, MESSAGE_CONTEXT_MENU_MARGIN), maxTop)
          : menuPos.y - rect.height >= MESSAGE_CONTEXT_MENU_MARGIN
            ? menuPos.y - rect.height
            : maxTop;
      setMenuLayout((prev) => (prev?.x === left && prev.y === top ? prev : { x: left, y: top }));
    };

    reposition();
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [menuOpen, menuPos, menuHasSelection, onEditMessage, onQuoteToNewPane, onRetryMessage]);

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
    setMenuLayout(null);
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
    keepActionsWhileBusy: showSenderIdentity,
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
  const assistantActionStyle = isGroupAssistant
    ? { marginLeft: 0 }
    : getAssistantActionStyle({ inReActRow: compactAssistant });
  const actionOnlyClass = isGroupAssistant
    ? "mb-3 mt-1.5 min-w-0 self-stretch"
    : ASSISTANT_ACTION_ICON_ONLY_CLASS;
  const USER_BUBBLE_GUTTER_PX = 14;
  const headerBadge = showExpertLabel ? badge : null;
  const contentBadge = headerBadge ? null : badge;
  const userBubbleGutterPx = USER_BUBBLE_GUTTER_PX;
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
    keepActionsWhileBusy: showSenderIdentity,
  }) ? (
      <>
        <HoverTip label={t("actions.copy")}>
          <button
            type="button"
            className="rounded p-1 hover:bg-surface-hover hover:text-text-strong"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onCopyMessage?.(message)}
          >
            <Copy size={14} strokeWidth={2} />
          </button>
        </HoverTip>
        <HoverTip label={t("actions.quote")}>
          <button type="button" className="rounded p-1 hover:bg-surface-hover hover:text-text-strong" onMouseDown={(e) => e.preventDefault()} onClick={runQuote}>
            <Quote size={14} strokeWidth={2} />
          </button>
        </HoverTip>
        <HoverTip label={t("actions.favorite")}>
          <button type="button" className="rounded p-1 hover:bg-surface-hover hover:text-text-strong" onMouseDown={(e) => e.preventDefault()} onClick={runFavorite}>
            <Bookmark size={14} strokeWidth={2} />
          </button>
        </HoverTip>
        <HoverTip label={t("actions.forward")}>
          <button type="button" className="rounded p-1 hover:bg-surface-hover hover:text-text-strong" onMouseDown={(e) => e.preventDefault()} onClick={runForward}>
            <Forward size={14} strokeWidth={2} />
          </button>
        </HoverTip>
        {onRetryMessage ? (
          <HoverTip label={t("actions.retry")}>
            <button
              type="button"
              className="rounded p-1 hover:bg-surface-hover hover:text-text-strong"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onRetryMessage(message)}
            >
              <RotateCcw size={14} strokeWidth={2} />
            </button>
          </HoverTip>
        ) : null}
        {onContinueFromMessage ? (
          <HoverTip label={t("actions.continueFrom")}>
            <button
              type="button"
              className="rounded p-1 hover:bg-surface-hover hover:text-text-strong"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onContinueFromMessage(message)}
            >
              <ContinueInNewTaskIcon size={14} strokeWidth={2} />
            </button>
          </HoverTip>
        ) : null}
        <HoverTip label={t("actions.select")}>
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
            <LayoutList size={14} strokeWidth={2} />
          </button>
        </HoverTip>
      </>
    ) : null;

  const chipWebRefs = webReferences.length > 0 ? webReferences : (sessionWebRefs ?? []);
  const showMetaCitation = Boolean(onOpenWorkspaceRefs) && !isUser && chipWebRefs.length > 0;
  const citationChip = showMetaCitation ? (
      <CitationSourcesCard
        references={chipWebRefs}
        onOpen={onOpenWorkspaceRefs}
        variant="meta"
      />
    ) : null;

  const assistantTurnMeta = (
    <MessageTurnMeta
      usage={message.usage}
      model={message.model}
      modelSelection={message.modelSelection}
    />
  );

  const assistantActionLine =
    assistantIconButtons ? (
      <div
        className={ASSISTANT_ACTION_LINE_CLASS}
        style={assistantActionStyle}
      >
        <div className={`${ASSISTANT_ACTION_ICON_ROW_CLASS} min-w-0`}>
          {assistantIconButtons}
        </div>
        {citationChip ? <div className="shrink-0">{citationChip}</div> : null}
        <div className={ASSISTANT_HOVER_REVEAL_CLASS}>
          {assistantTurnMeta}
          <MessageTimestamp ts={message.timestamp} align="left" />
        </div>
      </div>
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
        isGroupAssistant ? " w-full px-3" : ""
      }${
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
          aria-label={selected ? t("actions.unselectMessage") : t("actions.selectMessage")}
        >
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3.5 8.5L6.5 11.5L12.5 4.5" />
          </svg>
        </button>
      ) : null}
      {showGroupIdentityChrome ? (
        <div className="mt-[18px] shrink-0">
          <ChatImAvatar
            label={displayName}
            imageUrl={assistantAvatarUrl}
            avatarId={senderAvatarId}
            variant="circle"
            size="sm"
          />
        </div>
      ) : isGroupAssistant && clusterContinue ? (
        <div className="shrink-0" aria-hidden="true">
          <div className="h-7 w-7" />
        </div>
      ) : null}
      <MaybeConversationBubble
        active={isGroupAssistant}
        align="start"
        className={
          isGroupAssistant
            ? `items-start${assistantActionRhythmStack ? ` agx-assistant-action-rhythm mb-6 ${ASSISTANT_ACTION_RHYTHM_GAP_CLASS}` : ""}`
            : `flex min-w-0 flex-1 flex-col ${isUser ? "items-end" : "items-start"}${assistantActionRhythmStack ? ` agx-assistant-action-rhythm mb-6 ${ASSISTANT_ACTION_RHYTHM_GAP_CLASS}` : ""}`
        }
      >
        {showGroupIdentityChrome ? (
          <div className="mb-0.5 max-w-full truncate text-[12px] font-medium leading-4 text-text-faint">
            {displayName}
          </div>
        ) : null}
        {isPeerHuman && !clusterContinue ? (
          <div className="mb-0.5 max-w-full truncate text-[12px] font-medium leading-4 text-text-faint">
            {displayName}
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
          <MaybeConversationBubble
            active={isUser && showSenderIdentity}
            align="end"
            className="agx-im-user-stack"
            style={userStackStyle}
          >
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
            <MaybeConversationContent
              active={showSenderIdentity}
              className="agx-im-user-bubble agx-im-body-type relative min-w-0 max-w-full border-0 px-3.5 py-2.5 text-[var(--agx-chat-im-body-font-size)] leading-relaxed"
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
            </MaybeConversationContent>
            ) : (
              <div ref={msgContentRef} className="hidden" aria-hidden />
            )}
            {hideActions ? null : (
              <div className="agx-im-user-actions">
                <div className="agx-im-user-actions-icons">
                  <MessageTimestamp ts={message.timestamp} align="right" />
                  <HoverTip label={t("actions.copy")}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onCopyMessage?.(message)}
                    >
                      <Copy size={14} strokeWidth={2} />
                    </button>
                  </HoverTip>
                  <HoverTip label={t("actions.quote")}>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={runQuote}>
                      <Quote size={14} strokeWidth={2} />
                    </button>
                  </HoverTip>
                  <HoverTip label={t("actions.favorite")}>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={runFavorite}>
                      <Bookmark size={14} strokeWidth={2} />
                    </button>
                  </HoverTip>
                  <HoverTip label={t("actions.forward")}>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={runForward}>
                      <Forward size={14} strokeWidth={2} />
                    </button>
                  </HoverTip>
                  {onEditMessage ? (
                    <HoverTip label={t("actions.edit")}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setEditContent(message.content);
                          setIsEditing(true);
                        }}
                      >
                        <Pencil size={14} strokeWidth={2} />
                      </button>
                    </HoverTip>
                  ) : null}
                  {onRetryMessage ? (
                    <HoverTip label={t("actions.retry")}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onRetryMessage(message)}
                      >
                        <RotateCcw size={14} strokeWidth={2} />
                      </button>
                    </HoverTip>
                  ) : null}
                  <HoverTip label={t("actions.select")} tooltipAlign="end">
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
                      <LayoutList size={14} strokeWidth={2} />
                    </button>
                  </HoverTip>
                </div>
              </div>
            )}
          </MaybeConversationBubble>
        ) : (
          <>
            <MaybeConversationContent
              active={isGroupAssistant}
              className={
                compactAssistant && noBubbleBorder
                  ? `agx-im-body-type relative min-w-0 w-full px-3 py-0 text-[var(--agx-chat-im-body-font-size)] ${assistantBodyLeadingClass}`
                  : isMetaPendingWork
                    ? `agx-im-body-type relative min-w-0 w-full px-3 py-0 text-[var(--agx-chat-im-body-font-size)] ${assistantBodyLeadingClass}`
                    : isGroupAssistant
                      ? `agx-im-group-bubble agx-im-body-type relative min-w-0 px-3.5 py-2 text-[var(--agx-chat-im-body-font-size)] ${assistantBodyLeadingClass}${isStreaming ? " agx-streaming" : ""}`
                      : (message.references?.length ?? 0) > 0
                        ? `agx-im-body-type relative min-w-0 w-full px-3 pt-1 pb-0 text-[var(--agx-chat-im-body-font-size)] ${assistantBodyLeadingClass}`
                        : `agx-im-body-type relative min-w-0 w-full px-3 pt-3 pb-0 text-[var(--agx-chat-im-body-font-size)] ${assistantBodyLeadingClass}`
              }
              style={
                compactAssistant && noBubbleBorder
                  ? undefined
                  : isGroupAssistant
                    ? {
                        background: "var(--chat-im-assistant-bg)",
                        color: "var(--chat-im-assistant-text)",
                        width: "fit-content",
                        maxWidth: "100%",
                      }
                    : userBubbleStyle
              }
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
                    <div className="flex min-w-0 items-center gap-2 text-[13px]">
                      <Shimmer
                        variant="status"
                        text={bodyText.trim()}
                        className="min-w-0 break-words leading-[1.65]"
                      />
                      <StreamingDots compact />
                    </div>
                  ) : (
                    <StreamingDots compact />
                  )
                ) : (
                  <>
                    {kbReferences.length > 0 ? (
                      <ReferencesCard
                        references={kbReferences}
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
                        className={`${isGroupAssistant ? "" : assistantTextClassName ?? ""}${groupStreamActive ? " agx-stream-body" : ""}`.trim() || undefined}
                        style={assistantTextStyle}
                      >
                        {renderInlineBlocks ? (
                          <>
                            {(message.blocks ?? []).some((b) => b.type === "text")
                              ? (message.blocks ?? []).map((block, idx) =>
                                  block.type === "text" ? (
                                    block.text.trim() ? (
                                      <CitationMarkdownBody
                                        key={`text-${idx}`}
                                        content={groupStreamActive ? assistantBodyText : block.text}
                                        references={citationReferences}
                                        isStreaming={isStreaming}
                                        onQuoteText={(text) => onQuoteMessage?.(message, text)}
                                        onRevealPath={onRevealPath}
                                      />
                                    ) : null
                                  ) : (
                                    <InlineImageBlock key={block.id} block={block} gallery={imageGallery} />
                                  ),
                                )
                              : (
                                <>
                                  {assistantBodyText.trim() ? (
                                    <CitationMarkdownBody
                                      content={assistantBodyText}
                                      references={citationReferences}
                                      isStreaming={isStreaming}
                                      onQuoteText={(text) => onQuoteMessage?.(message, text)}
                                      onRevealPath={onRevealPath}
                                    />
                                  ) : null}
                                  {(message.blocks ?? [])
                                    .filter((b) => b.type === "image")
                                    .map((block) => (
                                      <InlineImageBlock key={block.id} block={block} gallery={imageGallery} />
                                    ))}
                                </>
                              )}
                          </>
                        ) : (
                          <CitationMarkdownBody
                            content={assistantBodyText}
                            references={citationReferences}
                            isStreaming={isStreaming}
                            onQuoteText={(text) => onQuoteMessage?.(message, text)}
                            onRevealPath={onRevealPath}
                          />
                        )}
                        {groupStreamActive && !streamStalled ? (
                          <span className="agx-stream-caret" aria-hidden="true" />
                        ) : null}
                      </div>
                    ) : null}
                    {isStreaming && hasBody && (!hasThinkTag || reasoningClosed) ? (
                      streamStalled ? (
                        <StalledStreamIndicator silentSeconds={streamStalledSeconds} />
                      ) : isGroupAssistant ? null : (
                        <StreamingDots compact={compactAssistant && noBubbleBorder} />
                      )
                    ) : null}
                    {!showMetaCitation && webReferences.length > 0 ? (
                      <div className="mt-2">
                        <CitationSourcesCard references={webReferences} />
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </MaybeConversationContent>
            {peeled.report ? (
              <GroupTalkReportCard
                content={peeled.report}
                onQuoteText={(text) => onQuoteMessage?.(message, text)}
                onRevealPath={onRevealPath}
              />
            ) : null}
            {afterBody ? (
              <div className="agx-artifact-action-row mt-2 flex w-full min-w-0 items-center gap-1.5 px-3">
                <div className="min-w-0 flex-1">{afterBody}</div>
                {assistantIconButtons && !showAssistantFollowups ? (
                  <div className="min-w-0 shrink-0 self-center">{assistantActionLine}</div>
                ) : null}
              </div>
            ) : null}
            {budgetIncompleteHint ? (
              <p className="-mt-0.5 mb-1 px-3 text-[11px] leading-relaxed text-text-faint">
                {t("status.budgetCut")}
              </p>
            ) : null}
            {showAssistantFollowups && assistantIconButtons ? (
              <>
                {assistantActionLine}
                <div className={ASSISTANT_FOLLOWUP_LIST_CLASS} style={assistantActionStyle}>
                  {assistantFollowupChipButtons}
                </div>
              </>
            ) : showAssistantFollowups ? (
              <div className={ASSISTANT_FOLLOWUP_LIST_CLASS} style={assistantActionStyle}>
                {assistantFollowupChipButtons}
              </div>
            ) : null}
            {hideActions || showAssistantFollowups || !assistantIconButtons || afterBody ? null : (
              <div className={actionOnlyClass}>
                {assistantActionLine}
              </div>
            )}
          </>
        )}
      </MaybeConversationBubble>
      {menuOpen ? createPortal(
        <div
          ref={menuRef}
          className="fixed z-[200] max-h-[calc(100vh-1rem)] w-44 overflow-y-auto rounded-lg border border-border bg-surface-base p-1 shadow-2xl"
          style={{
            left: menuLayout?.x ?? menuPos.x,
            top: menuLayout?.y ?? menuPos.y,
            visibility: menuLayout ? "visible" : "hidden",
          }}
          role="menu"
        >
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { void runCopy(); setMenuOpen(false); }}
          >
            <Copy size={12} className="shrink-0 text-text-faint" />{t("actions.copy")}
          </button>
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setMenuOpen(false); runQuote(); }}
          >
            <Quote size={12} className="shrink-0 text-text-faint" />{t("actions.quoteToCurrent")}
          </button>
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setMenuOpen(false); runSelectAll(); }}
          >
            <TextSelect size={12} className="shrink-0 text-text-faint" />{t("actions.selectAll")}
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
            <Search size={12} className="shrink-0 text-text-faint" />{t("actions.webSearch")}
          </button>
          {onQuoteToNewPane ? (
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setMenuOpen(false); runQuoteToNewPane(); }}
            >
              <MessageSquarePlus size={12} className="shrink-0 text-text-faint" />{t("actions.quoteToNew")}
            </button>
          ) : null}
          {!isUser && onContinueFromMessage ? (
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setMenuOpen(false); onContinueFromMessage(message); }}
            >
              <ContinueInNewTaskIcon size={12} strokeWidth={2} className="shrink-0 text-text-faint" />{t("actions.continueFrom")}
            </button>
          ) : null}
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setMenuOpen(false); runFavorite(); }}
          >
            <Bookmark size={12} className="shrink-0 text-text-faint" />{t("actions.favorite")}
          </button>
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setMenuOpen(false); runForward(); }}
          >
            <Forward size={12} className="shrink-0 text-text-faint" />{t("actions.forward")}
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
              <Pencil size={12} className="shrink-0 text-text-faint" />{t("actions.edit")}
            </button>
          ) : null}
          {onRetryMessage ? (
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setMenuOpen(false); onRetryMessage(message); }}
            >
              <RotateCcw size={12} className="shrink-0 text-text-faint" />{t("actions.retry")}
            </button>
          ) : null}
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setMenuOpen(false); onToggleSelectMessage?.(message); }}
          >
            <LayoutList size={12} className="shrink-0 text-text-faint" />{t("actions.select")}
          </button>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
