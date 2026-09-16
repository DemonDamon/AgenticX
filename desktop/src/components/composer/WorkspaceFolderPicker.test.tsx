import { describe, expect, it } from "vitest";
import { workspaceFolderPanelPlacement } from "./WorkspaceFolderPicker";

function withWindow<T>(size: { innerWidth: number; innerHeight: number }, run: () => T): T {
  const previous = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: size,
  });
  try {
    return run();
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previous,
    });
  }
}

function fakeRect(partial: Pick<DOMRect, "left" | "top" | "bottom">): DOMRect {
  return {
    left: partial.left,
    right: partial.left + 180,
    top: partial.top,
    bottom: partial.bottom,
    width: 180,
    height: partial.bottom - partial.top,
    x: partial.left,
    y: partial.top,
    toJSON() {
      return this;
    },
  } as DOMRect;
}

describe("workspaceFolderPanelPlacement", () => {
  it("opens downward when there is room below the trigger", () => {
    const next = withWindow({ innerWidth: 1280, innerHeight: 800 }, () =>
      workspaceFolderPanelPlacement(fakeRect({ left: 40, top: 200, bottom: 228 })),
    );
    expect(next.placement).toBe("down");
    expect(next.panel.top).toBe(228 + 6);
    expect(next.panel.bottom).toBeUndefined();
    expect(next.listMaxHeight).toBeGreaterThanOrEqual(96);
  });

  it("opens upward when the trigger is near the window bottom", () => {
    const next = withWindow({ innerWidth: 1280, innerHeight: 800 }, () =>
      workspaceFolderPanelPlacement(fakeRect({ left: 40, top: 740, bottom: 768 })),
    );
    expect(next.placement).toBe("up");
    expect(next.panel.bottom).toBe(800 - 740 + 6);
    expect(next.panel.top).toBeUndefined();
    expect(next.listMaxHeight).toBeGreaterThanOrEqual(96);
  });
});
