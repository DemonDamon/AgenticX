import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ASSISTANT_ICON_RAIL_CLASS, REACT_RAIL_ICON_CLASS, REACT_RAIL_TITLE_CLASS } from "./im-layout";
import {
  formatReasoningTitle,
  getCachedReasoningDuration,
  measureReasoningSeconds,
  setCachedReasoningDuration,
} from "./reasoning-duration-cache";

type Props = {
  text: string;
  streaming?: boolean;
  /** Persisted reasoning duration in seconds; takes priority over the streaming timer. */
  seconds?: number;
};

function ThinkingGlyph() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className={`h-[18px] w-[18px] shrink-0 ${REACT_RAIL_ICON_CLASS}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <ellipse cx="12" cy="12" rx="9.2" ry="5.1" transform="rotate(45 12 12)" />
      <ellipse cx="12" cy="12" rx="9.2" ry="5.1" transform="rotate(-45 12 12)" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function persistReasoningDuration(content: string, startedAt: number, finishedAt: number): number {
  const seconds = measureReasoningSeconds(startedAt, finishedAt);
  setCachedReasoningDuration(content, seconds);
  return seconds;
}

export function ReasoningBlock({ text, streaming = false, seconds }: Props) {
  const content = text.trim();
  const [open, setOpen] = React.useState(streaming);
  const [tick, setTick] = React.useState(0);
  const startedAtRef = React.useRef<number | null>(null);
  const finishedAtRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (streaming) {
      if (startedAtRef.current === null) {
        startedAtRef.current = Date.now();
      }
      finishedAtRef.current = null;
      setOpen(true);
      return;
    }
    if (startedAtRef.current !== null && finishedAtRef.current === null) {
      finishedAtRef.current = Date.now();
      persistReasoningDuration(content, startedAtRef.current, finishedAtRef.current);
      setOpen(false);
    }
  }, [streaming, content]);

  React.useEffect(() => {
    if (!streaming) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [streaming]);

  React.useEffect(() => {
    return () => {
      const startedAt = startedAtRef.current;
      if (startedAt === null || !content) return;
      const finishedAt = finishedAtRef.current ?? Date.now();
      persistReasoningDuration(content, startedAt, finishedAt);
    };
  }, [content]);

  void tick;

  const cachedSeconds = getCachedReasoningDuration(content);
  const startedAt = startedAtRef.current;
  const finishedAt = finishedAtRef.current;

  let elapsedSeconds = 0;
  let hasReliableDuration = false;

  // Persisted duration (from disk / finalize merge) wins for non-streaming
  // rows so a reloaded or just-completed turn shows the same seconds as the
  // original run instead of falling back to the in-memory streaming timer.
  if (!streaming && typeof seconds === "number" && seconds >= 1) {
    elapsedSeconds = seconds;
    hasReliableDuration = true;
  } else if (streaming && startedAt !== null) {
    elapsedSeconds = measureReasoningSeconds(startedAt, Date.now());
    hasReliableDuration = true;
  } else if (cachedSeconds !== undefined) {
    elapsedSeconds = cachedSeconds;
    hasReliableDuration = true;
  } else if (startedAt !== null && finishedAt !== null && finishedAt - startedAt >= 500) {
    elapsedSeconds = measureReasoningSeconds(startedAt, finishedAt);
    hasReliableDuration = true;
  }

  const title = formatReasoningTitle({ streaming, elapsedSeconds, hasReliableDuration });
  const showContent = open && (content.length > 0 || streaming);

  return (
    <div className="bg-transparent text-text-primary">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full max-w-full items-center justify-start gap-2 px-0 py-1 text-left"
      >
        <span className={ASSISTANT_ICON_RAIL_CLASS}>
          <ThinkingGlyph />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <span className={`truncate ${REACT_RAIL_TITLE_CLASS}`}>{title}</span>
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
