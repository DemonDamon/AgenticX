import { describe, expect, it } from "vitest";
import {
  adaptSvgMarkupColors,
  __adaptSvgThemeTest,
} from "./adapt-svg-theme";

describe("adaptSvgMarkupColors", () => {
  it("rewrites dark canvas and light text to theme CSS variables", () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40">
  <rect width="100" height="40" fill="#0d1117"/>
  <text x="10" y="24" fill="#e6edf3">hello</text>
</svg>`;
    const out = adaptSvgMarkupColors(input);
    expect(out).toContain('fill="var(--surface-base-fallback)"');
    expect(out).toContain('fill="var(--text-primary)"');
    expect(out).toContain('data-agx-svg-theme="1"');
    expect(out).toContain("--svg-card-green");
  });

  it("rewrites gradient stop-colors", () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <defs><linearGradient id="g"><stop offset="0%" stop-color="#0d1117"/><stop offset="100%" stop-color="#161b22"/></linearGradient></defs>
  <rect width="10" height="10" fill="url(#g)"/>
</svg>`;
    const out = adaptSvgMarkupColors(input);
    expect(out).toContain('stop-color="var(--surface-base-fallback)"');
    expect(out).toContain('stop-color="var(--surface-popover)"');
    expect(out).toContain('fill="url(#g)"');
  });

  it("leaves semantic accent colors untouched", () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#22c55e"/><text fill="#fff">ok</text></svg>`;
    const out = adaptSvgMarkupColors(input);
    expect(out).toContain('fill="#22c55e"');
    expect(out).toContain('fill="#fff"');
  });

  it("is idempotent", () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#0d1117"/></svg>`;
    const once = adaptSvgMarkupColors(input);
    const twice = adaptSvgMarkupColors(once);
    expect((twice.match(/data-agx-svg-theme/g) ?? []).length).toBe(1);
    expect(twice).toContain('fill="var(--surface-base-fallback)"');
  });

  it("maps short hex via normalize", () => {
    expect(__adaptSvgThemeTest.mapColorToken("#000")).toBeNull(); // not in map
    expect(__adaptSvgThemeTest.mapColorToken("#0d1117")).toBe("var(--surface-base-fallback)");
    expect(__adaptSvgThemeTest.mapColorToken("  #E6EDF3 ")).toBe("var(--text-primary)");
  });
});
