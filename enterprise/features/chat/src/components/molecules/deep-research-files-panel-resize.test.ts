import { describe, expect, it } from "vitest";
import {
  FILES_PANEL_CHAT_MIN_PX,
  FILES_PANEL_MAX_RATIO,
  FILES_PANEL_MIN_PX,
  clampFilesPanelWidth,
  defaultFilesPanelWidth,
} from "./deep-research-files-panel-resize";

describe("clampFilesPanelWidth", () => {
  it("keeps chat at least CHAT_MIN_PX and panel within MAX_RATIO", () => {
    const container = 1400;
    const max = Math.min(
      Math.floor(container * FILES_PANEL_MAX_RATIO),
      container - FILES_PANEL_CHAT_MIN_PX,
    );
    expect(clampFilesPanelWidth(2000, container)).toBe(max);
    expect(container - max).toBeGreaterThanOrEqual(FILES_PANEL_CHAT_MIN_PX);
  });

  it("does not shrink the panel below MIN when there is room", () => {
    expect(clampFilesPanelWidth(100, 1400)).toBe(FILES_PANEL_MIN_PX);
  });

  it("on a narrow container still leaves chat min when possible", () => {
    const container = 700;
    const clamped = clampFilesPanelWidth(500, container);
    expect(container - clamped).toBeGreaterThanOrEqual(FILES_PANEL_CHAT_MIN_PX);
    expect(clamped).toBeLessThanOrEqual(Math.floor(container * FILES_PANEL_MAX_RATIO));
  });

  it("uses the full container when two usable columns cannot fit", () => {
    const container = FILES_PANEL_CHAT_MIN_PX + FILES_PANEL_MIN_PX - 1;
    expect(clampFilesPanelWidth(180, container)).toBe(container);
    expect(defaultFilesPanelWidth(497, { htmlPreview: true })).toBe(497);
  });
});

describe("defaultFilesPanelWidth", () => {
  it("picks a wider default for html preview than browse", () => {
    const browse = defaultFilesPanelWidth(1400, { htmlPreview: false });
    const html = defaultFilesPanelWidth(1400, { htmlPreview: true });
    expect(html).toBeGreaterThan(browse);
    expect(html).toBeLessThanOrEqual(Math.floor(1400 * FILES_PANEL_MAX_RATIO));
  });
});
