import * as React from "react";

type ReasoningBlockProps = {
  reasoning: string;
  thinkingStarted: boolean;
  thinkingInProgress: boolean;
};

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${open ? "rotate-90" : ""}`}
      aria-hidden
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function ThinkingGlyph() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className="h-[22px] w-[22px] shrink-0 text-primary"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
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

export function ReasoningBlock({ reasoning, thinkingStarted, thinkingInProgress }: ReasoningBlockProps) {
  const content = reasoning.trim();
  const [open, setOpen] = React.useState(true);
  const [tick, setTick] = React.useState(0);
  const startedAtRef = React.useRef<number | null>(null);
  const finishedAtRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!thinkingStarted) return;
    if (startedAtRef.current === null) {
      startedAtRef.current = Date.now();
      setOpen(true);
    }
    if (thinkingInProgress) {
      finishedAtRef.current = null;
      return;
    }
    if (finishedAtRef.current === null) {
      finishedAtRef.current = Date.now();
    }
  }, [thinkingStarted, thinkingInProgress]);

  React.useEffect(() => {
    if (!thinkingStarted || !thinkingInProgress) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [thinkingStarted, thinkingInProgress]);

  if (!thinkingStarted) return null;

  const startedAt = startedAtRef.current ?? Date.now();
  const finishedAt = finishedAtRef.current;
  const elapsedMs = (finishedAt ?? Date.now()) - startedAt;
  const elapsedSeconds = Math.max(1, Math.round(elapsedMs / 1000));
  const title = thinkingInProgress ? "Thinking" : `Thought for ${elapsedSeconds} seconds`;
  const showContent = open && (content.length > 0 || thinkingInProgress);

  return (
    <div className="bg-transparent text-foreground">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full max-w-full items-center justify-start px-0 py-0 text-left"
      >
        <span className="flex w-5 shrink-0 items-center justify-center">
          <ThinkingGlyph />
        </span>
        <span className="ml-2.5 flex min-w-0 flex-1 items-center gap-1">
          <span className="truncate text-[16px] font-medium text-muted-foreground">{title}</span>
          <span className="shrink-0 text-muted-foreground/80" aria-hidden>
            <Chevron open={open} />
          </span>
        </span>
      </button>
      {showContent && (
        <div className="mt-1.5 min-h-[1.25rem]">
          {content.length > 0 ? (
            <div className="flex items-stretch text-[13px] leading-[1.7] text-muted-foreground">
              {/* 左轨：固定宽度与上方图标一致，确保圆点和竖线绝对居中对齐 */}
              <div
                className="flex w-5 shrink-0 flex-col items-center pt-[0.45rem]"
                aria-hidden
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/70" />
                <div className="mt-1.5 w-px min-h-3 flex-1 bg-border/55" />
              </div>
              <p className="ml-2.5 min-w-0 flex-1 whitespace-pre-wrap break-words pb-0.5">{content}</p>
            </div>
          ) : (
            <div className="flex items-stretch text-muted-foreground">
              <div className="flex w-5 shrink-0 flex-col items-center pt-[0.45rem]" aria-hidden>
                <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/70" />
                <div className="mt-1.5 w-px min-h-4 flex-1 bg-border/55" />
              </div>
              <div className="ml-2.5 flex h-5 items-center">
                <div className="h-4 w-24 animate-pulse rounded bg-muted/70" key={tick} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

