import * as React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@agenticx/ui";
import { DeepResearchFilesPanel } from "./DeepResearchFilesPanel";
import { click, key, mount, setViewport } from "../../__tests__/viewport-test-utils";

describe("research files preview layout and pointer lifecycle", () => {
  let view: Awaited<ReturnType<typeof mount>> | undefined;
  beforeEach(() => {
    setViewport();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { artifacts: [] } }) }));
  });
  afterEach(async () => { await view?.unmount(); view = undefined; vi.unstubAllGlobals(); document.body.style.cursor = ""; document.body.style.userSelect = ""; });
  const renderPanel = (close = vi.fn(), open = true) => <TooltipProvider><DeepResearchFilesPanel open={open} sessionId="synthetic-session" onOpenChange={close} /></TooltipProvider>;
  const pointer = async (target: EventTarget, type: string, clientX = 600) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX });
    await act(async () => { target.dispatchEvent(event); });
  };

  it("overlays small containers and restores a readable dock after a parent-only resize", async () => {
    const close = vi.fn(); view = await mount(renderPanel(close), 390);
    const panel = view.container.querySelector<HTMLElement>("aside")!;
    expect(panel.dataset.layout).toBe("overlay");
    expect(view.container.querySelector("[role=separator]")).toBeNull();
    await key("Escape"); expect(close).toHaveBeenCalledWith(false);
    await view.resize(1200);
    expect(panel.dataset.layout).toBe("docked");
    expect(Number(panel.dataset.panelWidth)).toBeGreaterThanOrEqual(360);
    expect(view.container.querySelector("[role=separator]")).not.toBeNull();
  });

  it("preserves keyboard resizing on a docked panel", async () => {
    view = await mount(renderPanel(), 1200);
    const panel = view.container.querySelector<HTMLElement>("aside")!;
    const handle = view.container.querySelector<HTMLElement>("[role=separator]")!;
    const before = Number(panel.dataset.panelWidth);
    await act(async () => { handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); });
    expect(Number(panel.dataset.panelWidth)).toBe(before + 16);
    await view.resize(1000);
    expect(Number(panel.dataset.panelWidth)).toBeLessThanOrEqual(680);
  });

  it("ends a drag on pointercancel and preserves the previous body styles", async () => {
    view = await mount(renderPanel(), 1200);
    document.body.style.cursor = "crosshair"; document.body.style.userSelect = "text";
    const panel = view.container.querySelector<HTMLElement>("aside")!;
    await pointer(view.container.querySelector("[role=separator]")!, "pointerdown");
    expect(document.body.style.cursor).toBe("col-resize");
    await pointer(window, "pointermove", 520);
    const width = panel.dataset.panelWidth;
    await pointer(window, "pointercancel");
    expect(document.body.style.cursor).toBe("crosshair"); expect(document.body.style.userSelect).toBe("text");
    await pointer(window, "pointermove", 400); expect(panel.dataset.panelWidth).toBe(width);
  });

  it.each(["overlay", "closed", "unmounted"])("removes an active drag when %s", async (ending) => {
    view = await mount(renderPanel(), 1200);
    await pointer(view.container.querySelector("[role=separator]")!, "pointerdown");
    if (ending === "overlay") await view.resize(500);
    else if (ending === "closed") await view.render(renderPanel(vi.fn(), false));
    else { await view.unmount(); view = undefined; }
    expect(document.body.style.cursor).toBe(""); expect(document.body.style.userSelect).toBe("");
    await pointer(window, "pointermove", 300);
    expect(document.body.style.cursor).toBe("");
  });

  it("keeps the close action reachable in the overlay", async () => {
    const close = vi.fn(); view = await mount(renderPanel(close), 500);
    await click(view.container.querySelector("[data-preview-close]")); expect(close).toHaveBeenCalledWith(false);
  });
});
