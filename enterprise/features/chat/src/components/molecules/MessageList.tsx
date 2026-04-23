import * as React from "react";
import type { ChatMessage } from "@agenticx/core-api";
import { Card, CardContent, CardHeader, CardTitle } from "@agenticx/ui";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ReasoningBlock } from "../atoms/ReasoningBlock";
import { ToolCallCard } from "../atoms/ToolCallCard";

type MessageListProps = {
  messages: ChatMessage[];
  emptyText?: string;
  height?: number;
};

export function MessageList({ messages, emptyText = "Start a conversation to see streaming output.", height = 440 }: MessageListProps) {
  const parentRef = React.useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 150,
    overscan: 4,
  });

  if (messages.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{emptyText}</p>;
  }

  return (
    <div ref={parentRef} style={{ height }} className="overflow-auto">
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const message = messages[virtualRow.index];
          if (!message) return null;

          return (
            <div
              key={message.id}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
                paddingBottom: "8px",
              }}
            >
              <Card>
                <CardHeader className="p-3 pb-1">
                  <CardTitle className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    {message.role}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 p-3 pt-0 text-sm whitespace-pre-wrap">
                  <p>{message.content || "..."}</p>
                  {message.role === "assistant" && (
                    <>
                      <ReasoningBlock reasoning={message.reasoning} />
                      <ToolCallCard toolCall={message.tool_calls?.[0]} />
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}

