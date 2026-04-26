import * as React from "react";
import type { ChatMessage } from "@agenticx/core-api";
import { Badge, Button, MachiAvatar, Tooltip, TooltipContent, TooltipTrigger } from "@agenticx/ui";
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

type MessageListProps = {
  messages: ChatMessage[];
  emptyText?: string;
  height?: number;
  className?: string;
  styleVariant?: "im" | "terminal" | "clean";
  onRetry?: (messageId: string) => void;
  onShare?: (messageId: string) => void;
  onCopy?: (content: string) => void;
  onFeedback?: (messageId: string, type: "like" | "dislike") => void;
};

export function MessageList({
  messages,
  emptyText = "Start a conversation to see streaming output.",
  height,
  className,
  styleVariant = "im",
  onRetry,
  onShare,
  onCopy,
  onFeedback,
}: MessageListProps) {
  const parentRef = React.useRef<HTMLDivElement>(null);
  const [selectedMessages, setSelectedMessages] = React.useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
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

  const formatTime = (iso?: string) => {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  };

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
        className={`min-h-0 overflow-y-auto px-4 py-4 sm:px-6 ${className ?? ""}`}
      >
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 pb-4">
          {messages.map((message) => {
            const isUser = message.role === "user";
            const isAssistant = message.role === "assistant";
            const isTerminal = styleVariant === "terminal";
            const isClean = styleVariant === "clean";
            const isIm = styleVariant === "im";
            const isSelected = selectedMessages.has(message.id);

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

                <div
                  className={[
                    "flex items-start gap-3",
                    isUser ? "flex-row-reverse" : "flex-row",
                    isTerminal ? "w-full max-w-[min(95%,860px)]" : "max-w-[min(88%,840px)]",
                    isSelectionMode && isSelected ? "opacity-60" : "",
                  ].join(" ")}
                >
                  {!isTerminal && !(isIm && isUser) ? (
                    <div className="mt-0.5 shrink-0">
                      {isUser ? (
                        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-border/70 bg-surface-subtle text-xs font-medium text-muted-foreground">
                          U
                        </span>
                      ) : (
                        <MachiAvatar size={32} className="h-8 w-8" />
                      )}
                    </div>
                  ) : null}

                  <div
                    className={[
                      "relative min-w-0",
                      isTerminal
                        ? "flex-1 rounded-xl border border-border/70 bg-surface-subtle/45 px-4 py-3"
                        : isClean
                          ? "w-full rounded-2xl border border-border/70 bg-card/85 px-5 py-4 shadow-sm"
                          : isUser
                            ? "rounded-[24px] bg-primary px-4 py-2.5 text-primary-foreground"
                            : "rounded-[24px] border border-border/40 bg-card px-5 py-4 text-card-foreground shadow-sm",
                    ].join(" ")}
                  >
                    {/* 消息头部 */}
                    {!(isIm && isUser) && (
                      <div className="mb-2 flex items-center justify-between gap-3">
                        {isTerminal ? (
                          <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {isUser ? "YOU>" : "MACHI>"}
                          </span>
                        ) : (
                          <Badge variant={isUser ? "secondary" : "soft"} className="px-2 py-0 text-[11px]">
                            {isUser ? "你" : "Machi"}
                          </Badge>
                        )}
                        <span
                          className={`text-[11px] ${
                            isUser && !isTerminal ? "text-primary-foreground/80" : "text-muted-foreground"
                          }`}
                        >
                          {formatTime(message.created_at)}
                        </span>
                      </div>
                    )}

                    {/* 消息内容 */}
                    <p className={`whitespace-pre-wrap break-words text-sm leading-7 ${!message.content ? "opacity-70" : ""}`}>
                      {message.content || "..."}
                    </p>

                    {/* 推理和工具调用 */}
                    {isAssistant && (
                      <div className="mt-3 space-y-2.5">
                        <ReasoningBlock reasoning={message.reasoning} />
                        <ToolCallCard toolCall={message.tool_calls?.[0]} />
                      </div>
                    )}

                    {/* 消息操作按钮 - 仅在非选择模式下显示 */}
                    {!isSelectionMode && (
                      <div className="mt-3 flex items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100">
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

                        {/* 复制链接 */}
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
                              <IconLink className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>复制链接</TooltipContent>
                        </Tooltip>

                        {/* 重试 - 仅对用户消息 */}
                        {isUser && onRetry && (
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
                            <TooltipContent>重新发送</TooltipContent>
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
                  </div>
                </div>
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
                    .map((m) => `${m.role === "user" ? "用户" : "Machi"}: ${m.content}`)
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
    </div>
  );
}
