/**
 * Scratch-chat transcript scroller.
 * Live-edge follow, jump-to-latest, last-anchor open.
 * Do not pad the list with a viewport-tall spacer — short chats must not scroll into blank.
 *
 * Author: Damon Li
 */

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

const LIVE_EDGE_PX = 64;
const DEFAULT_PEEK = 48;

type ScrollPosition = "start" | "end" | "last-anchor";

type ScrollerApi = {
  viewportRef: { current: HTMLDivElement | null };
  autoScroll: boolean;
  peek: number;
  following: boolean;
  canScrollEnd: boolean;
  pendingScroll: boolean;
  scrollToEnd: () => void;
  onViewportScroll: (event: UIEvent<HTMLDivElement>) => void;
};

const ScrollerContext = createContext<ScrollerApi | null>(null);

function isAtLiveEdge(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= LIVE_EDGE_PX;
}

function lastAnchorEl(viewport: HTMLElement): HTMLElement | null {
  const nodes = viewport.querySelectorAll<HTMLElement>('[data-scroll-anchor="true"]');
  return nodes.length > 0 ? nodes[nodes.length - 1] : null;
}

export function useScratchMessageScroller(): ScrollerApi {
  const api = useContext(ScrollerContext);
  if (!api) {
    throw new Error("ScratchMessageScroller parts must render inside ScratchMessageScrollerProvider");
  }
  return api;
}

export function ScratchMessageScrollerProvider({
  children,
  autoScroll = true,
  defaultScrollPosition = "last-anchor",
  scrollPreviousItemPeek = DEFAULT_PEEK,
  busy = false,
}: {
  children: ReactNode;
  autoScroll?: boolean;
  defaultScrollPosition?: ScrollPosition;
  scrollPreviousItemPeek?: number;
  busy?: boolean;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const followingRef = useRef(true);
  const releasedRef = useRef(false);
  const programmaticRef = useRef(0);
  const openedRef = useRef(false);
  const lastAnchorIdRef = useRef<string | null>(null);
  const [following, setFollowing] = useState(true);
  const [canScrollEnd, setCanScrollEnd] = useState(false);
  const [pendingScroll, setPendingScroll] = useState(defaultScrollPosition !== "start");

  const markProgrammatic = useCallback(() => {
    programmaticRef.current += 1;
    requestAnimationFrame(() => {
      programmaticRef.current = Math.max(0, programmaticRef.current - 1);
    });
  }, []);

  const setFollowState = useCallback((next: boolean, released: boolean) => {
    followingRef.current = next;
    releasedRef.current = released;
    setFollowing(next);
  }, []);

  const scrollToEnd = useCallback(() => {
    const el = viewportRef.current;
    setFollowState(true, false);
    if (!el) return;
    markProgrammatic();
    el.scrollTop = el.scrollHeight;
  }, [markProgrammatic, setFollowState]);

  const syncEdges = useCallback(() => {
    const el = viewportRef.current;
    if (!el) {
      setCanScrollEnd(false);
      return;
    }
    const overflow = el.scrollHeight > el.clientHeight + 4;
    setCanScrollEnd(overflow && !isAtLiveEdge(el));
  }, []);

  const scrollAnchorToPeek = useCallback(
    (anchor: HTMLElement) => {
      const el = viewportRef.current;
      if (!el) return;
      markProgrammatic();
      el.scrollTop = Math.max(0, anchor.offsetTop - scrollPreviousItemPeek);
    },
    [markProgrammatic, scrollPreviousItemPeek],
  );

  const applyDefaultPosition = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    if (defaultScrollPosition === "start") {
      markProgrammatic();
      el.scrollTop = 0;
      setFollowState(false, false);
      return;
    }
    if (defaultScrollPosition === "end") {
      scrollToEnd();
      return;
    }
    const anchor = lastAnchorEl(el);
    if (!anchor) {
      scrollToEnd();
      return;
    }
    if (el.scrollHeight <= el.clientHeight + 4) {
      scrollToEnd();
      return;
    }
    setFollowState(false, false);
    scrollAnchorToPeek(anchor);
  }, [defaultScrollPosition, markProgrammatic, scrollAnchorToPeek, scrollToEnd, setFollowState]);

  const onViewportScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (programmaticRef.current > 0) return;
      const el = event.currentTarget;
      if (isAtLiveEdge(el)) {
        setFollowState(true, false);
      } else {
        setFollowState(false, true);
      }
      syncEdges();
    },
    [setFollowState, syncEdges],
  );

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const anchor = lastAnchorEl(el);
    const anchorId = anchor?.dataset.messageId ?? null;

    if (!openedRef.current) {
      openedRef.current = true;
      lastAnchorIdRef.current = anchorId;
      applyDefaultPosition();
      setPendingScroll(false);
      syncEdges();
      return;
    }

    if (anchorId && anchorId !== lastAnchorIdRef.current) {
      lastAnchorIdRef.current = anchorId;
      if (busy) {
        setFollowState(true, false);
        markProgrammatic();
        el.scrollTop = el.scrollHeight;
        syncEdges();
        return;
      }
      setFollowState(false, false);
      if (anchor) scrollAnchorToPeek(anchor);
      syncEdges();
      return;
    }

    if (releasedRef.current) {
      syncEdges();
      return;
    }

    if (followingRef.current && autoScroll) {
      markProgrammatic();
      el.scrollTop = el.scrollHeight;
      syncEdges();
      return;
    }

    if (autoScroll && !followingRef.current && isAtLiveEdge(el)) {
      setFollowState(true, false);
      markProgrammatic();
      el.scrollTop = el.scrollHeight;
    }
    syncEdges();
  });

  const api = useMemo<ScrollerApi>(
    () => ({
      viewportRef,
      autoScroll,
      peek: scrollPreviousItemPeek,
      following,
      canScrollEnd,
      pendingScroll,
      scrollToEnd,
      onViewportScroll,
    }),
    [
      autoScroll,
      canScrollEnd,
      following,
      onViewportScroll,
      pendingScroll,
      scrollPreviousItemPeek,
      scrollToEnd,
    ],
  );

  return (
    <ScrollerContext.Provider value={api}>
      <div data-slot="message-scroller-provider" className="flex min-h-0 min-w-0 flex-1 flex-col">
        {children}
      </div>
    </ScrollerContext.Provider>
  );
}

