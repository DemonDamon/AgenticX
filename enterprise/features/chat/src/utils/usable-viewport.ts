export type ViewportRect = { left: number; top: number; width: number; height: number };

export type VisualViewportSnapshot = ViewportRect & { scale: number };

export type UsableViewportInput = {
  width: number;
  height: number;
  visual?: VisualViewportSnapshot | null;
  segments?: readonly ViewportRect[] | null;
  focusedRect?: ViewportRect | null;
  previous?: ViewportRect | null;
};

export const COMPACT_WORKSPACE_WIDTH = 1024;
export const DOCKED_PREVIEW_MIN_WIDTH = 900;

function validRect(rect: ViewportRect): boolean {
  return [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)
    && rect.width > 0 && rect.height > 0;
}

export function intersectViewportRects(a: ViewportRect, b: ViewportRect): ViewportRect | null {
  if (!validRect(a) || !validRect(b)) return null;
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

function containsCenter(rect: ViewportRect, anchor?: ViewportRect | null): number {
  if (!anchor || !validRect(anchor)) return 0;
  const x = anchor.left + anchor.width / 2;
  const y = anchor.top + anchor.height / 2;
  return Number(x >= rect.left && x < rect.left + rect.width && y >= rect.top && y < rect.top + rect.height);
}

/** Rectangles are in layout-viewport CSS coordinates, never physical screen pixels. */
export function resolveUsableViewport(input: UsableViewportInput): ViewportRect | null {
  const layout = { left: 0, top: 0, width: input.width, height: input.height };
  if (!validRect(layout)) return null;
  // Pinch zoom should magnify the existing layout, not resize it as if a keyboard opened.
  if (input.visual && (!Number.isFinite(input.visual.scale) || Math.abs(input.visual.scale - 1) > 0.02)) return null;
  const visible = input.visual ? intersectViewportRects(layout, input.visual) : layout;
  if (!visible) return null; // Ignore transient zero-size rotation/keyboard snapshots.

  const candidates = (input.segments ?? [])
    .map((segment) => intersectViewportRects(visible, segment))
    .filter((rect): rect is ViewportRect => rect !== null);
  if (!candidates.length) return visible;

  // A tiny remnant below a keyboard must not win over a readable segment merely
  // because the focused element or previous frame used to be there.
  const roomy = candidates.filter((rect) => rect.width >= 240 && rect.height >= 200);
  const usable = roomy.length ? roomy : candidates;
  usable.sort((a, b) =>
    containsCenter(b, input.focusedRect) - containsCenter(a, input.focusedRect)
    || containsCenter(b, input.previous) - containsCenter(a, input.previous)
    || b.width * b.height - a.width * a.height
    || a.top - b.top || a.left - b.left,
  );
  return usable[0] ?? visible;
}

/** Fullscreen previews inherit the same usable region as their chat frame. */
export const usableViewportStyle = {
  left: "var(--chat-viewport-left, 0px)",
  top: "var(--chat-viewport-top, 0px)",
  width: "var(--chat-viewport-width, 100%)",
  height: "var(--chat-viewport-height, 100dvh)",
} as const;

/** Bottom-anchored popup geometry confined to the same usable region as chat. */
export function placeMenuAboveTrigger(trigger: ViewportRect, bounds: ViewportRect) {
  if (!validRect(trigger) || !validRect(bounds)) return null;
  const margin = Math.min(8, bounds.width / 4, bounds.height / 4);
  const width = Math.min(360, Math.max(280, trigger.width + 88), bounds.width - margin * 2);
  const left = Math.max(bounds.left + margin,
    Math.min(bounds.left + bounds.width - width - margin, trigger.left + trigger.width - width));
  const top = Math.min(bounds.top + bounds.height - margin, Math.max(bounds.top + margin, trigger.top - margin));
  return { left, top, width, maxHeight: Math.max(0, top - bounds.top - margin) };
}
