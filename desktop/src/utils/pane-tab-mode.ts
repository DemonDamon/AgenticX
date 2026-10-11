/**
 * When to collapse multi-pane split into a tab strip.
 *
 * Original AC was the 680px *window* minimum — not a 920px *main-area*
 * cutoff. Measuring the chat container against 920px made default ~900px
 * windows (minus the sidebar) always tab, so "open in new pane" looked
 * like it could not show two chats at once.
 */
export const PANE_SPLIT_WINDOW_MIN = 720;
export const PANE_SPLIT_MIN_EACH = 280;

export function shouldUsePaneTabs(input: {
  containerWidth: number;
  paneCount: number;
  windowWidth: number;
}): boolean {
  if (input.paneCount < 2) return false;
  const win = input.windowWidth;
  const w = input.containerWidth > 0 ? input.containerWidth : win;
  if (w <= 0 && win <= 0) return false;
  if (win > 0 && win < PANE_SPLIT_WINDOW_MIN) return true;
  return w / input.paneCount < PANE_SPLIT_MIN_EACH;
}
