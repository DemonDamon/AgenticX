import * as React from "react";
import { Button } from "@agenticx/ui";

type InputAreaProps = {
  value: string;
  status: "idle" | "sending" | "streaming" | "error";
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
  leftToolbar?: React.ReactNode;
  rightToolbar?: React.ReactNode;
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

export function InputArea({ value, status, onChange, onSend, onCancel, leftToolbar, rightToolbar }: InputAreaProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const canSend = status !== "sending" && status !== "streaming" && value.trim().length > 0;
  const canCancel = status === "sending" || status === "streaming";

  React.useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(Math.max(element.scrollHeight, 40), 260)}px`;
  }, [value]);

  return (
    <div className="flex flex-col gap-1 rounded-3xl border border-border/80 bg-background p-2 shadow-sm transition-all duration-300 focus-within:shadow-[0_16px_40px_-12px_rgba(0,0,0,0.15)]">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={1}
        className="min-h-[40px] w-full resize-none overflow-y-auto border-0 bg-transparent px-3 pb-2 pt-2.5 text-sm leading-6 text-foreground outline-none ring-0 placeholder:text-muted-foreground/70 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
        placeholder="发送消息给 Machi..."
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          if (event.shiftKey) return;
          event.preventDefault();
          if (canSend) onSend();
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
            ) : (
              <Button onClick={onSend} disabled={!canSend} size="icon" className="h-8 w-8 rounded-full shadow-none transition-transform hover:scale-105 active:scale-95">
                <SendIcon className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

