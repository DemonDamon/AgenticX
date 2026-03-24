/**
 * ResizeObserver can fire many times per frame while the window is dragged.
 * Coalesce to one React update per animation frame to cut main-thread jank.
 */
export function createResizeRafScheduler(run: () => void): {
  schedule: () => void;
  cancel: () => void;
} {
  let rafId = 0;
  return {
    schedule() {
      if (rafId !== 0) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        run();
      });
    },
    cancel() {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
    },
  };
}
