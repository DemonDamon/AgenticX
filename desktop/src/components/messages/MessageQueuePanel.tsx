import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { QueuedMessage } from "../../store";
import { QueuedMessageBubble } from "./QueuedMessageBubble";

type Props = {
  messages: QueuedMessage[];
  otherSessionCount?: number;
  persistenceFailed?: boolean;
  onEdit: (id: string, newText: string) => void;
  onRemove: (id: string) => void;
  onSendNow: (id: string) => void;
};

export function MessageQueuePanel({
  messages,
  otherSessionCount = 0,
  persistenceFailed = false,
  onEdit,
  onRemove,
  onSendNow,
}: Props) {
  const { t } = useTranslation("chat");
  const [expanded, setExpanded] = useState(true);
  if (messages.length === 0 && otherSessionCount === 0 && !persistenceFailed) return null;

  return (
    <div className="mb-1 flex flex-col gap-1">
      {otherSessionCount > 0 ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-border/45 bg-surface-panel/45 px-3 py-2 text-[11px] leading-relaxed text-text-muted"
        >
          {t("queue.otherSession", { count: otherSessionCount })}
        </div>
      ) : null}
      {persistenceFailed && (messages.length > 0 || otherSessionCount > 0) ? (
        <div
          role="alert"
          className="rounded-xl border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-[11px] leading-relaxed text-amber-200"
        >
          {t("queue.persistenceFailed")}
        </div>
      ) : null}
      {messages.length > 0 ? (
        <div className="overflow-hidden rounded-xl bg-surface-panel/30">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-text-muted transition hover:bg-surface-hover/25"
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
              className={`shrink-0 text-text-faint transition ${expanded ? "rotate-0" : "-rotate-90"}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            <span className="font-medium text-text-muted">
              {t("queue.count", { count: messages.length })}
            </span>
            <span className="text-[10px] text-text-faint">{t("queue.doubleEnterHint")}</span>
          </button>
          {expanded ? (
            <div className="flex flex-col">
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
      ) : null}
    </div>
  );
}
