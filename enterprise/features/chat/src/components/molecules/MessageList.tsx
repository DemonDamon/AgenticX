import * as React from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@agenticx/core-api";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@agenticx/ui";
import { ReasoningBlock } from "../atoms/ReasoningBlock";
import { ToolCallCard } from "../atoms/ToolCallCard";

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
  onShowPreviousResponseVersion?: (userMessageId: string) => void;
  onShowNextResponseVersion?: (userMessageId: string) => void;
  onShare?: (messageId: string) => void;
  onCopy?: (content: string) => void;
  onFeedback?: (messageId: string, type: "like" | "dislike") => void;
};

type ParsedAssistantContent = {
  displayContent: string;
  reasoningContent: string;
  thinkingStarted: boolean;
  thinkingInProgress: boolean;
};

function parseAssistantContent(message: ChatMessage): ParsedAssistantContent {
  const fallbackReasoning = (message.reasoning ?? "").trim();
  const raw = message.content ?? "";
  const lower = raw.toLowerCase();
  const openTag = "<think>";
  const closeTag = "</think>";
  const openIdx = lower.indexOf(openTag);

  if (openIdx < 0) {
    return {
      displayContent: raw,
      reasoningContent: fallbackReasoning,
      thinkingStarted: fallbackReasoning.length > 0,
      thinkingInProgress: false,
    };
  }

  const before = raw.slice(0, openIdx);
  const reasoningStart = openIdx + openTag.length;
  const closeIdx = lower.indexOf(closeTag, reasoningStart);

  if (closeIdx < 0) {
    return {
      displayContent: before,
      reasoningContent: raw.slice(reasoningStart),
      thinkingStarted: true,
      thinkingInProgress: true,
    };
  }

  return {
    displayContent: `${before}${raw.slice(closeIdx + closeTag.length)}`,
    reasoningContent: raw.slice(reasoningStart, closeIdx),
    thinkingStarted: true,
    thinkingInProgress: false,
  };
}

function ThinkingDotsPlaceholder() {
  return (
    <div className="inline-flex min-h-[40px] items-center gap-2 py-1">
      <span className="agx-thinking-dot h-2.5 w-2.5 rounded-full bg-muted-foreground/70" />
      <span className="agx-thinking-dot h-2.5 w-2.5 rounded-full bg-muted-foreground/70 [animation-delay:160ms]" />
      <span className="agx-thinking-dot h-2.5 w-2.5 rounded-full bg-muted-foreground/70 [animation-delay:320ms]" />
    </div>
  );
}

/** 助手主文 Markdown：GFM + 与主题 token 对齐的基础排版
 *  列表使用 list-inside，避免 marker 溢出到正文容器外造成“左侧多出一截”。 */
