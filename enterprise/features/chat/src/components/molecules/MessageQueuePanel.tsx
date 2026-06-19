import * as React from "react";
import type { QueuedMessage } from "../../types/queued-message";
import { QueuedMessageBubble } from "./QueuedMessageBubble";

type Props = {
  messages: QueuedMessage[];
  onEdit: (id: string, newText: string) => void;
  onRemove: (id: string) => void;
  onSendNow: (id: string) => void;
};

export function MessageQueuePanel({ messages, onEdit, onRemove, onSendNow }: Props) {
  const [expanded, setExpanded] = React.useState(true);
  if (messages.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-muted/25">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-muted-foreground transition hover:bg-muted/50"
        onClick={() => setExpanded((value) => !value)}
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
          aria-hidden
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span className="font-medium text-foreground/80">{messages.length} 条排队</span>
        <span className="text-[10px] text-muted-foreground">Enter 再按一次立即发送</span>
      </button>
      {expanded ? (
        <div className="flex flex-col border-t border-border/50">
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
