import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

type Props = {
  text: string;
  streaming?: boolean;
};

function ThinkingGlyph() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className="h-[22px] w-[22px] shrink-0 text-[rgb(var(--theme-color-rgb,59,130,246))]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <ellipse cx="12" cy="12" rx="8.8" ry="4.8" transform="rotate(45 12 12)" />
      <ellipse cx="12" cy="12" rx="8.8" ry="4.8" transform="rotate(-45 12 12)" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ReasoningBlock({ text, streaming = false }: Props) {
  const content = text.trim();
  const [open, setOpen] = React.useState(true);
  const [tick, setTick] = React.useState(0);
  const startedAtRef = React.useRef<number | null>(null);
  const finishedAtRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (startedAtRef.current === null) {
      startedAtRef.current = Date.now();
      setOpen(true);
    }
    if (streaming) {
      finishedAtRef.current = null;
      return;
    }
    if (finishedAtRef.current === null) {
      finishedAtRef.current = Date.now();
      setOpen(false); // Auto-collapse when finished
    }
  }, [streaming]);

  React.useEffect(() => {
    if (!streaming) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [streaming]);

  const startedAt = startedAtRef.current ?? Date.now();
  const finishedAt = finishedAtRef.current;
  const elapsedMs = (finishedAt ?? Date.now()) - startedAt;
  const elapsedSeconds = Math.max(1, Math.round(elapsedMs / 1000));
  const title = streaming ? "Thinking" : `Thought for ${elapsedSeconds} seconds`;
  const showContent = open && (content.length > 0 || streaming);

  return (
    <div className="bg-transparent text-text-primary">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full max-w-full items-center justify-start gap-2 px-0 py-1 text-left"
      >
        <span className="flex w-[20px] shrink-0 items-center justify-center">
          <ThinkingGlyph />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <span className="truncate text-[13px] font-medium text-text-subtle">{title}</span>
          <span className="shrink-0" aria-hidden>
            {open ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2} />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2} />
            )}
          </span>
        </span>
      </button>
      {showContent && (
        <div className="relative mt-1.5 pb-2">
          <div
            className="pointer-events-none absolute left-[10px] top-0 bottom-2 z-0 w-0 border-l border-dashed border-border"
            aria-hidden
          />
          <div className="relative z-[1]">
            <div
              className="pointer-events-none absolute left-[10px] top-[8px] z-[2] h-2 w-2 -translate-x-1/2 rounded-full border-2 border-surface-card bg-border"
              aria-hidden
            />
            <div className="pl-[28px] text-[13px] leading-[1.7] text-text-subtle">
              {content.length > 0 ? (
                <p className="whitespace-pre-wrap break-words">{content}</p>
              ) : (
                <div className="flex h-5 items-center">
                  <div className="h-4 w-24 animate-pulse rounded bg-surface-hover" key={tick} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