const ASSISTANT_MD_COMPONENTS: Components = {
  h1: ({ children }) => <h1 className="mb-2 mt-3 text-balance pl-0 text-xl font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1.5 mt-3 text-balance pl-0 text-lg font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1.5 mt-2 text-balance pl-0 text-base font-semibold first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="mb-2.5 pl-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2.5 list-inside list-disc pl-0 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2.5 list-inside list-decimal pl-0 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="mb-0.5 pl-0 [&>p]:mb-0">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
  ),
  a: ({ children, href }) => (
    <a className="font-medium text-primary underline underline-offset-2 hover:opacity-90" href={href} rel="noreferrer" target="_blank">
      {children}
    </a>
  ),
  hr: () => <hr className="my-3 border-border" />,
  table: ({ children }) => (
    <div className="my-2 max-w-full overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[280px] border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
  th: ({ children }) => <th className="border-b border-border px-3 py-2 font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b border-border/80 px-3 py-2 align-top">{children}</td>,
  code: ({ className, children, ...rest }) => {
    const isBlock = /language-/.test(className ?? "");
    if (isBlock) {
      return (
        <code className={`${className ?? ""} block`} {...rest}>
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-muted/80 px-1 py-0.5 font-mono text-[0.9em] text-foreground" {...rest}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="mb-2.5 overflow-x-auto rounded-lg border border-border/70 bg-muted/40 p-3 font-mono text-xs leading-relaxed last:mb-0">
      {children}
    </pre>
  ),
};

function AssistantMessageMarkdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={ASSISTANT_MD_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
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
  onShowPreviousResponseVersion,
  onShowNextResponseVersion,
  onShare,
  onCopy,
  onFeedback,
}: MessageListProps) {
  const parentRef = React.useRef<HTMLDivElement>(null);
  const [selectedMessages, setSelectedMessages] = React.useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = React.useState<string | null>(null);
  const [editingDraft, setEditingDraft] = React.useState("");
  const longPressTimerRef = React.useRef<Map<string, NodeJS.Timeout>>(new Map());
  const prevMessageCountRef = React.useRef(messages.length);

  // 只在消息数量增加时滚动到底部（用户发送新消息或收到新回复）
  React.useEffect(() => {
    const container = parentRef.current;
    if (!container) return;
    
    // 只有当消息数量增加时才滚动（避免浏览历史时被打断）
    if (messages.length > prevMessageCountRef.current) {
      container.scrollTop = container.scrollHeight;
    }
    prevMessageCountRef.current = messages.length;
  }, [messages]);

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

  // 长按触发多选模式
  const handleLongPress = (messageId: string) => {
    if (!isSelectionMode) {
      setIsSelectionMode(true);
      setSelectedMessages(new Set([messageId]));
    }
  };

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="max-w-md text-sm text-muted-foreground">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="relative h-full">
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
        className={`min-h-0 overflow-y-auto px-4 sm:px-6 ${className ?? ""}`}
      >
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 py-4">
          {messages.map((message, messageIndex) => {
            const isUser = message.role === "user";
            const isAssistant = message.role === "assistant";
            const isTerminal = styleVariant === "terminal";
            const isClean = styleVariant === "clean";
            const isSelected = selectedMessages.has(message.id);
            const parsedAssistant = isAssistant ? parseAssistantContent(message) : null;
            const displayContent = parsedAssistant ? parsedAssistant.displayContent : message.content;
            const displayText = displayContent?.trim() ?? "";
            const hasVisibleContent = displayText.length > 0;
            const showThinkingDots =
              isAssistant &&
              !hasVisibleContent &&
              !parsedAssistant?.thinkingStarted &&
              !(message.reasoning?.trim());
            const showReasoningBlock =
              isAssistant &&
              !!parsedAssistant &&
              (parsedAssistant.thinkingStarted || parsedAssistant.reasoningContent.trim().length > 0);
            const displayContentForRender =
              isAssistant && showReasoningBlock ? displayContent.replace(/^\s+/, "") : displayContent;
            const hideContentParagraph = isAssistant && (showThinkingDots || (!hasVisibleContent && showReasoningBlock));
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
            const responseVersionMeta = linkedUserMessageId ? responseVersionMetaByUserMessageId?.[linkedUserMessageId] : undefined;
            const hasResponseVersions = !!responseVersionMeta && responseVersionMeta.total > 1;
            const canShowPreviousVersion = !!responseVersionMeta && responseVersionMeta.activeIndex > 0;
            const canShowNextVersion =
              !!responseVersionMeta && responseVersionMeta.activeIndex < responseVersionMeta.total - 1;

            // 使用 ref 存储每个消息的长按计时器
            const onPointerDown = () => {
              const timer = setTimeout(() => handleLongPress(message.id), 500);
              longPressTimerRef.current.set(message.id, timer);
            };
            const onPointerUp = () => {
              const timer = longPressTimerRef.current.get(message.id);
              if (timer) {
                clearTimeout(timer);
                longPressTimerRef.current.delete(message.id);
              }
            };

            return (
              <div
                key={message.id}
                className={`group/message flex w-full ${isUser ? "justify-end" : "justify-start"}`}
                onClick={() => isSelectionMode && toggleSelection(message.id)}
                onPointerDown={onPointerDown}
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
                          "relative",
                          isTerminal
                            ? "flex-1 rounded-xl border border-border/70 bg-surface-subtle/45 px-4 py-3"
                            : isClean
                              ? "w-full rounded-2xl border border-border/70 bg-card/85 px-5 py-3 shadow-sm"
                              : isUser
                                ? "ml-auto block w-fit max-w-[min(90%,38rem)] rounded-[24px] bg-primary px-4 py-2.5 text-primary-foreground"
                              : assistantFrameless
                                ? "w-full bg-transparent px-0 py-0 text-foreground"
                                : "w-full rounded-[24px] border border-border/40 bg-card px-5 py-3 text-card-foreground shadow-sm",
                        ].join(" ")}
                      >
                        {showReasoningBlock && parsedAssistant ? (
                          <div className={hasVisibleContent ? "mb-1.5" : ""}>
                            <ReasoningBlock
                              reasoning={parsedAssistant.reasoningContent}
                              thinkingStarted={parsedAssistant.thinkingStarted}
                              thinkingInProgress={parsedAssistant.thinkingInProgress}
                            />
                          </div>
                        ) : null}

                        {/* 消息内容 */}
                        {!hideContentParagraph ? (
                          isAssistant ? (
                            <AssistantMessageMarkdown
                              text={displayContentForRender || "..."}
                              className={`break-words text-base leading-7 ${!message.content ? "opacity-70" : ""}`}
                            />
                          ) : (
                            <p
                              className={`whitespace-pre-wrap break-words text-base leading-7 ${!message.content ? "opacity-70" : ""}`}
                            >
                              {displayContentForRender || "..."}
                            </p>
                          )
                        ) : null}

                        {/* 工具调用 */}
                        {isAssistant && (
                          <div className="mt-3 space-y-2.5">
                            <ToolCallCard toolCall={message.tool_calls?.[0]} />
                          </div>
                        )}
                      </div>

                      {/* 消息操作按钮 - 移到气泡外部
                       *  不使用负外边距，避免左右边界“超出正文容器”的观感。 */}
                      {!isSelectionMode && (
                        <div
                          className={`mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 ${
                            isUser ? "justify-end" : "justify-start -ml-1.5"
                          } ${(isUser || isAssistant) && hasResponseVersions ? "opacity-100" : ""}`}
                        >
                          {isAssistant && hasResponseVersions && linkedUserMessageId && (
                            <>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onShowPreviousResponseVersion?.(linkedUserMessageId);
                                    }}
                                    disabled={!canShowPreviousVersion}
                                  >
                                    <IconChevronLeft className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>上一版回复</TooltipContent>
                              </Tooltip>
                              <span className="min-w-[2.3rem] text-center text-sm font-medium text-muted-foreground">
                                {responseVersionMeta!.activeIndex + 1}/{responseVersionMeta!.total}
                              </span>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onShowNextResponseVersion?.(linkedUserMessageId);
                                    }}
                                    disabled={!canShowNextVersion}
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

                              {hasResponseVersions && (
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
                                        disabled={!canShowPreviousVersion}
                                      >
                                        <IconChevronLeft className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>上一版回复</TooltipContent>
                                  </Tooltip>
                                  <span className="min-w-[2.3rem] text-center text-sm font-medium text-muted-foreground">
                                    {responseVersionMeta!.activeIndex + 1}/{responseVersionMeta!.total}
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
                                        disabled={!canShowNextVersion}
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
                                        if (linkedUserMessageId) {
                                          const linkedUserMessage = messages.find(
                                            (candidate) => candidate.id === linkedUserMessageId && candidate.role === "user",
                                          );
                                          if (linkedUserMessage?.content?.trim()) {
                                            onUserEditResend?.(linkedUserMessageId, linkedUserMessage.content);
                                            return;
                                          }
                                        }
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
  );
}
