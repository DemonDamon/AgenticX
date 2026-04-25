import * as React from "react";
import type { ChatMessage } from "@agenticx/core-api";
import { Badge, MachiAvatar } from "@agenticx/ui";
import { ReasoningBlock } from "../atoms/ReasoningBlock";
import { ToolCallCard } from "../atoms/ToolCallCard";

type MessageListProps = {
  messages: ChatMessage[];
  emptyText?: string;
  height?: number;
  className?: string;
  styleVariant?: "im" | "terminal" | "clean";
};

export function MessageList({
  messages,
  emptyText = "Start a conversation to see streaming output.",
  height,
  className,
  styleVariant = "im",
}: MessageListProps) {
  const parentRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const container = parentRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages]);

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

          return (
            <div key={message.id} className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
              <div
                className={[
                  "flex items-start gap-3",
                  isUser ? "flex-row-reverse" : "flex-row",
                  isTerminal ? "w-full max-w-[min(95%,860px)]" : "max-w-[min(88%,840px)]",
                ].join(" ")}
              >
                {!isTerminal ? (
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
                    "min-w-0",
                    isTerminal
                      ? "flex-1 rounded-xl border border-border/70 bg-surface-subtle/45 px-4 py-3"
                      : isClean
                        ? "w-full rounded-2xl border border-border/70 bg-card/85 px-5 py-4 shadow-sm"
                        : isUser
                          ? "rounded-2xl rounded-tr-md bg-primary px-5 py-3.5 text-primary-foreground shadow-sm"
                          : "rounded-2xl rounded-tl-md border border-border/70 bg-card px-5 py-4 text-card-foreground shadow-sm",
                  ].join(" ")}
                >
                  <div className={`mb-2 flex items-center justify-between gap-3 ${isIm && isUser ? "sr-only" : ""}`}>
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

                  <p className={`whitespace-pre-wrap break-words text-sm leading-7 ${!message.content ? "opacity-70" : ""}`}>
                    {message.content || "..."}
                  </p>

                  {isAssistant && (
                    <div className="mt-3 space-y-2.5">
                      <ReasoningBlock reasoning={message.reasoning} />
                      <ToolCallCard toolCall={message.tool_calls?.[0]} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

