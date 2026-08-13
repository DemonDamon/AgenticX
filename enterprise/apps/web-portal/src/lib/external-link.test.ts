import { afterEach, describe, expect, it, vi } from "vitest";

import { navigateToExternalLink } from "./external-link";

describe("navigateToExternalLink", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("opens the interstitial in a separate tab without unloading the chat", () => {
    const replace = vi.fn();
    const openedWindow = {
      opener: {} as unknown,
      location: { replace },
      close: vi.fn(),
    };
    const open = vi.fn(() => openedWindow);
    const assign = vi.fn();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { open, location: { assign } },
    });

    navigateToExternalLink("https://example.com/a?q=1", "示例来源");

    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(replace).toHaveBeenCalledWith(
      "/external-link?url=https%3A%2F%2Fexample.com%2Fa%3Fq%3D1&title=%E7%A4%BA%E4%BE%8B%E6%9D%A5%E6%BA%90",
    );
    expect(openedWindow.opener).toBeNull();
    expect(openedWindow.close).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("keeps an external link usable when a browser blocks the new tab", () => {
    const open = vi.fn(() => null);
    const assign = vi.fn();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { open, location: { assign } },
    });

    navigateToExternalLink("https://example.com/report");

    expect(assign).toHaveBeenCalledWith(
      "/external-link?url=https%3A%2F%2Fexample.com%2Freport",
    );
  });

  it("closes a tab that cannot be navigated before using the same-tab fallback", () => {
    const close = vi.fn();
    const assign = vi.fn();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        open: vi.fn(() => ({
          opener: null,
          location: {
            replace: vi.fn(() => {
              throw new Error("navigation blocked");
            }),
          },
          close,
        })),
        location: { assign },
      },
    });

    navigateToExternalLink("https://example.com/report");

    expect(close).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith(
      "/external-link?url=https%3A%2F%2Fexample.com%2Freport",
    );
  });

  it.each([
    "javascript:alert(1)",
    "file:///tmp/private",
    "/workspace",
    "not a url",
  ])("ignores a non-http external target: %s", (target) => {
    const open = vi.fn(() => ({ opener: null }));
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { open },
    });

    navigateToExternalLink(target);

    expect(open).not.toHaveBeenCalled();
  });
});
