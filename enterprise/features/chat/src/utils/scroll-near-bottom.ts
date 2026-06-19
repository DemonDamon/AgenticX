export function isNearBottom(el: HTMLElement, thresholdPx = 96): boolean {
  const remain = el.scrollHeight - (el.scrollTop + el.clientHeight);
  return remain <= thresholdPx;
}

export function shouldShowScrollToBottomFab(el: HTMLElement, thresholdPx = 96): boolean {
  const overflow = el.scrollHeight > el.clientHeight + 4;
  return overflow && !isNearBottom(el, thresholdPx);
}
