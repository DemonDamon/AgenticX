import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@agenticx/ui";
import { AttachmentContentPanel } from "./AttachmentContentPanel";
import { click, key, mount, setViewport } from "../../__tests__/viewport-test-utils";

describe("attachment preview layouts", () => {
  let view: Awaited<ReturnType<typeof mount>> | undefined;
  beforeEach(() => { setViewport(); });
  afterEach(async () => { await view?.unmount(); view = undefined; vi.unstubAllGlobals(); });
  const attachment = { name: "notes.md", mime_type: "text/markdown", parsed_text: "Readable preview text" };
  const renderPanel = (onOpenChange = vi.fn()) => <TooltipProvider><AttachmentContentPanel open attachment={attachment} onOpenChange={onOpenChange} /></TooltipProvider>;

  it("uses the measured chat container rather than the full display width", async () => {
    view = await mount(renderPanel(), 700);
    const panel = view.container.querySelector<HTMLElement>("aside")!;
    expect(panel.dataset.layout).toBe("overlay");
    expect(panel.getAttribute("aria-modal")).toBe("true");
    expect(panel.textContent).toContain("Readable preview text");
    await view.resize(1100);
    expect(panel.dataset.layout).toBe("docked");
    expect(panel.hasAttribute("aria-modal")).toBe(false);
    await view.resize(420);
    expect(panel.dataset.layout).toBe("overlay");
  });

  it("closes by its visible button and restores the opening control without scrolling", async () => {
    const close = vi.fn();
    const trigger = document.createElement("button"); trigger.textContent = "Open preview"; document.body.appendChild(trigger); trigger.focus();
    view = await mount(renderPanel(close), 400);
    const button = view.container.querySelector<HTMLElement>("[data-preview-close]")!;
    expect(document.activeElement).toBe(button);
    await click(button); expect(close).toHaveBeenCalledWith(false);
    await view.render(null);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("traps keyboard focus, ignores composing Escape and closes the overlay", async () => {
    const close = vi.fn(); view = await mount(renderPanel(close), 430);
    const buttons = Array.from(view.container.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
    await React.act(async () => { buttons[buttons.length - 1]!.focus(); });
    await key("Tab"); expect(document.activeElement).toBe(buttons[0]);
    await key("Tab"); expect(document.activeElement).toBe(buttons[1]);
    await key("Tab", { shiftKey: true }); expect(document.activeElement).toBe(buttons[0]);
    await key("Escape", { isComposing: true }); expect(close).not.toHaveBeenCalled();
    await key("Escape"); expect(close).toHaveBeenCalledTimes(1);
  });

  it("keeps fullscreen inside inherited viewport bounds and first Escape restores the panel", async () => {
    const close = vi.fn(); view = await mount(renderPanel(close), 1200);
    await click(view.container.querySelector("[aria-label='全屏预览']"));
    const panel = view.container.querySelector<HTMLElement>("aside")!;
    expect(panel.dataset.layout).toBe("fullscreen");
    expect(panel.style.left).toBe("var(--chat-viewport-left, 0px)");
    expect(panel.style.height).toBe("var(--chat-viewport-height, 100dvh)");
    await key("Escape"); expect(panel.dataset.layout).toBe("docked"); expect(close).not.toHaveBeenCalled();
  });

  it("contains outside focus and sends Escape only to the visually topmost preview", async () => {
    const firstClose = vi.fn(); const secondClose = vi.fn();
    view = await mount(<TooltipProvider>
      <AttachmentContentPanel open attachment={attachment} onOpenChange={firstClose} />
      <AttachmentContentPanel open attachment={attachment} onOpenChange={secondClose} />
    </TooltipProvider>, 500);
    const panels = view.container.querySelectorAll<HTMLElement>("aside");
    const outside = document.createElement("button"); document.body.appendChild(outside);
    await React.act(async () => { outside.focus(); });
    expect(panels[1]!.contains(document.activeElement)).toBe(true);
    panels[0]!.style.zIndex = "60";
    await React.act(async () => { panels[0]!.querySelector<HTMLElement>("[data-preview-close]")!.focus(); });
    await key("Escape");
    expect(firstClose).toHaveBeenCalledWith(false); expect(secondClose).not.toHaveBeenCalled();
    outside.remove();
  });
});
