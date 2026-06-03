import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchReference } from "../../types/search-references";
import { CitationPopover } from "./CitationPopover";

type Props = {
  id: number;
  reference?: SearchReference;
};

const HOVER_OPEN_MS = 150;
const HOVER_CLOSE_MS = 120;

export function CitationBadge({ id, reference }: Props) {
  const [open, setOpen] = useState(false);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolved = Boolean(reference);
  const isKb = reference?.source === "kb" || (reference?.url ?? "").startsWith("agx://kb/");

  const clearTimers = useCallback(() => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    openTimerRef.current = null;
    closeTimerRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const scheduleOpen = () => {
    clearTimers();
    closeTimerRef.current = null;
    openTimerRef.current = setTimeout(() => setOpen(true), HOVER_OPEN_MS);
  };

  const scheduleClose = () => {
    clearTimers();
    openTimerRef.current = null;
    closeTimerRef.current = setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
  };

  const pillStyle = isKb
    ? {
        backgroundColor: resolved ? "var(--kb-citation-bg)" : "var(--kb-citation-bg-muted)",
        color: "var(--kb-citation-fg)",
      }
    : resolved
      ? {
          backgroundColor: "rgba(var(--theme-color-rgb,6,182,212),0.18)",
          color: "var(--text-subtle)",
        }
      : {
          backgroundColor: "var(--kb-citation-bg-muted, rgba(0,0,0,0.06))",
          color: "var(--text-faint)",
        };

  return (
    <span
      className="relative inline-flex align-baseline"
      onMouseEnter={resolved ? scheduleOpen : undefined}
      onMouseLeave={resolved ? scheduleClose : undefined}
    >
      <button
        type="button"
        className={`mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] px-1 text-[11px] font-medium leading-none tabular-nums transition-opacity ${
          resolved ? "cursor-pointer hover:opacity-90" : "cursor-default opacity-70"
        }`}
        style={pillStyle}
        aria-label={resolved ? `引用 ${id}: ${reference!.title}` : `引用 ${id}`}
        aria-expanded={open}
        onClick={() => {
          if (!resolved) return;
          setOpen((v) => !v);
        }}
      >
        {id}
      </button>
      {open && reference ? (
        <div
          className="absolute bottom-full left-1/2 z-[81] mb-1.5 -translate-x-1/2"
          onMouseEnter={scheduleOpen}
          onMouseLeave={scheduleClose}
        >
          <CitationPopover reference={reference} onClose={() => setOpen(false)} />
        </div>
      ) : null}
    </span>
  );
}
