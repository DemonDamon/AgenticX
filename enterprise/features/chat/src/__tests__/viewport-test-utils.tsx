import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { vi } from "vitest";
import type { ViewportRect } from "../utils/usable-viewport";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export class TestVisualViewport extends EventTarget {
  width = 1200;
  height = 800;
  offsetTop = 0;
  offsetLeft = 0;
  scale = 1;
}

export class TestResizeObserver implements ResizeObserver {
  static instances = new Set<TestResizeObserver>();
  constructor(private callback: ResizeObserverCallback) { TestResizeObserver.instances.add(this); }
  observe() { /* explicitly triggered by the test */ }
  unobserve() { /* explicitly triggered by the test */ }
  disconnect() { TestResizeObserver.instances.delete(this); }
  static notify() {
    for (const observer of this.instances) observer.callback([], observer);
  }
}

export function setViewport(width = 1200, height = 800) {
  const visual = new TestVisualViewport();
  visual.width = width;
  visual.height = height;
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("innerHeight", height);
  vi.stubGlobal("visualViewport", visual);
  vi.stubGlobal("viewport", { segments: null });
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  return visual;
}

export function setSegments(rects: ViewportRect[] | null) {
  vi.stubGlobal("viewport", { segments: rects });
}

export async function mount(node: React.ReactNode, width = 1200) {
  const container = document.createElement("div");
  let measuredWidth = width;
  Object.defineProperty(container, "clientWidth", { get: () => measuredWidth });
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => { root.render(node); });
  return {
    container,
    async render(next: React.ReactNode) { await act(async () => { root.render(next); }); },
    async resize(nextWidth: number) {
      measuredWidth = nextWidth;
      await act(async () => { TestResizeObserver.notify(); });
    },
    async unmount() { await act(async () => root.unmount()); container.remove(); },
  };
}

export async function click(element: Element | null) {
  if (!(element instanceof HTMLElement)) throw new Error("Expected an interactive element");
  await act(async () => element.click());
}

export async function key(keyValue: string, options: KeyboardEventInit = {}) {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: keyValue, bubbles: true, cancelable: true, ...options }));
  });
}
