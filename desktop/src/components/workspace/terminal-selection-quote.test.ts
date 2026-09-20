/** @vitest-environment jsdom */
import { beforeAll, describe, expect, it } from "vitest";
import {
  computeTerminalSelectionAnchor,
  normalizeTerminalQuoteText,
  readXtermSelectionOverlayRects,
} from "./terminal-selection-quote";

beforeAll(() => {
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
});

describe("normalizeTerminalQuoteText", () => {
  it("returns null for empty or whitespace-only selection", () => {
    expect(normalizeTerminalQuoteText("")).toBeNull();
    expect(normalizeTerminalQuoteText("   \n\t  ")).toBeNull();
    expect(normalizeTerminalQuoteText("\u00a0\u00a0")).toBeNull();
  });

  it("keeps traceback newlines and trims outer whitespace", () => {
    const raw = "\n  HTTPError: HTTP Error 422: Unprocessable Entity\n    at opener\n";
    expect(normalizeTerminalQuoteText(raw)).toBe(
      "HTTPError: HTTP Error 422: Unprocessable Entity\n    at opener"
    );
  });

  it("normalizes CRLF from pty copies", () => {
    expect(normalizeTerminalQuoteText("line1\r\nline2\r")).toBe("line1\nline2");
  });
});

describe("computeTerminalSelectionAnchor", () => {
  it("returns null when overlays are empty or zero-sized", () => {
    expect(computeTerminalSelectionAnchor([])).toBeNull();
    expect(computeTerminalSelectionAnchor([{ left: 10, top: 10, width: 0, height: 0 }])).toBeNull();
  });

  it("anchors below the last non-empty overlay rect", () => {
    const anchor = computeTerminalSelectionAnchor([
      { left: 20, top: 40, width: 80, height: 16 },
      { left: 100, top: 200, width: 120, height: 16 },
    ]);
    expect(anchor).not.toBeNull();
    expect(anchor!.left).toBeGreaterThan(140);
    expect(anchor!.left).toBeLessThan(180);
    expect(anchor!.top).toBeGreaterThan(216);
  });
});

describe("readXtermSelectionOverlayRects", () => {
  it("reads geometry from .xterm-selection overlay divs", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div class="xterm-selection"><div></div><div></div></div>`;
    const overlays = root.querySelectorAll(".xterm-selection div");
    overlays[0]!.getBoundingClientRect = () =>
      ({ left: 8, top: 12, width: 40, height: 14, right: 48, bottom: 26 } as DOMRect);
    overlays[1]!.getBoundingClientRect = () =>
      ({ left: 8, top: 28, width: 90, height: 14, right: 98, bottom: 42 } as DOMRect);

    expect(readXtermSelectionOverlayRects(root)).toEqual([
      { left: 8, top: 12, width: 40, height: 14 },
      { left: 8, top: 28, width: 90, height: 14 },
    ]);
  });
});