export function ScratchMessageScroller({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div data-slot="message-scroller" className={`relative flex min-h-0 min-w-0 flex-1 flex-col ${className}`.trim()}>
      {children}
    </div>
  );
}

export function ScratchMessageScrollerViewport({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const { viewportRef, pendingScroll, onViewportScroll } = useScratchMessageScroller();
  const { t } = useTranslation("workspace");

  return (
    <div
      ref={viewportRef}
      data-slot="message-scroller-viewport"
      data-pending-scroll={pendingScroll ? "" : undefined}
      role="region"
      tabIndex={0}
      aria-label={t("work.scratchMessagesAria")}
      className={`min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none ${
        pendingScroll ? "invisible" : ""
      } ${className}`.trim()}
      onScroll={onViewportScroll}
    >
      {children}
    </div>
  );
}

export function ScratchMessageScrollerContent({
  children,
  busy = false,
  className = "",
}: {
  children: ReactNode;
  busy?: boolean;
  className?: string;
}) {
  return (
    <div
      data-slot="message-scroller-content"
      role="log"
      aria-relevant="additions"
      aria-busy={busy || undefined}
      className={`flex min-h-full flex-col gap-4 px-5 py-4 ${className}`.trim()}
    >
      {children}
    </div>
  );
}

export function ScratchMessageScrollerItem({
  messageId,
  scrollAnchor = false,
  children,
  className = "",
}: {
  messageId: string;
  scrollAnchor?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="message-scroller-item"
      data-message-id={messageId}
      data-scroll-anchor={scrollAnchor ? "true" : "false"}
      className={`min-w-0 [content-visibility:auto] [contain-intrinsic-size:auto_72px] ${className}`.trim()}
    >
      {children}
    </div>
  );
}

export function ScratchMessageScrollerButton() {
  const { canScrollEnd, scrollToEnd, following } = useScratchMessageScroller();
  const { t } = useTranslation("workspace");
  const active = canScrollEnd && !following;

  return (
    <button
      type="button"
      data-slot="message-scroller-button"
      data-active={active ? "true" : "false"}
      tabIndex={active ? 0 : -1}
      aria-hidden={!active}
      aria-label={t("work.scratchJumpLatest")}
      className={`absolute bottom-3 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-surface-card-strong/95 text-text-strong shadow-lg backdrop-blur-sm transition hover:bg-surface-hover ${
        active ? "pointer-events-auto" : "pointer-events-none invisible"
      }`}
      onClick={() => {
        scrollToEnd();
      }}
    >
      <ChevronDown className="h-4 w-4" strokeWidth={2.25} aria-hidden />
    </button>
  );
}
