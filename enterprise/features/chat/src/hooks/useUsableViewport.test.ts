import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observeUsableViewport } from "./useUsableViewport";
import { setSegments, setViewport, TestVisualViewport } from "../__tests__/viewport-test-utils";

describe("viewport observer", () => {
  let visual: TestVisualViewport;
  let root: HTMLElement;
  let stop: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    visual = setViewport(1366, 1024);
    root = document.createElement("main");
    document.body.appendChild(root);
  });
  afterEach(() => {
    stop?.(); stop = undefined;
    root.remove();
    vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  });
  const flush = () => vi.advanceTimersByTime(400);

  it("updates wide keyboard geometry and its visual offset", () => {
    stop = observeUsableViewport(root, vi.fn());
    visual.height = 420; visual.offsetTop = 80; visual.offsetLeft = 12; visual.width = 1340;
    visual.dispatchEvent(new Event("resize")); flush();
    expect(root.style.getPropertyValue("--chat-viewport-height")).toBe("420px");
    expect(root.style.getPropertyValue("--chat-viewport-top")).toBe("80px");
    expect(root.style.getPropertyValue("--chat-viewport-left")).toBe("12px");
  });

  it("requeries the current segment API on posture and orientation changes", () => {
    const posture = new EventTarget();
    Object.defineProperty(window.navigator, "devicePosture", { configurable: true, value: posture });
    stop = observeUsableViewport(root, vi.fn());
    setSegments([{ left: 0, top: 0, width: 600, height: 1024 }, { left: 640, top: 0, width: 726, height: 1024 }]);
    posture.dispatchEvent(new Event("change")); flush();
    expect(root.style.getPropertyValue("--chat-viewport-left")).toBe("640px");
    expect(root.style.getPropertyValue("--chat-viewport-width")).toBe("726px");
    setSegments(null); window.dispatchEvent(new Event("orientationchange")); flush();
    expect(root.style.getPropertyValue("--chat-viewport-width")).toBe("1366px");
    delete (window.navigator as Navigator & { devicePosture?: EventTarget }).devicePosture;
  });

  it("preserves scroll position, focus and text composition selection", () => {
    root.innerHTML = "<div><p>older messages</p></div><textarea>composing input</textarea>";
    const scroller = root.firstElementChild as HTMLElement;
    const input = root.querySelector("textarea")!;
    scroller.scrollTop = 130; input.focus(); input.setSelectionRange(2, 5);
    const focus = vi.spyOn(input, "focus");
    const scroll = vi.fn(); root.scrollTo = scroll;
    stop = observeUsableViewport(root, vi.fn());
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    visual.height = 460; visual.dispatchEvent(new Event("resize")); flush();
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); flush();
    expect(scroller.scrollTop).toBe(130);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5]);
    expect(focus).not.toHaveBeenCalled(); expect(scroll).not.toHaveBeenCalled();
  });

  it("ignores pinch zoom and zero snapshots, then recovers", () => {
    stop = observeUsableViewport(root, vi.fn());
    visual.scale = 2; visual.width = 683; visual.height = 512;
    visual.dispatchEvent(new Event("resize")); flush();
    expect(root.style.getPropertyValue("--chat-viewport-height")).toBe("1024px");
    visual.scale = 1; visual.height = 0; visual.dispatchEvent(new Event("resize")); flush();
    expect(root.style.getPropertyValue("--chat-viewport-height")).toBe("1024px");
    visual.width = 1366; visual.height = 760; visual.dispatchEvent(new Event("resize")); flush();
    expect(root.style.getPropertyValue("--chat-viewport-height")).toBe("760px");
  });

  it("coalesces event storms and disposes listeners, timers and its CSS values", () => {
    root.style.setProperty("--chat-viewport-height", "77vh");
    const layout = vi.fn();
    stop = observeUsableViewport(root, layout);
    for (let count = 0; count < 100; count++) visual.dispatchEvent(new Event("resize"));
    expect(vi.getTimerCount()).toBeLessThanOrEqual(3);
    flush(); expect(layout.mock.calls.length).toBeLessThanOrEqual(4);
    stop(); stop = undefined;
    expect(root.style.getPropertyValue("--chat-viewport-height")).toBe("77vh");
    expect(root.style.getPropertyValue("--chat-viewport-width")).toBe("");
    const calls = layout.mock.calls.length;
    visual.dispatchEvent(new Event("resize")); window.dispatchEvent(new Event("resize")); flush();
    expect(layout).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });
});
