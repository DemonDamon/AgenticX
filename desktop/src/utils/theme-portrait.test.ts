import { describe, expect, it } from "vitest";
import { isNearCubePortraitUrl, lineArtSvgWithCurrentColor, prepareThemedPortraitMarkup } from "./theme-portrait";

describe("lineArtSvgWithCurrentColor", () => {
  it("rewrites black and palette ink, keeps white fills", () => {
    const svg =
      '<svg viewBox="0 0 1744 1744"><path fill="#000"/><path fill="#ea580c"/><path fill="#fff"/></svg>';
    expect(lineArtSvgWithCurrentColor(svg)).toBe(
      '<svg viewBox="0 0 1744 1744"><path fill="currentColor"/><path fill="currentColor"/><path fill="#fff"/></svg>',
    );
  });
});

describe("prepareThemedPortraitMarkup", () => {
  it("returns null for raster or remote photos", () => {
    expect(prepareThemedPortraitMarkup("data:image/png;base64,abc")).toBeNull();
    expect(prepareThemedPortraitMarkup("https://example.test/photo.png")).toBeNull();
  });

  it("rewrites a generated SVG data URL so ink follows the theme", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1744 1744"><path fill="#e11d48"/><path fill="#fff"/></svg>';
    const url = `data:image/svg+xml;base64,${btoa(svg)}`;
    const markup = prepareThemedPortraitMarkup(url);
    expect(markup).toContain("currentColor");
    expect(markup).toContain('fill="#fff"');
    expect(markup).not.toContain("#e11d48");
  });

  it("leaves Near cube colorways untouched", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" data-portrait="near-cube-v1" data-colorway="sunset"><path fill="#000" opacity="0.10"/><path fill="#FB7185"/></svg>';
    const url = `data:image/svg+xml;base64,${btoa(svg)}`;
    expect(prepareThemedPortraitMarkup(url)).toBeNull();
    expect(isNearCubePortraitUrl(url)).toBe(true);
    expect(isNearCubePortraitUrl("data:image/png;base64,abc")).toBe(false);
    expect(isNearCubePortraitUrl("/assets/near-cube-mark-ab12cd.svg")).toBe(true);
    expect(isNearCubePortraitUrl("/assets/export_embedded.png")).toBe(false);
  });

  it("leaves collection character portraits untouched", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" data-portrait="dicebear-lorelei" viewBox="0 0 128 128"><path fill="#000"/></svg>';
    const url = `data:image/svg+xml;base64,${btoa(svg)}`;
    expect(prepareThemedPortraitMarkup(url)).toBeNull();
  });
});
