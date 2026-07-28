import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, ChatMessageAttachment } from "@agenticx/core-api";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@agenticx/ui";
import { ReasoningBlock } from "../atoms/ReasoningBlock";
import { ToolCallCard } from "../atoms/ToolCallCard";
import { parseAssistantContent } from "../../assistant-content";
import { isNearBottom, shouldShowScrollToBottomFab } from "../../utils/scroll-near-bottom";
import {
  hasActiveTextSelection,
  shouldCancelLongPressOnMove,
  shouldStartLongPress,
} from "../../utils/message-list-selection-gesture";
import { createAssistantMdComponents } from "../../markdown/assistant-markdown-components";
import { hostnameFromUrl, siteLabelFromSource } from "../../utils/web-search-citation";
import { WebSearchFavicon } from "./WebSearchFavicon";
import { WebSearchSourcesPanel } from "./WebSearchSourcesPanel";
import { DeepResearchWorkbench } from "./DeepResearchWorkbench";
import { DeepResearchDelivery } from "./DeepResearchDelivery";
import { DeepResearchFilesPanel } from "./DeepResearchFilesPanel";
import { AttachmentContentPanel } from "./AttachmentContentPanel";
import { UserMessageAttachmentCard } from "../atoms/UserMessageAttachmentCard";
import { stripDeepResearchProgressFromContent } from "./deep-research-segments";
import { useChatStore } from "../../store";
import "../../markdown/chat-prism-themes.css";

// 内联 SVG 图标组件
function IconCopy({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
    </svg>
  );
}

function IconLink({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>
  );
}

function IconRefresh({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>
    </svg>
  );
}

function IconEdit({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 20h9"/><path d="m16.5 3.5 4 4L7 21l-4 1 1-4L16.5 3.5z"/>
    </svg>
  );
}

function IconShare({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>
    </svg>
  );
}

function IconThumbsUp({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2.73a2.43 2.43 0 0 1 3.27-.72 2.37 2.37 0 0 1 .83 3.21L15 10"/>
    </svg>
  );
}

