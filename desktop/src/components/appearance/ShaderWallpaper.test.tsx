// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppearance } from "../../../shared/chat-appearance";
import { useAppearanceStore } from "../../appearance/store";
const api = vi.hoisted(() => ({ support: vi.fn(), unavailable: undefined as undefined | (() => void), telemetry: false, ready: undefined as undefined | (() => void) }));
vi.mock("../../appearance/shader-runtime", () => ({
  getWebGPUSupport: api.support,
  Shader: ({ onUnavailable, onReady, disableTelemetry }: { onUnavailable: () => void; onReady: () => void; disableTelemetry: boolean }) => { api.ready = onReady; api.unavailable = onUnavailable; api.telemetry = disableTelemetry; return null; },
  LinearGradient: () => null,
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
