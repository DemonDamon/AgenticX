import { beforeAll, describe, expect, it } from "vitest";
import {
  mapGuestRectToHostAnchor,
  parseBrowserGuestSelection,
} from "./browser-selection";

beforeAll(() => {
  // computePopupAnchorFromRect clamps against window.inner*
  Object.defineProperty(globalThis, "window", {
    value: { innerWidth: 1280, innerHeight: 800 },
    configurable: true,
  });
});

describe("parseBrowserGuestSelection", () => {
  it("returns null for empty text", () => {
    expect(parseBrowserGuestSelection({ text: "  ", rect: { top: 0, left: 0, width: 1, height: 1 } })).toBeNull();
    expect(parseBrowserGuestSelection(null)).toBeNull();
  });

  it("parses guest snapshot", () => {
    expect(
      parseBrowserGuestSelection({
        text: "选中段落",
        rect: { top: 10, left: 20, width: 100, height: 18 },
      })
    ).toEqual({
      text: "选中段落",
      rect: { top: 10, left: 20, width: 100, height: 18 },
    });
  });
});

describe("mapGuestRectToHostAnchor", () => {
  it("offsets guest rect by webview host position", () => {
    const anchor = mapGuestRectToHostAnchor(
      { top: 10, left: 20, width: 100, height: 20 },
      { top: 100, left: 200 }
    );
    // Center x ≈ 200 + 20 + 50 = 270; below selection ≈ 100 + 10 + 20 + gap
    expect(anchor.left).toBeGreaterThan(250);
    expect(anchor.left).toBeLessThan(290);
    expect(anchor.top).toBeGreaterThan(120);
  });

  it("scales with zoom", () => {
    const z1 = mapGuestRectToHostAnchor(
      { top: 10, left: 20, width: 40, height: 10 },
      { top: 0, left: 0 },
      { zoom: 1 }
    );
    const z2 = mapGuestRectToHostAnchor(
      { top: 10, left: 20, width: 40, height: 10 },
      { top: 0, left: 0 },
      { zoom: 2 }
    );
    expect(z2.left).toBeGreaterThan(z1.left);
  });
});
