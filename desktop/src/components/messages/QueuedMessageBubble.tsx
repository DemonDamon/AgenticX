import { useState, useRef, useEffect } from "react";
import type { QueuedMessage } from "../../store";

type Props = {
  msg: QueuedMessage;
  index: number;
  total: number;
  onEdit: (id: string, newText: string) => void;
  onRemove: (id: string) => void;
};

export function QueuedMessageBubble({ msg, index, total, onEdit, onRemove }: Props) {
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
    <div className="group/queued relative ml-8 flex items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-1.5 text-[10px] text-text-faint">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span>排队中 #{index + 1}/{total}</span>
          {msg.attachments.length > 0 && (
            <span className="text-text-faint">· {msg.attachments.length} 个附件</span>
          )}
        </div>
        {editing ? (
          <div className="flex flex-col gap-1">
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
              className="min-h-[48px] w-full resize-none rounded-lg border border-border bg-surface-panel px-2.5 py-1.5 text-[15px] leading-relaxed text-text-primary outline-none focus:border-border-strong"
            />
            <div className="flex gap-1.5">
              <button
                className="rounded px-2 py-0.5 text-[11px] text-cyan-400 transition hover:bg-surface-hover"
                onClick={handleSave}
              >
                保存
              </button>
              <button
                className="rounded px-2 py-0.5 text-[11px] text-text-faint transition hover:bg-surface-hover"
                onClick={() => { setDraft(msg.text); setEditing(false); }}
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <div className="min-w-0 overflow-hidden rounded-xl rounded-tr-sm border border-dashed border-border bg-surface-card/60 px-3 py-2 text-[15px] leading-relaxed text-text-subtle">
            <p className="whitespace-pre-wrap break-words">{msg.text}</p>
          </div>
        )}
      </div>
      {!editing && (
        <div className="flex shrink-0 flex-col gap-0.5 pt-4 opacity-0 transition group-hover/queued:opacity-100">
          <button
            className="rounded p-1 text-text-faint transition hover:bg-surface-hover hover:text-text-strong"
            onClick={() => setEditing(true)}
            title="编辑"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>
          <button
            className="rounded p-1 text-text-faint transition hover:bg-surface-hover hover:text-rose-400"
            onClick={() => onRemove(msg.id)}
            title="移除"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
