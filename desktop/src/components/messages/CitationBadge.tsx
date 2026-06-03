import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SearchReference } from "../../types/search-references";
import { CitationPopover } from "./CitationPopover";

type Props = {
  id: number;
  reference?: SearchReference;
};

const HOVER_OPEN_MS = 150;
const HOVER_CLOSE_MS = 120;
const POPOVER_WIDTH = 320;
const POPOVER_ESTIMATE_HEIGHT = 200;
const VIEWPORT_MARGIN = 8;
const POPOVER_GAP = 6;

type PopoverPlacement = {
  top: number;
  left: number;
  placeAbove: boolean;
};

function computePopoverPlacement(anchor: DOMRect): PopoverPlacement {
  const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN);
  let left = anchor.left + anchor.width / 2 - POPOVER_WIDTH / 2;
  left = Math.min(maxLeft, Math.max(VIEWPORT_MARGIN, left));

  const spaceAbove = anchor.top - VIEWPORT_MARGIN;
  const spaceBelow = window.innerHeight - anchor.bottom - VIEWPORT_MARGIN;
  const placeAbove =
    spaceAbove >= POPOVER_ESTIMATE_HEIGHT + POPOVER_GAP ||
    spaceAbove >= spaceBelow;

  const top = placeAbove
    ? Math.max(VIEWPORT_MARGIN, anchor.top - POPOVER_GAP - POPOVER_ESTIMATE_HEIGHT)
    : Math.min(
        window.innerHeight - VIEWPORT_MARGIN - POPOVER_ESTIMATE_HEIGHT,
        anchor.bottom + POPOVER_GAP,
      );

  return { top, left, placeAbove };
}

export function CitationBadge({ id, reference }: Props) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<PopoverPlacement | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
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

  const updatePlacement = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    setPlacement(computePopoverPlacement(el.getBoundingClientRect()));
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    updatePlacement();
    const onReflow = () => updatePlacement();
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, updatePlacement]);

  useLayoutEffect(() => {
    if (!open || !popoverRef.current || !anchorRef.current) return;
    const measured = popoverRef.current.getBoundingClientRect();
    const anchor = anchorRef.current.getBoundingClientRect();
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - measured.width - VIEWPORT_MARGIN);
    let left = anchor.left + anchor.width / 2 - measured.width / 2;
    left = Math.min(maxLeft, Math.max(VIEWPORT_MARGIN, left));

    const spaceAbove = anchor.top - VIEWPORT_MARGIN;
    const spaceBelow = window.innerHeight - anchor.bottom - VIEWPORT_MARGIN;
    const placeAbove = spaceAbove >= measured.height + POPOVER_GAP || spaceAbove >= spaceBelow;
    const top = placeAbove
      ? Math.max(VIEWPORT_MARGIN, anchor.top - POPOVER_GAP - measured.height)
      : Math.min(window.innerHeight - VIEWPORT_MARGIN - measured.height, anchor.bottom + POPOVER_GAP);

    setPlacement({ top, left, placeAbove });
  }, [open, reference?.id]);

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

  const popoverPortal =
    open && reference && placement
      ? createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[220]"
            style={{ top: placement.top, left: placement.left, width: POPOVER_WIDTH }}
            onMouseEnter={scheduleOpen}
            onMouseLeave={scheduleClose}
          >
            <CitationPopover reference={reference} onClose={() => setOpen(false)} />
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <span
        ref={anchorRef}
        className="relative inline-flex shrink-0 align-baseline whitespace-nowrap"
        onMouseEnter={resolved ? scheduleOpen : undefined}
        onMouseLeave={resolved ? scheduleClose : undefined}
      >
        <button
          type="button"
          className={`mx-0.5 inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[4px] px-1 text-[11px] font-medium leading-none tabular-nums transition-opacity ${
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
      </span>
      {popoverPortal}
    </>
  );
}
