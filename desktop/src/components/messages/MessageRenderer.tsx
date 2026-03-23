import type { Message } from "../../store";
import type { ReactNode } from "react";
import { useAppStore } from "../../store";
import { ImBubble } from "./ImBubble";
import { TerminalLine } from "./TerminalLine";
import { CleanBlock } from "./CleanBlock";
import { ToolCallCard } from "./ToolCallCard";
import { SystemNotice } from "./SystemNotice";
import { TodoUpdateCard } from "../TodoUpdateCard";

type Props = {
  message: Message;
  assistantBadge?: ReactNode;
  onRevealPath?: (path: string) => void;
  assistantName?: string;
  assistantAvatarUrl?: string;
  /** IM 风格下用户气泡旁显示名（默认「我」） */
  userName?: string;
  onCopyMessage?: (message: Message) => void;
  onQuoteMessage?: (message: Message) => void;
  onFavoriteMessage?: (message: Message) => void;
  onToggleSelectMessage?: (message: Message) => void;
  onForwardMessage?: (message: Message) => void;
  onRetryMessage?: (message: Message) => void;
  selectable?: boolean;
  selected?: boolean;
  onResolveInlineConfirm?: (confirm: NonNullable<Message["inlineConfirm"]>, approved: boolean) => void;
};

function extractPathFromToolResult(msg: string): string {
  const match = msg.match(/```(?:[a-zA-Z0-9_-]+)?\n([^`\n]+)\n```/);
  return (match?.[1] ?? "").trim();
}

function isTodoUpdateToolMessage(content: string): boolean {
  return content.includes("Todos have been modified successfully.");
}

export function MessageRenderer({
  message,
  assistantBadge,
  onRevealPath,
  assistantName,
  assistantAvatarUrl,
  userName,
  onCopyMessage,
  onQuoteMessage,
  onFavoriteMessage,
  onToggleSelectMessage,
  onForwardMessage,
  onRetryMessage,
  selectable,
  selected,
  onResolveInlineConfirm,
}: Props) {
  const chatStyle = useAppStore((s) => s.chatStyle);
  if (message.role === "user" || message.role === "assistant") {
    if (chatStyle === "terminal") return <TerminalLine message={message} badge={assistantBadge} />;
    if (chatStyle === "clean") return <CleanBlock message={message} badge={assistantBadge} />;
    return (
      <ImBubble
        message={message}
        badge={assistantBadge}
        assistantName={message.avatarName || assistantName}
        assistantAvatarUrl={message.avatarUrl || assistantAvatarUrl}
        userName={userName}
        onCopyMessage={onCopyMessage}
        onQuoteMessage={onQuoteMessage}
        onFavoriteMessage={onFavoriteMessage}
        onToggleSelectMessage={onToggleSelectMessage}
        onForwardMessage={onForwardMessage}
        onRetryMessage={onRetryMessage}
        selectable={selectable}
        selected={selected}
      />
    );
  }
  if (message.role === "tool") {
    if (isTodoUpdateToolMessage(message.content)) {
      return (
        <div className="rounded-lg border border-border bg-surface-card px-3 py-2 text-xs text-text-muted">
          <TodoUpdateCard content={message.content} />
        </div>
      );
    }
    const inlineConfirm = message.inlineConfirm;
    const inlineConfirmAction =
      inlineConfirm && onResolveInlineConfirm ? (
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            className="rounded border border-border bg-surface-hover px-2 py-0.5 text-[11px] text-text-strong hover:opacity-90"
            onClick={() => onResolveInlineConfirm(inlineConfirm, true)}
          >
            同意
          </button>
          <button
            type="button"
            className="rounded border border-border bg-surface-hover px-2 py-0.5 text-[11px] text-text-strong hover:opacity-90"
            onClick={() => onResolveInlineConfirm(inlineConfirm, false)}
          >
            拒绝
          </button>
        </div>
      ) : null;
    const path = extractPathFromToolResult(message.content);
    return (
      <ToolCallCard
        message={message}
        action={
          <>
            {inlineConfirmAction}
            {path && onRevealPath ? (
              <button
                className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-cyan-300 hover:bg-surface-hover"
                onClick={() => onRevealPath(path)}
              >
                查看此文件
              </button>
            ) : null}
          </>
        }
      />
    );
  }
  return <SystemNotice text={message.content} />;
}
