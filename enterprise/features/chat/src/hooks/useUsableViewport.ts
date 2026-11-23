"use client";

import * as React from "react";
import { COMPACT_WORKSPACE_WIDTH, resolveUsableViewport, type ViewportRect } from "../utils/usable-viewport";

type SegmentedWindow = Window & {
  viewport?: { segments?: readonly DOMRectReadOnly[] | null };
  getWindowSegments?: () => readonly DOMRectReadOnly[];
};
type SegmentedVisualViewport = VisualViewport & { segments?: readonly DOMRectReadOnly[] | null };

function readSegments(target: Window): readonly ViewportRect[] | null {
  try {
    const windowWithSegments = target as SegmentedWindow;
    return windowWithSegments.viewport?.segments
      ?? (target.visualViewport as SegmentedVisualViewport | null)?.segments
      ?? windowWithSegments.getWindowSegments?.()
      ?? null;
  } catch {
    // Experimental APIs can be unavailable while the document is not active.
    return null;
  }
}

function editingRect(element: HTMLElement): ViewportRect | null {
  const active = element.ownerDocument.activeElement;
  if (!(active instanceof HTMLElement) || !element.contains(active)) return null;
  if (!active.matches("textarea, input:not([type=button]):not([type=submit]), [contenteditable]:not([contenteditable=false])")) return null;
  return active.getBoundingClientRect();
}

/** Observes geometry only; it deliberately never focuses controls or scrolls content. */
export function observeUsableViewport(
  element: HTMLElement,
  onLayout: (rect: ViewportRect) => void,
): () => void {
  const target = element.ownerDocument.defaultView;
  if (!target) return () => undefined;
  const viewport = target.visualViewport;
  const properties = ["left", "top", "width", "height"] as const;
  const original = properties.map((property) => element.style.getPropertyValue(`--chat-viewport-${property}`));
  let previous: ViewportRect | null = null;
  let frame: number | null = null;
  let settling: number[] = [];
  let disposed = false;

  const update = () => {
    frame = null;
    if (disposed) return;
    const rect = resolveUsableViewport({
      width: target.innerWidth,
      height: target.innerHeight,
      visual: viewport ? {
        left: viewport.offsetLeft,
        top: viewport.offsetTop,
        width: viewport.width,
        height: viewport.height,
        scale: viewport.scale,
      } : null,
      segments: readSegments(target),
      focusedRect: editingRect(element),
      previous,
    });
    if (!rect) return;
    for (const property of properties) {
      element.style.setProperty(`--chat-viewport-${property}`, `${Math.round(rect[property] * 100) / 100}px`);
    }
    previous = rect;
    onLayout(rect);
  };
  const queue = () => {
    if (!disposed && frame === null) frame = target.requestAnimationFrame(update);
  };
  const settle = () => {
    queue();
    settling.forEach((timer) => target.clearTimeout(timer));
    // Keyboard and rotation animations may report one early snapshot. Re-read
    // a bounded number of times; later events replace, rather than grow, timers.
    settling = [120, 350].map((delay) => target.setTimeout(queue, delay));
  };
  const listeners: Array<[EventTarget, string, EventListener]> = [];
  const listen = (source: EventTarget | null | undefined, event: string, listener = settle) => {
    if (!source) return;
    source.addEventListener(event, listener);
    listeners.push([source, event, listener]);
  };
  listen(target, "resize");
  listen(target, "orientationchange");
  listen(viewport, "resize");
  listen(viewport, "scroll", queue);
  listen(target.screen?.orientation, "change");
  listen((target.navigator as Navigator & { devicePosture?: EventTarget }).devicePosture, "change");
  for (const event of ["focusin", "focusout", "compositionstart", "compositionend"]) {
    listen(element.ownerDocument, event);
  }
  update();
  return () => {
    disposed = true;
    if (frame !== null) target.cancelAnimationFrame(frame);
    settling.forEach((timer) => target.clearTimeout(timer));
    listeners.forEach(([source, event, listener]) => source.removeEventListener(event, listener));
    properties.forEach((property, index) => {
      const value = original[index];
      if (value) element.style.setProperty(`--chat-viewport-${property}`, value);
      else element.style.removeProperty(`--chat-viewport-${property}`);
    });
  };
}

export function useUsableViewport(ref: React.RefObject<HTMLElement | null>): boolean | null {
  const [compact, setCompact] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return observeUsableViewport(element, (rect) => setCompact(rect.width < COMPACT_WORKSPACE_WIDTH));
  }, [ref]);
  return compact;
}
