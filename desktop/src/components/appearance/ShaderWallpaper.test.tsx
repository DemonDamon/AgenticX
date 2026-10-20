// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppearance, defaultEffect } from "../../../shared/chat-appearance";
import { useAppearanceStore } from "../../appearance/store";
const api = vi.hoisted(() => ({ support: vi.fn(), unavailable: undefined as undefined | (() => void), telemetry: false, ready: undefined as undefined | (() => void) }));
vi.mock("../../appearance/shader-runtime", () => ({
  getWebGPUSupport: api.support,
  Shader: ({ onUnavailable, onReady, disableTelemetry, children, style }: { onUnavailable: () => void; onReady: () => void; disableTelemetry: boolean; children?: import("react").ReactNode; style?: import("react").CSSProperties }) => { api.ready = onReady; api.unavailable = onUnavailable; api.telemetry = disableTelemetry; return <div data-testid="shader" style={style}>{children}</div>; },
  LinearGradient: () => <div data-testid="gradient" />,
  RadialGradient: (props: object) => <div data-testid="radial" data-props={JSON.stringify(props)} />,
  SimplexNoise: (props: object) => <div data-testid="noise" data-props={JSON.stringify(props)} />,
  Ripples: (props: object) => <div data-testid="ripples" data-props={JSON.stringify(props)} />,
  Glass: ({children, ...props}: {children?: import("react").ReactNode}) => <div data-testid="glass" data-props={JSON.stringify(props)}>{children}</div>,
  FlutedGlass: ({children, ...props}: {children?: import("react").ReactNode}) => <div data-testid="fluted-glass" data-props={JSON.stringify(props)}>{children}</div>,
  CursorRipples: ({children, ...props}: {children?: import("react").ReactNode}) => <div data-testid="cursor-ripples" data-props={JSON.stringify(props)}>{children}</div>,
}));
import ShaderWallpaper from "./ShaderWallpaper";
beforeEach(() => { api.support.mockReset(); api.unavailable = undefined; useAppearanceStore.setState({ gpuUnavailable: false }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("GPU fallback lifecycle", () => {
  it("falls back without a WebGPU adapter", async () => {
    api.support.mockResolvedValue({ supported: false });
    render(<ShaderWallpaper wallpaper={defaultAppearance().variants.dark.wallpaper} speed={1} />);
    await act(async () => {}); expect(useAppearanceStore.getState().gpuUnavailable).toBe(true);
  });
  it("times out stalled initialization and cancels work on unmount", async () => {
    vi.useFakeTimers(); api.support.mockImplementation(() => new Promise(() => {}));
    const view = render(<ShaderWallpaper wallpaper={defaultAppearance().variants.dark.wallpaper} speed={1} />);
    await act(() => vi.advanceTimersByTime(5001)); expect(useAppearanceStore.getState().gpuUnavailable).toBe(true);
    view.unmount(); expect(vi.getTimerCount()).toBe(0);
  });
  it("disables telemetry and handles runtime device failure", async () => {
    api.support.mockResolvedValue({ supported: true });
    render(<ShaderWallpaper wallpaper={defaultAppearance().variants.dark.wallpaper} speed={1} />);
    await act(async () => {}); expect(api.telemetry).toBe(true);
    act(() => api.unavailable?.()); expect(useAppearanceStore.getState().gpuUnavailable).toBe(true);
  });
});

describe("send animation resource cleanup", () => {
  it("completes after readiness and cancels the frame on unmount", async () => {
    api.support.mockResolvedValue({ supported: true });
    let frame: FrameRequestCallback | undefined;
    const cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; }));
    vi.stubGlobal("cancelAnimationFrame", cancel);
    vi.spyOn(performance, "now").mockReturnValue(0);
    const done = vi.fn();
    const view = render(<ShaderWallpaper wallpaper={defaultAppearance().variants.dark.wallpaper} speed={1} duration={900} onComplete={done} />);
    await act(async () => {});
    expect(done).not.toHaveBeenCalled();
    act(() => api.ready?.());
    act(() => frame?.(901));
    expect(done).toHaveBeenCalledOnce();
    view.unmount();
    expect(cancel).toHaveBeenCalledWith(7);
    vi.unstubAllGlobals(); vi.restoreAllMocks();
  });
});

