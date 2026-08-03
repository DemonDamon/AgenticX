/**
 * Resize constraints for the deep-research files panel (right) vs chat (left).
 *
 * - Chat cannot shrink below CHAT_MIN_PX
 * - Files panel cannot grow beyond MAX_RATIO of the shared container
 * - Files panel has its own MIN_PX so the browse/preview chrome stays usable
 */

/** Left chat column minimum width (px). */
export const FILES_PANEL_CHAT_MIN_PX = 320;

/** Right files panel minimum width (px). */
export const FILES_PANEL_MIN_PX = 360;

/** Right files panel may occupy at most this fraction of the parent flex row. */
export const FILES_PANEL_MAX_RATIO = 0.72;

export function clampFilesPanelWidth(widthPx: number, containerPx: number): number {
  const container = Math.max(0, Math.floor(containerPx));
  if (container <= 0) return FILES_PANEL_MIN_PX;

  const maxByRatio = Math.floor(container * FILES_PANEL_MAX_RATIO);
  const maxByChatMin = container - FILES_PANEL_CHAT_MIN_PX;
  const max = Math.max(0, Math.min(maxByRatio, maxByChatMin));
  // Tiny viewports: prefer keeping chat usable; panel may dip below MIN.
  const min = Math.min(FILES_PANEL_MIN_PX, max);
  const raw = Number.isFinite(widthPx) ? Math.round(widthPx) : min;
  return Math.min(max, Math.max(min, raw));
}

/** Preferred docked width when the panel opens / focuses a deliverable. */
export function defaultFilesPanelWidth(
  containerPx: number,
  opts?: { htmlPreview?: boolean },
): number {
  const htmlPreview = Boolean(opts?.htmlPreview);
  const preferred = htmlPreview
    ? Math.min(720, Math.floor(containerPx * 0.58))
    : Math.min(480, Math.floor(containerPx * 0.4));
  return clampFilesPanelWidth(preferred, containerPx);
}
