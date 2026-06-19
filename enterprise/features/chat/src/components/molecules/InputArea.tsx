import * as React from "react";
import { Button } from "@agenticx/ui";
import { AttachmentChip } from "../atoms/AttachmentChip";
import type { ComposerAttachment } from "../../types/composer-attachment";
import { isDoubleEnterWithinWindow } from "../../utils/message-queue";

type InputAreaProps = {
  value: string;
  status: "idle" | "sending" | "streaming" | "error";
  onChange: (value: string) => void;
  onSend: () => void;
  onForceSend?: () => void;
  onCancel: () => void;
  leftToolbar?: React.ReactNode;
  rightToolbar?: React.ReactNode;
  className?: string;
  appearance?: "default" | "portal";
  attachments?: ComposerAttachment[];
  onAddFiles?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  onPaste?: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
};

function SendIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m22 2-7 20-4-9-9-4Z"/>
      <path d="M22 2 11 13"/>
    </svg>
  );
}

function SquareIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
    </svg>
  );
}

export function InputArea({
  value,
  status,
  onChange,
  onSend,
  onForceSend,
  onCancel,
  leftToolbar,
  rightToolbar,
  className,
  appearance = "default",
  attachments = [],
  onAddFiles,
  onRemoveAttachment,
  onPaste,
}: InputAreaProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const imeComposingRef = React.useRef(false);
  const lastEnterAtRef = React.useRef(0);
  const readyCount = attachments.filter((item) => item.status === "ready").length;
  const hasContent = value.trim().length > 0 || readyCount > 0;
  const canSend = hasContent;
  const canCancel = status === "sending" || status === "streaming";
  const minTextareaHeight = appearance === "portal" ? 48 : 40;

  React.useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(Math.max(element.scrollHeight, minTextareaHeight), 260)}px`;
  }, [value, minTextareaHeight]);

  const appearanceClassName =
    appearance === "portal"
      ? "border-zinc-200/90 dark:border-zinc-700/80 focus-within:!border-indigo-600 dark:focus-within:!border-indigo-500 focus-within:shadow-[0_0_0_1px_rgba(79,70,229,0.78),0_18px_38px_-20px_rgba(79,70,229,0.45)] dark:focus-within:shadow-[0_0_0_1px_rgba(99,102,241,0.78),0_18px_38px_-20px_rgba(79,70,229,0.42)]"
      : "border-border/80 focus-within:!border-border/80 focus-within:shadow-[0_16px_40px_-12px_rgba(0,0,0,0.15)]";

  const handleDragOver = (event: React.DragEvent) => {
    if (!onAddFiles) return;
    if (event.dataTransfer?.types?.includes("Files")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    if (!onAddFiles) return;
    const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
    if (files.length === 0) return;
    event.preventDefault();
    onAddFiles(files);
  };

  return (
    <div
      className={[
        "flex flex-col gap-1 rounded-3xl border bg-background p-2 shadow-sm transition-all duration-300 focus-within:!outline-none focus-within:!ring-0 focus-within:!ring-offset-0",
        appearanceClassName,
        className ?? "",
      ].join(" ")}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-2 pt-1">
          {attachments.map((file) => (
            <AttachmentChip
              key={file.id}
              file={file}
              onRemove={() => onRemoveAttachment?.(file.id)}
            />
          ))}
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onPaste={onPaste}
        rows={1}
        className={`w-full resize-none overflow-y-auto border-0 bg-transparent px-3 pb-2 pt-2.5 text-sm leading-6 text-foreground outline-none ring-0 placeholder:text-muted-foreground/70 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 ${appearance === "portal" ? "min-h-[48px]" : "min-h-[40px]"}`}
        placeholder="发送消息给 Machi..."
        onCompositionStart={() => {
          imeComposingRef.current = true;
        }}
        onCompositionEnd={() => {
          window.setTimeout(() => {
            imeComposingRef.current = false;
          }, 0);
        }}
        onKeyDown={(event) => {
          const isImeComposing =
            event.nativeEvent.isComposing ||
            imeComposingRef.current ||
            event.key === "Process" ||
            event.keyCode === 229;
          if (isImeComposing) return;
          if (event.key !== "Enter") return;
          if (event.shiftKey) return;
          event.preventDefault();
          if (!canSend) return;
          if (canCancel) {
            if (isDoubleEnterWithinWindow(lastEnterAtRef.current)) {
              lastEnterAtRef.current = 0;
              (onForceSend ?? onSend)();
              return;
            }
            lastEnterAtRef.current = Date.now();
            onSend();
            return;
          }
          lastEnterAtRef.current = 0;
          onSend();
        }}
      />
      {(leftToolbar || rightToolbar || true) && (
        <div className="flex items-end justify-between px-1 pb-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {leftToolbar}
          </div>
          <div className="flex items-center gap-1.5 pl-2">
            {rightToolbar}
            {canCancel ? (
              <Button variant="secondary" size="icon" onClick={onCancel} className="h-8 w-8 rounded-full shadow-none">
                <SquareIcon className="h-3.5 w-3.5 fill-current" />
              </Button>
            ) : null}
            <Button
              onClick={onSend}
              disabled={!canSend}
              size="icon"
              className="h-8 w-8 rounded-full shadow-none transition-transform hover:scale-105 active:scale-95"
            >
              <SendIcon className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
