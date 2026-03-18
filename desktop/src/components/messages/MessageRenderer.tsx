import type { Message } from "../../store";
import type { ReactNode } from "react";
import { UserBubble } from "./UserBubble";
import { AssistantBubble } from "./AssistantBubble";
import { ToolCallCard } from "./ToolCallCard";
import { SystemNotice } from "./SystemNotice";
import { TodoUpdateCard } from "../TodoUpdateCard";

type Props = {
  message: Message;
  assistantBadge?: ReactNode;
  onRevealPath?: (path: string) => void;
};

function extractPathFromToolResult(msg: string): string {
  const match = msg.match(/```(?:[a-zA-Z0-9_-]+)?\n([^`\n]+)\n```/);
  return (match?.[1] ?? "").trim();
}

function isTodoUpdateToolMessage(content: string): boolean {
  return content.includes("Todos have been modified successfully.");
}

export function MessageRenderer({ message, assistantBadge, onRevealPath }: Props) {
  if (message.role === "user") return <UserBubble message={message} />;
  if (message.role === "assistant") return <AssistantBubble message={message} badge={assistantBadge} />;
  if (message.role === "tool") {
    if (isTodoUpdateToolMessage(message.content)) {
      return (
        <div className="rounded-lg border border-border bg-surface-card px-3 py-2 text-xs text-text-muted">
          <TodoUpdateCard content={message.content} />
        </div>
      );
    }
    const path = extractPathFromToolResult(message.content);
    return (
      <ToolCallCard
        message={message}
        action={
          path && onRevealPath ? (
            <button
              className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-cyan-300 hover:bg-surface-hover"
              onClick={() => onRevealPath(path)}
            >
              查看此文件
            </button>
          ) : null
        }
      />
    );
  }
  return <SystemNotice text={message.content} />;
}
