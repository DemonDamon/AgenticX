/** Inputs that distinguish a user-started turn from background / drain sends. */
export type PinScrollOnSendInput = {
  continuation?: unknown;
  queueDrain?: boolean;
};

/**
 * User-started turns should jump to the latest row.
 * Auto-continue and queue drain must keep the user's current scroll.
 */
export function shouldPinScrollOnUserSend(opts?: PinScrollOnSendInput): boolean {
  if (opts?.continuation) return false;
  if (opts?.queueDrain) return false;
  return true;
}

/**
 * Pin follows the user's wheel/trackpad only.
 * Programmatic `scrollTop` assignment must not unpin — new bubbles often
 * fire scroll/resize before layout reaches the true bottom.
 */
export function shouldApplyScrollPinFromEvent(programmatic: boolean): boolean {
  return !programmatic;
}

/**
 * Live chat follows `pane.messages` / stream text.
 * Replay presentation grows a sliced prefix in `renderMessages` while
 * `visibleMessages` stays the full session — follow the sliced rows or the
 * viewport stays on the first turn.
 */
export function chatListFollowRows<T>(
  presenting: boolean,
  liveRows: T,
  presentedRows: T,
): T {
  return presenting ? presentedRows : liveRows;
}

export function shouldPinScrollOnPresentationEnter(
  wasPresenting: boolean,
  presenting: boolean,
): boolean {
  return presenting && !wasPresenting;
}

export type ScrollMetrics = {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
};

/** True when the scroll viewport is within `thresholdPx` of its bottom edge. */
export function isScrollNearBottom(metrics: ScrollMetrics, thresholdPx = 96): boolean {
  const remain = metrics.scrollHeight - (metrics.scrollTop + metrics.clientHeight);
  return remain <= thresholdPx;
}

/**
 * Upward wheel input immediately unpins auto-scroll so the user can inspect
 * history without fighting streaming updates. Downward / zero delta returns
 * `null` so the regular scroll handler decides pin state from geometry.
 */
export function resolvePinOnUserWheel(deltaY: number): boolean | null {
  if (deltaY < 0) return false;
  return null;
}

/**
 * Bottom padding reserved for the floating composer when WorkPanel is expanded.
 * Adds a small breathing gap so the final line of content clears the composer card.
 */
export function computeExpandedWorkBottomInset(
  expanded: boolean,
  composerHeightPx: number,
  gapPx = 8,
): number {
  if (!expanded) return 0;
  const h = Number.isFinite(composerHeightPx) ? Math.ceil(composerHeightPx) : 0;
  if (h <= 0) return 0;
  return h + Math.max(0, gapPx);
}
