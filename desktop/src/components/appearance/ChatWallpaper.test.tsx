// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppearance, defaultEffect } from "../../../shared/chat-appearance";
import { useAppearanceStore } from "../../appearance/store";
vi.mock("./ShaderWallpaper", () => ({ default: () => <div data-testid="gpu-background" /> }));
import { ChatWallpaper } from "./ChatWallpaper";
beforeEach(() => {
  useAppearanceStore.setState({ previewActive: false, gpuUnavailable: false });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function appearance(id: "noise" | "cursor-ripples") {
  const a = defaultAppearance(); a.motion = "continuous";
  a.variants.dark.wallpaper.type = "shader"; a.variants.dark.wallpaper.effect = defaultEffect(id);
  return a;
}
describe("background ownership and input", () => {
  it("mounts cursor effects only inside the chat host and preserves click propagation", async () => {
    const click = vi.fn(); const a = appearance("cursor-ripples");
    const view = render(<div className="agx-appearance-host" data-testid="host"><ChatWallpaper appearance={a} mode="dark" focused /><button onClick={click}>Message link</button></div>);
    await act(async () => {}); expect(screen.queryByTestId("gpu-background")).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId("host"));
    await screen.findByTestId("gpu-background");
    fireEvent.click(screen.getByRole("button")); expect(click).toHaveBeenCalledOnce();
    fireEvent.mouseLeave(screen.getByTestId("host")); expect(screen.queryByTestId("gpu-background")).toBeNull();
    view.unmount();
  });
  it("yields to preview, disables zero-strength effects and keeps the fallback", async () => {
    const a = appearance("noise");
    const view = render(<ChatWallpaper appearance={a} mode="dark" focused />);
    await screen.findByTestId("gpu-background");
    act(() => useAppearanceStore.setState({previewActive: true}));
    expect(screen.queryByTestId("gpu-background")).toBeNull();
    view.rerender(<ChatWallpaper appearance={a} mode="dark" focused preview />);
    await screen.findByTestId("gpu-background");
    const zero = appearance("noise"); zero.variants.dark.wallpaper.effect!.opacity = 0;
    view.rerender(<ChatWallpaper appearance={zero} mode="dark" focused preview />);
    expect(screen.queryByTestId("gpu-background")).toBeNull();
    expect(view.container.querySelector(".agx-wallpaper-layer")?.getAttribute("style")).toContain("gradient");
  });
  it("cleans cursor listeners when unmounted and never runs with motion off", async () => {
    const a = appearance("cursor-ripples"); a.motion = "off";
    const host = document.createElement("div"); host.className = "agx-appearance-host"; document.body.append(host);
    const view = render(<ChatWallpaper appearance={a} mode="dark" focused />, {container: host});
    fireEvent.mouseEnter(host); await act(async () => {}); expect(screen.queryByTestId("gpu-background")).toBeNull();
    a.motion = "continuous"; view.rerender(<ChatWallpaper appearance={a} mode="dark" focused />);
    fireEvent.mouseEnter(host); await screen.findByTestId("gpu-background");
    const remove = vi.spyOn(host, "removeEventListener"); view.unmount();
    expect(remove).toHaveBeenCalledWith("mouseenter", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("mouseleave", expect.any(Function)); host.remove();
  });
});

describe("send pulse expiry", () => {
  it("does not replay sends from zero strength after restoring visibility", async () => {
    const a = appearance("noise"); a.motion = "on-send"; a.variants.dark.wallpaper.effect!.opacity = 0;
    const view = render(<ChatWallpaper appearance={a} mode="dark" focused pulse={0} />);
    await act(async () => {});
    view.rerender(<ChatWallpaper appearance={a} mode="dark" focused pulse={1} />);
    const restored = appearance("noise"); restored.motion = "on-send";
    view.rerender(<ChatWallpaper appearance={restored} mode="dark" focused pulse={1} />);
    expect(screen.queryByTestId("gpu-background")).toBeNull();
    view.rerender(<ChatWallpaper appearance={restored} mode="dark" focused pulse={2} />);
    await screen.findByTestId("gpu-background");
    view.rerender(<ChatWallpaper appearance={a} mode="dark" focused pulse={2} />);
    view.rerender(<ChatWallpaper appearance={restored} mode="dark" focused pulse={2} />);
    expect(screen.queryByTestId("gpu-background")).toBeNull();
  });
  it("does not replay a cursor pulse sent outside the host or after leaving", async () => {
    const a = appearance("cursor-ripples"); a.motion = "on-send";
    const content = (pulse: number) => <div className="agx-appearance-host" data-testid="host"><ChatWallpaper appearance={a} mode="dark" focused pulse={pulse} /></div>;
    const view = render(content(0)); await act(async () => {});
    view.rerender(content(1)); fireEvent.mouseEnter(screen.getByTestId("host"));
    expect(screen.queryByTestId("gpu-background")).toBeNull();
    view.rerender(content(2)); await screen.findByTestId("gpu-background");
    fireEvent.mouseLeave(screen.getByTestId("host")); fireEvent.mouseEnter(screen.getByTestId("host"));
    expect(screen.queryByTestId("gpu-background")).toBeNull();
  });
});
