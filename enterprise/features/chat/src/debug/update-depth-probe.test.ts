import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetUpdateDepthProbeForTests,
  clearUpdateDepthProbeBuffer,
  getUpdateDepthProbeBuffer,
  isUpdateDepthProbeEnabled,
  probeNote,
} from "./update-depth-probe";

describe("update-depth-probe", () => {
  beforeEach(() => {
    __resetUpdateDepthProbeForTests();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      location: { search: "" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetUpdateDepthProbeForTests();
  });

  it("is disabled by default and probeNote is a no-op", () => {
    expect(isUpdateDepthProbeEnabled()).toBe(false);
    probeNote("stream.delta", { n: 1 });
    expect(getUpdateDepthProbeBuffer()).toHaveLength(0);
  });

  it("records notes when localStorage flag is on", () => {
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue("1");
    expect(isUpdateDepthProbeEnabled()).toBe(true);
    probeNote("MessageList.scrollEffect");
    probeNote("switchModel", { model: "m" });
    const buf = getUpdateDepthProbeBuffer();
    expect(buf).toHaveLength(2);
    expect(buf[0]?.source).toBe("MessageList.scrollEffect");
    expect(buf[1]?.detail).toEqual({ model: "m" });
  });

  it("records notes when query flag is on", () => {
    (window as unknown as { location: { search: string } }).location = {
      search: "?agxUpdateDepthProbe=1",
    };
    expect(isUpdateDepthProbeEnabled()).toBe(true);
    probeNote("ReasoningBlock.effect");
    expect(getUpdateDepthProbeBuffer()).toHaveLength(1);
  });

  it("caps the ring buffer at 200 entries", () => {
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue("1");
    for (let i = 0; i < 250; i += 1) {
      probeNote("stream.delta", { i });
    }
    const buf = getUpdateDepthProbeBuffer();
    expect(buf).toHaveLength(200);
    expect(buf[0]?.detail).toEqual({ i: 50 });
    expect(buf[199]?.detail).toEqual({ i: 249 });
  });

  it("clearUpdateDepthProbeBuffer empties the ring", () => {
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue("1");
    probeNote("x");
    clearUpdateDepthProbeBuffer();
    expect(getUpdateDepthProbeBuffer()).toHaveLength(0);
  });
});