function IconThumbsDown({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 21.27a2.43 2.43 0 0 1-3.27.72 2.37 2.37 0 0 1-.83-3.21L9 14"/>
    </svg>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

function IconListChecks({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 5h18"/><path d="M3 12h18"/><path d="M3 19h18"/><path d="m9 5 2 2 4-4"/><path d="m9 12 2 2 4-4"/><path d="m9 19 2 2 4-4"/>
    </svg>
  );
}

function IconChevronLeft({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function IconChevronRight({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function IconChevronDown({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

type ResponseVersionMeta = {
  activeIndex: number;
  total: number;
};

type MessageListProps = {
  messages: ChatMessage[];
  emptyText?: string;
  height?: number;
  className?: string;
  styleVariant?: "im" | "terminal" | "clean";
  assistantFrameless?: boolean;
  onRetry?: (messageId: string) => void;
  onUserEditResend?: (messageId: string, content: string) => void;
  responseVersionMetaByUserMessageId?: Record<string, ResponseVersionMeta>;
  retryVersionMetaByUserMessageId?: Record<string, ResponseVersionMeta>;
  onShowPreviousResponseVersion?: (userMessageId: string) => void;
  onShowNextResponseVersion?: (userMessageId: string) => void;
  onShowPreviousRetryVersion?: (userMessageId: string) => void;
  onShowNextRetryVersion?: (userMessageId: string) => void;
  onShare?: (messageId: string) => void;
  onCopy?: (content: string) => void;
  onFeedback?: (messageId: string, type: "like" | "dislike") => void;
  /** Kimi-style jump-to-bottom control when user scrolls up during streaming. */
  showScrollToBottomFab?: boolean;
  scrollToBottomLabel?: string;
  /**
   * When set, file preview is owned by the parent (docked next to chat).
   * MessageList will not render DeepResearchFilesPanel itself.
   */
  onRequestDeepResearchFiles?: (sessionId: string, focusArtifactId?: string | null) => void;
  /** When set, attachment preview is owned by the parent (docked side pane). */
  onRequestAttachmentPreview?: (attachment: ChatMessageAttachment) => void;
};

function ThinkingDotsPlaceholder() {
  return (
    <div className="inline-flex min-h-[40px] items-center gap-2 py-1">
      <span className="agx-thinking-dot h-2.5 w-2.5 rounded-full bg-muted-foreground/70" />
      <span className="agx-thinking-dot h-2.5 w-2.5 rounded-full bg-muted-foreground/70 [animation-delay:160ms]" />
      <span className="agx-thinking-dot h-2.5 w-2.5 rounded-full bg-muted-foreground/70 [animation-delay:320ms]" />
    </div>
  );
}

function AssistantMessageMarkdown({
  text,
  className,
  sources,
  sessionAttachments,
  onOpenAttachment,
  onOpenCitationInSheet,
}: {
  text: string;
  className?: string;
  sources?: ChatMessage["web_search_sources"];
  sessionAttachments?: ChatMessageAttachment[];
  onOpenAttachment?: (attachment: ChatMessageAttachment) => void;
  onOpenCitationInSheet?: (index1Based: number) => void;
}) {
  const components = React.useMemo(
    () =>
      createAssistantMdComponents({
        sources,
        sessionAttachments,
        onOpenAttachment,
        onOpenCitationInSheet,
      }),
    [sources, sessionAttachments, onOpenAttachment, onOpenCitationInSheet],
  );
  return (
    <div className={`agx-assistant-md ${className ?? ""}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function IconGlobe({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}

export function MessageList({
  messages,
  emptyText = "Start a conversation to see streaming output.",
  height,
  className,
  styleVariant = "im",
  assistantFrameless = false,
  onRetry,
  onUserEditResend,
  responseVersionMetaByUserMessageId,
  retryVersionMetaByUserMessageId,
  onShowPreviousResponseVersion,
  onShowNextResponseVersion,
  onShowPreviousRetryVersion,
  onShowNextRetryVersion,
  onShare,
  onCopy,
  onFeedback,
  showScrollToBottomFab = true,
  scrollToBottomLabel = "回到底部",
  onRequestDeepResearchFiles,
  onRequestAttachmentPreview,
}: MessageListProps) {
  const parentRef = React.useRef<HTMLDivElement>(null);
  const autoScrollPinnedRef = React.useRef(true);
  const listSessionIdForStream = messages[0]?.session_id ?? null;
  const sessionStreamBusy = useChatStore((state) => {
    if (!listSessionIdForStream) return false;
    const sessionStatus =
      state.streamStateBySessionId[listSessionIdForStream]?.status ??
      (state.activeSessionId === listSessionIdForStream ? state.status : "idle");
    return sessionStatus === "sending" || sessionStatus === "streaming";
  });
  const inFlightAssistantId = React.useMemo(() => {
    if (!sessionStreamBusy) return null;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "assistant") return messages[i]!.id;
    }
    return null;
  }, [messages, sessionStreamBusy]);
  const [showJumpToBottomFab, setShowJumpToBottomFab] = React.useState(false);
  const [selectedMessages, setSelectedMessages] = React.useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = React.useState<string | null>(null);
  const [editingDraft, setEditingDraft] = React.useState("");
  const [sourcesPanelMessageId, setSourcesPanelMessageId] = React.useState<string | null>(null);
  const [sourcesHighlightIndex, setSourcesHighlightIndex] = React.useState<number | null>(null);
  const [filesPanelSessionId, setFilesPanelSessionId] = React.useState<string | null>(null);
  const [filesPanelFocusId, setFilesPanelFocusId] = React.useState<string | null>(null);
  const [attachmentPreview, setAttachmentPreview] = React.useState<ChatMessageAttachment | null>(null);
  const longPressTimerRef = React.useRef<Map<string, NodeJS.Timeout>>(new Map());
  const activeLongPressRef = React.useRef<{ messageId: string; x: number; y: number } | null>(null);
  const LONG_PRESS_MS = 500;

  const flushJumpToBottomFab = React.useCallback(() => {
    const container = parentRef.current;
    if (!container) {
      setShowJumpToBottomFab(false);
      return;
    }
    autoScrollPinnedRef.current = isNearBottom(container);
    setShowJumpToBottomFab(showScrollToBottomFab && shouldShowScrollToBottomFab(container));
  }, [showScrollToBottomFab]);

  const listSessionId = messages[0]?.session_id ?? "";
  const prevListSessionIdRef = React.useRef(listSessionId);
  React.useEffect(() => {
    if (listSessionId !== prevListSessionIdRef.current) {
      prevListSessionIdRef.current = listSessionId;
      autoScrollPinnedRef.current = true;
    }
  }, [listSessionId]);

  React.useEffect(() => {
    const container = parentRef.current;
    if (!container) return;
    if (autoScrollPinnedRef.current) {
      container.scrollTop = container.scrollHeight;
    }
    flushJumpToBottomFab();
  }, [messages, flushJumpToBottomFab]);

  React.useEffect(() => {
    const container = parentRef.current;
    if (!container) return;
    const onScrollOrResize = () => flushJumpToBottomFab();
    container.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);
    flushJumpToBottomFab();
    return () => {
      container.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [flushJumpToBottomFab, messages.length]);

  const scrollToBottom = React.useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = parentRef.current;
    if (!container) return;
    autoScrollPinnedRef.current = true;
    container.scrollTo({ top: container.scrollHeight, behavior });
    requestAnimationFrame(() => flushJumpToBottomFab());
  }, [flushJumpToBottomFab]);

  // 清理所有长按计时器
  React.useEffect(() => {
    return () => {
      longPressTimerRef.current.forEach((timer) => clearTimeout(timer));
      longPressTimerRef.current.clear();
    };
  }, []);

  const toggleSelection = (messageId: string) => {
    setSelectedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  const handleCopy = (content: string, messageId: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(messageId);
    setTimeout(() => setCopiedId(null), 2000);
    onCopy?.(content);
  };

  const startEditMessage = (messageId: string, content: string) => {
    setEditingMessageId(messageId);
    setEditingDraft(content);
  };

  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setEditingDraft("");
  };

  const submitEditedMessage = () => {
    if (!editingMessageId) return;
    const next = editingDraft.trim();
    if (!next) return;
    onUserEditResend?.(editingMessageId, next);
    cancelEditMessage();
  };

  const selectAll = () => {
    setSelectedMessages(new Set(messages.map((m) => m.id)));
  };

  const clearSelection = () => {
    setSelectedMessages(new Set());
    setIsSelectionMode(false);
  };

  const cancelLongPress = React.useCallback((messageId: string) => {
    const timer = longPressTimerRef.current.get(messageId);
    if (timer) {
      clearTimeout(timer);
      longPressTimerRef.current.delete(messageId);
    }
    if (activeLongPressRef.current?.messageId === messageId) {
      activeLongPressRef.current = null;
    }
  }, []);

  const enterSelectionMode = React.useCallback((messageId: string) => {
    if (hasActiveTextSelection(window.getSelection()?.toString())) return;
    setIsSelectionMode(true);
    setSelectedMessages(new Set([messageId]));
  }, []);

  const scheduleLongPress = React.useCallback(
    (messageId: string, clientX: number, clientY: number) => {
      activeLongPressRef.current = { messageId, x: clientX, y: clientY };
      const timer = setTimeout(() => {
        longPressTimerRef.current.delete(messageId);
        activeLongPressRef.current = null;
        enterSelectionMode(messageId);
      }, LONG_PRESS_MS);
      longPressTimerRef.current.set(messageId, timer);
    },
    [enterSelectionMode],
  );

  const openDeepResearchFiles = React.useCallback(
    (sessionId: string, focusArtifactId?: string | null) => {
      if (onRequestDeepResearchFiles) {
        onRequestDeepResearchFiles(sessionId, focusArtifactId);
        return;
      }
      setFilesPanelSessionId(sessionId);
      setFilesPanelFocusId(focusArtifactId ?? null);
    },
    [onRequestDeepResearchFiles],
  );

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="max-w-md text-sm text-muted-foreground">{emptyText}</p>
      </div>
    );
  }

  const hostFilesPanel = !onRequestDeepResearchFiles;
  const hostAttachmentPanel = !onRequestAttachmentPreview;

  const openAttachmentPreview = React.useCallback(
    (attachment: ChatMessageAttachment) => {
      if (!attachment.parsed_text?.trim()) return;
      if (onRequestAttachmentPreview) {
        onRequestAttachmentPreview(attachment);
        return;
      }
      setAttachmentPreview(attachment);
    },
    [onRequestAttachmentPreview],
  );

  return (
    <div className={["flex h-full min-h-0 w-full", className].filter(Boolean).join(" ")}>
    <div className="relative min-h-0 min-w-0 flex-1">
      {/* 多选模式工具栏 */}
      {isSelectionMode && (
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              已选择 {selectedMessages.size} 条消息
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={selectAll} className="gap-1">
              <IconCheck className="h-4 w-4" />
              全选
            </Button>
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              取消
            </Button>
          </div>
        </div>
      )}

      <div
        ref={parentRef}
        style={height ? { height } : undefined}
        className="h-full min-h-0 overflow-y-auto px-4 sm:px-6"
      >
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 py-4">
          {messages.map((message, messageIndex) => {
            const isUser = message.role === "user";
            const isAssistant = message.role === "assistant";
            const isTerminal = styleVariant === "terminal";
            const isClean = styleVariant === "clean";
            const isSelected = selectedMessages.has(message.id);
            const parsedAssistant = isAssistant ? parseAssistantContent(message) : null;
            const rawDisplayContent = parsedAssistant
              ? parsedAssistant.displayContent
              : message.content;
            // Progress prose lives in workbench narrative segments; keep content = final report only.
            const displayContent =
              isAssistant && message.deep_research
                ? stripDeepResearchProgressFromContent(rawDisplayContent)
                : rawDisplayContent;
            const displayText = displayContent?.trim() ?? "";
            const hasVisibleContent = displayText.length > 0;
            const hasDeepResearchWorkbench = isAssistant && Boolean(message.deep_research);
            // Deep-research workbench (timeline / clarify / files) must not be replaced by bare dots.
            const showThinkingDots =
              isAssistant &&
              !hasVisibleContent &&
              !parsedAssistant?.thinkingStarted &&
              !(message.reasoning?.trim()) &&
              !hasDeepResearchWorkbench;
            const showReasoningBlock =
              isAssistant &&
              !!parsedAssistant &&
              (parsedAssistant.thinkingStarted || parsedAssistant.reasoningContent.trim().length > 0);
            const displayContentForRender =
              isAssistant && showReasoningBlock ? displayContent.replace(/^\s+/, "") : displayContent;
            const hideContentParagraph =
              isAssistant &&
              (showThinkingDots ||
                (!hasVisibleContent && showReasoningBlock) ||
                (!hasVisibleContent && hasDeepResearchWorkbench));
            const isEditingThisUserMessage = isUser && editingMessageId === message.id;
            const linkedUserMessageId = isUser
              ? message.id
              : (() => {
                  if (!isAssistant) return undefined;
                  for (let i = messageIndex - 1; i >= 0; i -= 1) {
                    if (messages[i]?.role === "user") return messages[i]?.id;
                  }
                  return undefined;
                })();
            const linkedUserMessage = linkedUserMessageId
              ? messages.find((item) => item.id === linkedUserMessageId)
              : undefined;
            const linkedUserAttachments = linkedUserMessage?.attachments?.filter(
              (item) => item.parsed_text?.trim(),
            );
            const userResponseVersionMeta = linkedUserMessageId
              ? responseVersionMetaByUserMessageId?.[linkedUserMessageId]
              : undefined;
            const hasUserResponseVersions = !!userResponseVersionMeta && userResponseVersionMeta.total > 1;
            const canShowPreviousUserVersion = !!userResponseVersionMeta && userResponseVersionMeta.activeIndex > 0;
            const canShowNextUserVersion =
              !!userResponseVersionMeta && userResponseVersionMeta.activeIndex < userResponseVersionMeta.total - 1;
            const retryVersionMeta = linkedUserMessageId ? retryVersionMetaByUserMessageId?.[linkedUserMessageId] : undefined;
            const hasRetryVersions = !!retryVersionMeta && retryVersionMeta.total > 1;
            const canShowPreviousRetryVersion = !!retryVersionMeta && retryVersionMeta.activeIndex > 0;
            const canShowNextRetryVersion = !!retryVersionMeta && retryVersionMeta.activeIndex < retryVersionMeta.total - 1;
            const deepResearchInFlight =
              isAssistant &&
              (message.deep_research?.status === "running" ||
                message.deep_research?.status === "awaiting_clarify");
            const hideMessageActions =
              deepResearchInFlight || (isAssistant && message.id === inFlightAssistantId);
            const userAttachments = isUser ? (message.attachments ?? []) : [];
            const userHasAttachments = userAttachments.length > 0;
            const userHasText = isUser && displayContentForRender.trim().length > 0;
            /** Kimi-style: file card(s) and text prompt as separate bubbles. */
            const userSplitBubbles =
              isUser && userHasAttachments && styleVariant === "im" && !isTerminal && !isClean;

            const onPointerDown = (e: React.PointerEvent) => {
              if (!shouldStartLongPress(e.pointerType)) return;
              scheduleLongPress(message.id, e.clientX, e.clientY);
            };
            const onPointerMove = (e: React.PointerEvent) => {
              const active = activeLongPressRef.current;
              if (!active || active.messageId !== message.id) return;
              if (shouldCancelLongPressOnMove(active.x, active.y, e.clientX, e.clientY)) {
                cancelLongPress(message.id);
              }
            };
            const onPointerUp = () => cancelLongPress(message.id);

            return (
              <div
                key={message.id}
                className={`group/message flex w-full ${isUser ? "justify-end" : "justify-start"}`}
                onClick={() => isSelectionMode && toggleSelection(message.id)}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
              >
                {/* 多选框 */}
                {isSelectionMode && (
                  <div className="mr-2 flex shrink-0 items-start pt-2">
                    <div
                      className={`flex h-5 w-5 items-center justify-center rounded border ${
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border"
                      }`}
                    >
                      {isSelected && <IconCheck className="h-3.5 w-3.5" />}
                    </div>
                  </div>
                )}

                {showThinkingDots ? (
                  <div
                    className={[
                      "flex w-full items-start",
                      isSelectionMode && isSelected ? "opacity-60" : "",
                    ].join(" ")}
                  >
                    <div className="min-w-0 w-full pl-1">
                      <div className="w-full">
                        <ThinkingDotsPlaceholder />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    className={[
                      "flex w-full items-start",
                      isUser ? "flex-row-reverse" : "flex-row",
                      isSelectionMode && isSelected ? "opacity-60" : "",
                    ].join(" ")}
                  >
                    <div
                      className={
                        isAssistant
                          ? "min-w-0 w-full pl-1"
                          : "min-w-0 w-full"
                      }
                    >
                      <div
                        className={[
                          userSplitBubbles
                            ? "ml-auto flex w-fit max-w-[min(90%,38rem)] flex-col items-end gap-2"
                            : "relative",
                          !userSplitBubbles && isTerminal
                            ? "flex-1 rounded-xl border border-border/70 bg-surface-subtle/45 px-4 py-3"
                            : !userSplitBubbles && isClean
                              ? "w-full rounded-2xl border border-border/70 bg-card/85 px-5 py-3 shadow-sm"
                              : !userSplitBubbles && isUser
                                ? "ml-auto block w-fit max-w-[min(90%,38rem)] rounded-[24px] bg-primary px-4 py-2.5 text-primary-foreground"
                                : !userSplitBubbles && assistantFrameless
                                  ? "w-full bg-transparent px-0 py-0 text-foreground"
                                  : !userSplitBubbles
                                    ? "w-full rounded-[24px] border border-border/40 bg-card px-5 py-3 text-card-foreground shadow-sm"
                                    : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {/* 普通对话：思考链仍在正文前。深度研究：先工作台（澄清/检索），
                            综合阶段才出现的 Thinking 必须跟在工作台之后，不能顶到最上面。 */}
                        {showReasoningBlock && parsedAssistant && !message.deep_research ? (
                          <div className={hasVisibleContent ? "mb-1.5" : ""}>
                            <ReasoningBlock
                              reasoning={parsedAssistant.reasoningContent}
                              thinkingStarted={parsedAssistant.thinkingStarted}
                              thinkingInProgress={parsedAssistant.thinkingInProgress}
                            />
                          </div>
                        ) : null}

                        {isAssistant && message.deep_research ? (
                          <DeepResearchWorkbench
                            deepResearch={message.deep_research}
                            onClarifySubmitted={(answers) => {
                              useChatStore
                                .getState()
                                .setDeepResearchClarifyAnswers(message.id, answers);
                            }}
                            onOpenArtifact={(id) => {
                              openDeepResearchFiles(message.session_id, id);
                            }}
                          />
                        ) : null}

                        {showReasoningBlock && parsedAssistant && message.deep_research ? (
                          <div className={hasVisibleContent ? "mb-1.5" : "mb-3"}>
                            <ReasoningBlock
                              reasoning={parsedAssistant.reasoningContent}
                              thinkingStarted={parsedAssistant.thinkingStarted}
                              thinkingInProgress={parsedAssistant.thinkingInProgress}
                            />
                          </div>
                        ) : null}

                        {/* 用户附件：Kimi 式分开展示（文件卡片 + 独立文本气泡） */}
                        {userSplitBubbles ? (
                          <>
                            {userAttachments.map((attachment) =>
                              attachment.mime_type.startsWith("image/") && attachment.data_url ? (
                                <img
                                  key={`${message.id}-${attachment.name}`}
                                  src={attachment.data_url}
                                  alt={attachment.name}
                                  className="max-h-40 max-w-full rounded-2xl object-cover"
                                />
                              ) : (
                                <UserMessageAttachmentCard
                                  key={`${message.id}-${attachment.name}`}
                                  attachment={attachment}
                                  onPreview={
                                    attachment.parsed_text?.trim()
                                      ? () => openAttachmentPreview(attachment)
                                      : undefined
                                  }
                                />
                              ),
                            )}
                            {userHasText ? (
                              <div className="rounded-[24px] bg-primary px-4 py-2.5 text-primary-foreground">
                                <p className="whitespace-pre-wrap break-words text-base leading-7">
                                  {displayContentForRender}
                                </p>
                              </div>
                            ) : null}
                          </>
                        ) : null}

                        {/* 用户图片/文档附件（合并在同一气泡内，非 Kimi 分栏样式） */}
                        {!userSplitBubbles && isUser && userHasAttachments ? (
                          <div className="mb-2 flex flex-wrap gap-2">
                            {message.attachments.map((attachment) =>
                              attachment.mime_type.startsWith("image/") && attachment.data_url ? (
                                <img
                                  key={`${message.id}-${attachment.name}`}
                                  src={attachment.data_url}
                                  alt={attachment.name}
                                  className="max-h-40 max-w-full rounded-xl object-cover"
                                />
                              ) : (
                                <div
                                  key={`${message.id}-${attachment.name}`}
                                  className={[
                                    "inline-flex max-w-[min(100%,320px)] items-center gap-2 rounded-xl border px-3 py-2 text-xs",
                                    isUser
                                      ? "border-primary-foreground/30 bg-primary-foreground/10"
                                      : "border-border/60 bg-muted/40",
                                  ].join(" ")}
                                >
                                  <span className="min-w-0 flex-1 truncate font-medium">
                                    {attachment.name}
                                  </span>
                                  {attachment.parsed_text?.trim() ? (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openAttachmentPreview(attachment);
                                      }}
                                      className={[
                                        "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
                                        isUser
                                          ? "bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/25"
                                          : "bg-background text-foreground hover:bg-muted",
                                      ].join(" ")}
                                    >
                                      预览
                                    </button>
                                  ) : (
                                    <span className="shrink-0 opacity-80">
                                      {attachment.kind === "video" ? "视频" : "附件"}
                                    </span>
                                  )}
                                </div>
                              ),
                            )}
                          </div>
                        ) : null}

                        {isAssistant &&
                        message.web_search_sources &&
                        message.web_search_sources.length > 0 ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSourcesPanelMessageId(message.id);
                              setSourcesHighlightIndex(null);
                            }}
                            className="mb-3 inline-flex max-w-full items-center gap-2 rounded-full border border-border/60 bg-muted/50 py-1 pl-1.5 pr-2.5 text-sm leading-5 text-foreground/80 transition-colors hover:border-border hover:bg-muted hover:text-foreground"
                          >
                            <span className="flex items-center -space-x-1.5">
                              {message.web_search_sources.slice(0, 3).map((source, idx) => {
                                const host = hostnameFromUrl(source.url) ?? "";
                                const label = siteLabelFromSource(source, idx + 1);
                                return (
                                  <span
                                    key={`${message.id}-fav-${idx}`}
                                    className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border border-background bg-background shadow-sm"
                                  >
                                    {host ? (
                                      <WebSearchFavicon
                                        host={host}
                                        label={label}
                                        size={16}
                                        rounded="full"
                                      />
                                    ) : (
                                      <IconGlobe className="h-3 w-3 text-muted-foreground" />
                                    )}
                                  </span>
                                );
                              })}
                            </span>
                            <span className="truncate font-medium">
                              搜索网页 · {message.web_search_sources.length} 个结果
                            </span>
                            <IconChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                          </button>
                        ) : null}

                        {/* 消息内容 */}
                        {!hideContentParagraph ? (
                          isAssistant ? (
                            <AssistantMessageMarkdown
                              text={displayContentForRender || "..."}
                              className={`break-words text-base leading-7 ${!message.content ? "opacity-70" : ""}`}
                              sources={message.web_search_sources}
                              sessionAttachments={linkedUserAttachments}
                              onOpenAttachment={openAttachmentPreview}
                              onOpenCitationInSheet={(index1Based) => {
                                setSourcesPanelMessageId(message.id);
                                setSourcesHighlightIndex(index1Based);
                              }}
                            />
                          ) : message.content.trim() && !userSplitBubbles ? (
                            <p
                              className={`whitespace-pre-wrap break-words text-base leading-7 ${!message.content ? "opacity-70" : ""}`}
                            >
                              {displayContentForRender}
                            </p>
                          ) : null
                        ) : null}

                        {/* 深度研究交付物：终稿 + 全部文件，放在正文之后 */}
                        {isAssistant && message.deep_research ? (
                          <DeepResearchDelivery
                            deepResearch={message.deep_research}
                            onOpenArtifact={(id) => {
                              openDeepResearchFiles(message.session_id, id);
                            }}
                            onOpenFiles={() => {
                              openDeepResearchFiles(message.session_id, null);
                            }}
                          />
                        ) : null}

                        {/* 工具调用 */}
                        {isAssistant && (
                          <div className="mt-3 space-y-2.5">
                            <ToolCallCard toolCall={message.tool_calls?.[0]} />
                          </div>
                        )}
                      </div>

                      {/* 消息操作按钮 - 移到气泡外部
                       *  不使用负外边距，避免左右边界“超出正文容器”的观感。
                       *  流式 / 深度研究进行中不展示（避免未完成就出现复制/重试/反馈）。 */}
                      {!isSelectionMode && !hideMessageActions && (
                        <div
                          className={`mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 ${
                            isUser ? "justify-end" : "justify-start -ml-1.5"
                          } ${(isUser && hasUserResponseVersions) || (isAssistant && hasRetryVersions) ? "opacity-100" : ""}`}
                        >
                          {isAssistant && hasRetryVersions && linkedUserMessageId && (
                            <>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onShowPreviousRetryVersion?.(linkedUserMessageId);
                                    }}
                                    disabled={!canShowPreviousRetryVersion}
                                  >
                                    <IconChevronLeft className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>上一版回复</TooltipContent>
                              </Tooltip>
                              <span className="min-w-[2.3rem] text-center text-sm font-medium text-muted-foreground">
                                {retryVersionMeta!.activeIndex + 1}/{retryVersionMeta!.total}
                              </span>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onShowNextRetryVersion?.(linkedUserMessageId);
                                    }}
                                    disabled={!canShowNextRetryVersion}
                                  >
                                    <IconChevronRight className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>下一版回复</TooltipContent>
                              </Tooltip>
                              <div className="mx-0.5 h-4 w-px bg-border/80" />
                            </>
                          )}

                          {/* 复制 */}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCopy(message.content || "", message.id);
                                }}
                              >
                                {copiedId === message.id ? (
                                  <IconCheck className="h-3.5 w-3.5 text-success" />
                                ) : (
                                  <IconCopy className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>复制</TooltipContent>
                          </Tooltip>

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  enterSelectionMode(message.id);
                                }}
                              >
                                <IconListChecks className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>多选</TooltipContent>
                          </Tooltip>

                          {isUser ? (
                            <>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant={isEditingThisUserMessage ? "secondary" : "ghost"}
                                    size="icon"
                                    className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      startEditMessage(message.id, message.content ?? "");
                                    }}
                                  >
                                    <IconEdit className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>编辑</TooltipContent>
                              </Tooltip>

                              {hasUserResponseVersions && (
                                <>
                                  <div className="mx-0.5 h-4 w-px bg-border/80" />
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onShowPreviousResponseVersion?.(message.id);
                                        }}
                                        disabled={!canShowPreviousUserVersion}
                                      >
                                        <IconChevronLeft className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>上一版回复</TooltipContent>
                                  </Tooltip>
                                  <span className="min-w-[2.3rem] text-center text-sm font-medium text-muted-foreground">
                                    {userResponseVersionMeta!.activeIndex + 1}/{userResponseVersionMeta!.total}
                                  </span>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onShowNextResponseVersion?.(message.id);
                                        }}
                                        disabled={!canShowNextUserVersion}
                                      >
                                        <IconChevronRight className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>下一版回复</TooltipContent>
                                  </Tooltip>
                                </>
                              )}
                            </>
                          ) : (
                            <>
                              {/* 重试 */}
                              {onRetry && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onRetry?.(message.id);
                                      }}
                                    >
                                      <IconRefresh className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>重新生成</TooltipContent>
                                </Tooltip>
                              )}

                              {/* 分享 */}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onShare?.(message.id);
                                    }}
                                  >
                                    <IconShare className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>分享</TooltipContent>
                              </Tooltip>
                            </>
                          )}

                          {/* 反馈 - 仅对助手消息 */}
                          {isAssistant && (
                            <>
                              <div className="mx-1 h-4 w-px bg-border" />
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onFeedback?.(message.id, "like");
                                    }}
                                  >
                                    <IconThumbsUp className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>有帮助</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onFeedback?.(message.id, "dislike");
                                    }}
                                  >
                                    <IconThumbsDown className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>没帮助</TooltipContent>
                              </Tooltip>
                            </>
                          )}
                        </div>
                      )}

                      {isEditingThisUserMessage && (
                        <div className="mt-2 w-full rounded-[24px] border-2 border-primary/90 bg-background px-4 py-3 shadow-sm">
                          <textarea
                            value={editingDraft}
                            onChange={(e) => setEditingDraft(e.target.value)}
                            rows={2}
                            className="w-full resize-none border-0 bg-transparent text-base leading-7 text-foreground outline-none placeholder:text-muted-foreground"
                          />
                          <div className="mt-3 flex items-center justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelEditMessage();
                              }}
                            >
                              取消
                            </Button>
                            <Button
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                submitEditedMessage();
                              }}
                              disabled={!editingDraft.trim()}
                            >
                              发送
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {showJumpToBottomFab ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 px-4 sm:px-6">
          <div className="mx-auto flex w-full max-w-4xl justify-center">
            <button
              type="button"
              className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border border-border/80 bg-background/95 text-foreground shadow-lg backdrop-blur-sm transition hover:bg-muted/80"
              aria-label={scrollToBottomLabel}
              title={scrollToBottomLabel}
              onClick={() => scrollToBottom("smooth")}
            >
              <IconChevronDown className="h-5 w-5" />
            </button>
          </div>
        </div>
      ) : null}

      {/* 底部多选操作栏 */}
      {isSelectionMode && selectedMessages.size > 0 && (
        <div className="absolute bottom-0 left-0 right-0 z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-4xl items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => {
                  const content = messages
                    .filter((m) => selectedMessages.has(m.id))
                    .map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.content}`)
                    .join("\n\n");
                  navigator.clipboard.writeText(content);
                }}
              >
                <IconCopy className="h-4 w-4" />
                复制文本
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onShare?.(Array.from(selectedMessages).join(","))}
              >
                <IconShare className="h-4 w-4" />
                分享
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              取消
            </Button>
          </div>
        </div>
      )}
      <WebSearchSourcesPanel
        open={sourcesPanelMessageId != null}
        onOpenChange={(open) => {
          if (!open) {
            setSourcesPanelMessageId(null);
            setSourcesHighlightIndex(null);
          }
        }}
        sources={
          messages.find((m) => m.id === sourcesPanelMessageId)?.web_search_sources ?? []
        }
        highlightIndex={sourcesHighlightIndex}
      />
      {hostAttachmentPanel ? (
        <AttachmentContentPanel
          open={attachmentPreview != null}
          onOpenChange={(open) => {
            if (!open) setAttachmentPreview(null);
          }}
          attachment={attachmentPreview}
        />
      ) : null}
      <style>{`
        @keyframes agx-thinking-dot-pulse {
          0%, 80%, 100% {
            opacity: 0.28;
            transform: scale(0.82);
          }
          40% {
            opacity: 0.95;
            transform: scale(1);
          }
        }
        .agx-thinking-dot {
          animation: agx-thinking-dot-pulse 1.15s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .agx-thinking-dot {
            animation: none !important;
          }
          .agx-thinking-dot {
            opacity: 0.65;
            transform: none;
          }
        }
      `}</style>
    </div>
    {hostFilesPanel ? (
      <DeepResearchFilesPanel
        open={filesPanelSessionId != null}
        onOpenChange={(open) => {
          if (!open) {
            setFilesPanelSessionId(null);
            setFilesPanelFocusId(null);
          }
        }}
        sessionId={filesPanelSessionId}
        focusArtifactId={filesPanelFocusId}
        sources={(() => {
          if (!filesPanelSessionId) return [];
          for (let i = messages.length - 1; i >= 0; i -= 1) {
            const m = messages[i];
            if (m?.session_id !== filesPanelSessionId) continue;
            if (m.web_search_sources && m.web_search_sources.length > 0) {
              return m.web_search_sources;
            }
          }
          return [];
        })()}
      />
    ) : null}
    </div>
  );
}