describe("effect runtime composition", () => {
  it.each(["noise", "ripples", "glass", "fluted-glass", "cursor-ripples"] as const)("renders %s with its parameters and two base layers", async id => {
    api.support.mockResolvedValue({supported: true});
    const w = defaultAppearance().variants.dark.wallpaper;
    w.type = "shader"; w.effect = defaultEffect(id);
    render(<ShaderWallpaper wallpaper={w} speed={1} />);
    await act(async () => {});
    const node = screen.getByTestId(id);
    expect(JSON.parse(node.getAttribute("data-props")!)).toMatchObject(w.effect.params);
    expect(screen.getAllByTestId("gradient")).toHaveLength(2);
  });
  it("updates parameters without initializing another renderer", async () => {
    api.support.mockResolvedValue({supported: true});
    const w = defaultAppearance().variants.dark.wallpaper; w.type = "shader"; w.effect = defaultEffect("noise");
    const view = render(<ShaderWallpaper wallpaper={w} speed={1} />); await act(async () => {});
    const next = { ...w, effect: defaultEffect("noise") }; next.effect.params.scale = 3;
    view.rerender(<ShaderWallpaper wallpaper={next} speed={1} />);
    expect(JSON.parse(screen.getByTestId("noise").getAttribute("data-props")!).scale).toBe(3);
    expect(api.support).toHaveBeenCalledOnce();
  });
});

describe("cursor animation speed", () => {
  it("scales ripple decay with playback speed while respecting the runtime limit", async () => {
    api.support.mockResolvedValue({supported: true});
    const w = defaultAppearance().variants.dark.wallpaper; w.type = "shader"; w.effect = defaultEffect("cursor-ripples");
    const view = render(<ShaderWallpaper wallpaper={w} speed={.5} />); await act(async () => {});
    expect(JSON.parse(screen.getByTestId("cursor-ripples").getAttribute("data-props")!).decay).toBe(5);
    const next = {...w, effect: defaultEffect("cursor-ripples")}; next.effect.params.decay = 15;
    view.rerender(<ShaderWallpaper wallpaper={next} speed={2} />);
    expect(JSON.parse(screen.getByTestId("cursor-ripples").getAttribute("data-props")!).decay).toBe(20);
  });
});

describe("send effect envelope", () => {
  it("fades a non-gradient effect in and out after readiness", async () => {
    api.support.mockResolvedValue({supported: true});
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn()); vi.spyOn(performance, "now").mockReturnValue(0);
    const w = defaultAppearance().variants.dark.wallpaper; w.type = "shader"; w.effect = defaultEffect("noise"); w.effect.opacity = .6;
    const done = vi.fn();
    try {
      render(<ShaderWallpaper wallpaper={w} speed={1} duration={900} onComplete={done} />);
      await act(async () => {}); act(() => api.ready?.());
      const opacity = () => Number(screen.getByTestId("shader").style.opacity);
      expect(opacity()).toBe(0);
      act(() => frame?.(450)); expect(opacity()).toBeCloseTo(.6);
      expect(done).not.toHaveBeenCalled();
      act(() => frame?.(900)); expect(opacity()).toBeCloseTo(0); expect(done).toHaveBeenCalledOnce();
    } finally { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); }
  });
});


describe("visible noise with muted palettes", () => {
  it("retains perceptible tonal separation without changing stored colors", async () => {
    api.support.mockResolvedValue({ supported: true });
    const w = defaultAppearance().variants.dark.wallpaper;
    w.type = "shader"; w.colors = ["#183932", "#2E3D1E", "#203E3E", "#2B3038"]; w.effect = defaultEffect("noise");
    const view = render(<ShaderWallpaper wallpaper={w} speed={1} />); await act(async () => {});
    const props = () => JSON.parse(screen.getByTestId("noise").getAttribute("data-props")!);
    expect(props()).toMatchObject({ colorA: "#59706B", colorB: "#243017", speed: .35, opacity: 1 });
    expect(w.colors).toEqual(["#183932", "#2E3D1E", "#203E3E", "#2B3038"]);
    view.rerender(<ShaderWallpaper wallpaper={w} speed={2} />);
    expect(props().speed).toBe(.7);
  });
});


describe("refraction source detail", () => {
  it.each(["glass", "fluted-glass", "cursor-ripples"] as const)("gives %s visible source shapes to distort", async id => {
    api.support.mockResolvedValue({ supported: true });
    const w = defaultAppearance().variants.dark.wallpaper; w.type = "shader"; w.effect = defaultEffect(id);
    render(<ShaderWallpaper wallpaper={w} speed={1} />); await act(async () => {});
    expect(screen.getAllByTestId("radial")).toHaveLength(2);
    expect(screen.getByTestId(id).contains(screen.getByTestId("noise"))).toBe(true);
  });
});
