import { useState } from "react";
import type { QueuedMessage } from "../../store";
import { QueuedMessageBubble } from "./QueuedMessageBubble";

type Props = {
  messages: QueuedMessage[];
  onEdit: (id: string, newText: string) => void;
  onRemove: (id: string) => void;
  onSendNow: (id: string) => void;
};

export function MessageQueuePanel({ messages, onEdit, onRemove, onSendNow }: Props) {
  const [expanded, setExpanded] = useState(true);
  if (messages.length === 0) return null;

  return (
    <div className="mb-2 rounded-lg border border-border/80 bg-surface-card/50">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-muted transition hover:bg-surface-hover/60"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 transition ${expanded ? "rotate-0" : "-rotate-90"}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span className="font-medium text-text-subtle">
          {messages.length} 条排队
        </span>
        <span className="text-[10px] text-text-faint">Enter 再按一次可立即发送</span>
      </button>
      {expanded ? (
        <div className="flex flex-col gap-2 border-t border-border/60 px-2 py-2">
          {messages.map((msg, index) => (
            <QueuedMessageBubble
              key={msg.id}
              msg={msg}
              index={index}
              total={messages.length}
              onEdit={onEdit}
              onRemove={onRemove}
              onSendNow={onSendNow}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
