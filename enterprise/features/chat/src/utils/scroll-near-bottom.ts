export function isNearBottom(el: HTMLElement, thresholdPx = 96): boolean {
  const remain = el.scrollHeight - (el.scrollTop + el.clientHeight);
  return remain <= thresholdPx;
}

export function shouldShowScrollToBottomFab(el: HTMLElement, thresholdPx = 96): boolean {
  const overflow = el.scrollHeight > el.clientHeight + 4;
  return overflow && !isNearBottom(el, thresholdPx);
}

/** Resolve next FAB visibility; returns `prev` when unchanged so React can bail out. */
export function nextJumpToBottomFabVisible(
  prev: boolean,
  showScrollToBottomFab: boolean,
  container: HTMLElement | null,
  thresholdPx = 96,
): boolean {
  if (!container) return prev ? false : prev;
  const next = showScrollToBottomFab && shouldShowScrollToBottomFab(container, thresholdPx);
  return prev === next ? prev : next;
}
