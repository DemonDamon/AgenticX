import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RUN_MODE_OPTIONS, runModeLabel } from "../../constants/confirm-strategy-options";
import { applyRunMode, RunModeMenu, RunModePicker, runModePanelStyle } from "./RunModePicker";

const mocks = vi.hoisted(() => ({
  setRunMode: vi.fn(),
  runMode: "ask" as const,
}));

vi.mock("../../store", () => ({
  useAppStore: (selector: (s: { runMode: typeof mocks.runMode; setRunMode: typeof mocks.setRunMode }) => unknown) =>
    selector({ runMode: mocks.runMode, setRunMode: mocks.setRunMode }),
}));

describe("RunModePicker", () => {
  it("renders the trigger with the current store label", () => {
    const html = renderToStaticMarkup(<RunModePicker />);
    expect(html).toContain(runModeLabel(mocks.runMode));
  });

  it("lists every run-mode option from the shared vocabulary", () => {
    const html = renderToStaticMarkup(<RunModeMenu mode="ask" onSelect={() => {}} />);
    const optionCount = (html.match(/role="option"/g) ?? []).length;
    expect(optionCount).toBe(3);
    for (const option of RUN_MODE_OPTIONS) {
      expect(html).toContain(option.label);
    }
  });

  it("applies a non-auto mode without asking", async () => {
    const setRunMode = vi.fn();
    const confirmDialog = vi.fn();
    await applyRunMode({
      next: "allowlist",
      mode: "ask",
      setRunMode,
      confirmDialog,
    });
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(setRunMode).toHaveBeenCalledTimes(1);
    expect(setRunMode).toHaveBeenCalledWith("allowlist");
  });

  it("asks before switching to auto and requires 高风险 in the detail", async () => {
    const setRunMode = vi.fn();
    const confirmDialog = vi.fn().mockResolvedValue({ confirmed: true });
    await applyRunMode({
      next: "auto",
      mode: "ask",
      setRunMode,
      confirmDialog,
    });
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    const payload = confirmDialog.mock.calls[0]?.[0] as { detail?: string };
    expect(payload.detail).toContain("高风险");
    expect(setRunMode).toHaveBeenCalledWith("auto");
  });

  it("does not change mode when the auto confirm is cancelled", async () => {
    const setRunMode = vi.fn();
    const confirmDialog = vi.fn().mockResolvedValue({ confirmed: false });
    await applyRunMode({
      next: "auto",
      mode: "ask",
      setRunMode,
      confirmDialog,
    });
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(setRunMode).not.toHaveBeenCalled();
  });

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
      right: partial.left + 80,
      top: partial.top,
      bottom: partial.bottom,
      width: 80,
      height: partial.bottom - partial.top,
      x: partial.left,
      y: partial.top,
      toJSON() {
        return this;
      },
    } as DOMRect;
  }

  it("opens the menu downward when there is room below", () => {
    const next = withWindow({ innerWidth: 1280, innerHeight: 800 }, () =>
      runModePanelStyle(fakeRect({ left: 40, top: 200, bottom: 228 })),
    );
    expect(next.placement).toBe("down");
    expect(next.style.top).toBe(228 + 6);
    expect(next.style.bottom).toBeUndefined();
  });

  it("opens the menu upward when the trigger is near the bottom", () => {
    const next = withWindow({ innerWidth: 1280, innerHeight: 800 }, () =>
      runModePanelStyle(fakeRect({ left: 40, top: 740, bottom: 768 })),
    );
    expect(next.placement).toBe("up");
    expect(next.style.bottom).toBe(800 - 740 + 6);
    expect(next.style.top).toBeUndefined();
  });

  it("keeps the current mode when confirmDialog is unavailable", async () => {
    const setRunMode = vi.fn();
    await applyRunMode({
      next: "auto",
      mode: "ask",
      setRunMode,
      confirmDialog: undefined,
    });
    expect(setRunMode).not.toHaveBeenCalled();
  });
});
