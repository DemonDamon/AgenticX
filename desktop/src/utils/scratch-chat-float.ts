/**
 * In-app scratch float positioning (no Electron window).
 *
 * Author: Damon Li
 */

export const SCRATCH_FLOAT_WIDTH = 360;
export const SCRATCH_FLOAT_HEIGHT = 480;
export const SCRATCH_FLOAT_MARGIN = 8;

export function clampScratchFloatPosition(
  pos: { left: number; top: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const margin = SCRATCH_FLOAT_MARGIN;
  const maxLeft = Math.max(margin, viewport.width - size.width - margin);
  const maxTop = Math.max(margin, viewport.height - size.height - margin);
  return {
    left: Math.min(maxLeft, Math.max(margin, pos.left)),
    top: Math.min(maxTop, Math.max(margin, pos.top)),
  };
}

export function defaultScratchFloatPosition(
  viewport: { width: number; height: number },
  size: { width: number; height: number } = {
    width: SCRATCH_FLOAT_WIDTH,
    height: SCRATCH_FLOAT_HEIGHT,
  },
): { left: number; top: number } {
  return clampScratchFloatPosition(
    { left: viewport.width - size.width - 24, top: 72 },
    size,
    viewport,
  );
}
