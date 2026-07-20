import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { injectHtmlPreviewTheme, stripHtmlPreviewTheme } from "./html-preview-theme";

describe("html-preview-theme", () => {
  beforeEach(() => {
    const docEl = { tagName: "HTML" };
    const body = { tagName: "BODY", style: { fontFamily: "Inter, system-ui" } };
    vi.stubGlobal("document", {
      documentElement: docEl,
      body,
    });
    vi.stubGlobal("getComputedStyle", (el: { tagName?: string }) => ({
      fontFamily: "Inter, system-ui",
      getPropertyValue: (name: string) => {
        if (el?.tagName === "HTML" && name === "--text-primary") return "#111827";
        if (el?.tagName === "HTML" && name === "--surface-base") return "#ffffff";
        return "";
      },
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("injects data-theme and color-scheme for light", () => {
    const html = "<!DOCTYPE html><html><head></head><body>hi</body></html>";
    const out = injectHtmlPreviewTheme(html, "light");
    expect(out).toContain('data-theme="light"');
    expect(out).toContain("color-scheme: light");
    expect(out).toContain('name="color-scheme"');
    expect(out).toContain("data-agx-preview-theme");
    expect(out).toContain("--text-primary: #111827");
  });

  it("maps dim to dark color-scheme", () => {
    const html = "<html><head></head><body></body></html>";
    const out = injectHtmlPreviewTheme(html, "dim");
    expect(out).toContain('data-theme="dim"');
    expect(out).toContain("color-scheme: dark");
  });

  it("is idempotent when theme changes", () => {
    const html = "<html><head><title>t</title></head><body></body></html>";
    const once = injectHtmlPreviewTheme(html, "dark");
    const twice = injectHtmlPreviewTheme(once, "light");
    expect((twice.match(/data-agx-preview-theme/g) ?? []).length).toBe(2); // meta + style
    expect(twice).toContain('data-theme="light"');
    expect(twice).not.toContain('data-theme="dark"');
  });

  it("stripHtmlPreviewTheme removes injection marks", () => {
    const html = injectHtmlPreviewTheme(
      "<html><head></head><body></body></html>",
      "light",
    );
    const stripped = stripHtmlPreviewTheme(html);
    expect(stripped).not.toContain("data-agx-preview-theme");
    expect(stripped).not.toContain('data-theme="light"');
  });
});
