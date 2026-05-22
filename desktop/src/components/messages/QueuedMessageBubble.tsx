import { useState, useRef, useEffect } from "react";
import type { QueuedMessage } from "../../store";

type Props = {
  msg: QueuedMessage;
  index: number;
  total: number;
  onEdit: (id: string, newText: string) => void;
  onRemove: (id: string) => void;
  onSendNow?: (id: string) => void;
};

export function QueuedMessageBubble({ msg, index, total, onEdit, onRemove, onSendNow }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.text);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const handleSave = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== msg.text) {
      onEdit(msg.id, trimmed);
    }
    setEditing(false);
  };

  return (
    <div className="group/queued flex min-h-[38px] items-center gap-2 px-3 py-1.5">
      <div className="flex h-5 w-5 shrink-0 items-center justify-center text-text-faint">
        <span className="h-2.5 w-2.5 rounded-full border border-current" />
      </div>
      {editing ? (
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-1">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSave();
              }
              if (e.key === "Escape") {
                setDraft(msg.text);
                setEditing(false);
              }
            }}
            className="min-h-[42px] w-full resize-none rounded-lg border border-border/70 bg-surface-panel/75 px-2.5 py-1.5 text-[13px] leading-relaxed text-text-primary outline-none transition focus:border-border-strong"
          />
          <div className="flex items-center gap-1.5">
            <button
              className="rounded-md px-2 py-0.5 text-[11px] text-cyan-400 transition hover:bg-surface-hover"
              onClick={handleSave}
            >
              保存
            </button>
            <button
              className="rounded-md px-2 py-0.5 text-[11px] text-text-faint transition hover:bg-surface-hover hover:text-text-muted"
              onClick={() => { setDraft(msg.text); setEditing(false); }}
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-[10px] text-text-faint">#{index + 1}</span>
              <p className="min-w-0 truncate text-[13px] leading-5 text-text-subtle">{msg.text}</p>
              {msg.attachments.length > 0 ? (
                <span className="shrink-0 text-[10px] text-text-faint">· {msg.attachments.length} 个附件</span>
              ) : null}
              {total > 1 && index === 0 ? (
                <span className="shrink-0 rounded-full bg-surface-hover px-1.5 py-0.5 text-[9px] text-text-faint">
                  下一个
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5 text-text-faint">
            <button
              className="rounded-md p-1 transition hover:bg-surface-hover hover:text-text-strong"
              onClick={() => setEditing(true)}
              title="编辑"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
            </button>
            {onSendNow ? (
              <button
                className="rounded-md p-1 transition hover:bg-surface-hover hover:text-cyan-400"
                onClick={() => onSendNow(msg.id)}
                title="立即发送（中断当前生成）"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
            ) : null}
            <button
              className="rounded-md p-1 transition hover:bg-surface-hover hover:text-rose-400"
              onClick={() => onRemove(msg.id)}
              title="移除"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
