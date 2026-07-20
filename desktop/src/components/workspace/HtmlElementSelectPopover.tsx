import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CornerDownLeft, MessageSquarePlus, Sparkles } from "lucide-react";
import type { SelectionPopupAnchor } from "./selection-quote-popover";

type HtmlElementSelectPopoverProps = {
  anchor: SelectionPopupAnchor;
  tagName: string;
  onAddToChat: () => void;
  /** Trae：打开就地评论框，提交后带评论进对话. */
  onCommentToChat: (comment: string) => void;
};

/**
 * Trae-style floating actions after selecting an HTML element in preview.
 * Enter → 添加到对话；⌘/Ctrl+J → 打开评论输入；评论框内 Enter → 评论到对话.
 */
export function HtmlElementSelectPopover({
  anchor,
  tagName,
  onAddToChat,
  onCommentToChat,
}: HtmlElementSelectPopoverProps) {
  const [mode, setMode] = useState<"toolbar" | "comment">("toolbar");
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (mode !== "comment") return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [mode]);

  useEffect(() => {
    if (mode !== "toolbar") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        onAddToChat();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        setMode("comment");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [mode, onAddToChat]);

  const submitComment = () => {
    const text = draft.trim();
    if (!text) return;
    onCommentToChat(text);
  };

  if (mode === "comment") {
    return createPortal(
      <div
        role="dialog"
        aria-label={`评论 ${tagName}`}
        className="fixed z-[100] w-[min(320px,calc(100vw-24px))] -translate-x-1/2 rounded-xl border border-border bg-surface-popover p-3 shadow-xl"
        style={{
          top: anchor.top,
          left: anchor.left,
          // Force opaque panel (theme tokens may be translucent).
          backgroundColor: "var(--surface-popover, var(--surface-card, #fff))",
          opacity: 1,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <textarea
          ref={inputRef}
          value={draft}
          rows={3}
          placeholder="输入你的评论..."
          className="min-h-[72px] w-full resize-none rounded-lg border border-border bg-surface-base px-3 py-2 text-[13px] text-text-strong outline-none placeholder:text-text-faint focus:border-[var(--ui-btn-primary-border,#3b82f6)]"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setMode("toolbar");
              setDraft("");
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
              e.preventDefault();
              submitComment();
            }
          }}
        />
        <div className="mt-2.5 flex items-center justify-end gap-2">
          <button
            type="button"
            className="h-8 rounded-lg border border-border bg-surface-hover px-3 text-[12px] text-text-strong transition-colors hover:bg-surface-card-strong"
            onClick={() => {
              setMode("toolbar");
              setDraft("");
            }}
          >
            取消
          </button>
          <button
            type="button"
            disabled={!draft.trim()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-text-strong px-3 text-[12px] font-medium text-surface-base transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            onClick={submitComment}
          >
            评论到对话
            <CornerDownLeft className="h-3.5 w-3.5 opacity-80" strokeWidth={2} />
          </button>
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div
      role="toolbar"
      aria-label={`已选中 ${tagName}`}
      className="fixed z-[100] flex h-8 -translate-x-1/2 items-center gap-0 overflow-hidden rounded-full border border-border shadow-lg"
      style={{
        top: anchor.top,
        left: anchor.left,
        // Opaque Trae-style capsule (avoid translucent surface tokens).
        backgroundColor: "var(--surface-popover, var(--surface-card, #1c1c1e))",
        opacity: 1,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className="inline-flex h-full items-center gap-1.5 px-3 text-[11px] font-medium text-text-strong transition-colors hover:bg-black/5 dark:hover:bg-white/10"
        onClick={() => setMode("comment")}
      >
        <Sparkles className="h-3.5 w-3.5 text-emerald-500" strokeWidth={1.8} />
        评论到对话
        <span className="text-text-faint">⌘J</span>
      </button>
      <div className="h-4 w-px shrink-0 bg-border" />
      <button
        type="button"
        className="inline-flex h-full items-center gap-1.5 px-3 text-[11px] font-medium text-text-strong transition-colors hover:bg-black/5 dark:hover:bg-white/10"
        onClick={onAddToChat}
      >
        <MessageSquarePlus className="h-3.5 w-3.5 text-text-muted" strokeWidth={1.8} />
        添加到对话
        <span className="text-text-faint">↵</span>
      </button>
    </div>,
    document.body
  );
}
