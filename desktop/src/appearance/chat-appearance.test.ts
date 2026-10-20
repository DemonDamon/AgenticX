import { describe, expect, it } from "vitest";
import { defaultAppearance, defaultEffect, parseAppearance, presetAppearance, resolveAppearanceScope } from "../../shared/chat-appearance";
import { appearanceVariables, effectPreviewBackground, wallpaperBackground } from "./render";

describe("chat appearance contract", () => {
  it("inherits the existing theme and bubble colors by default", () => {
    const a = defaultAppearance();
    expect(a.variants.dark.wallpaper.type).toBe("default");
    expect(appearanceVariables(a, "dark", true)).toEqual({});
  });
  it("builds independent presets for all three modes", () => {
    const a = presetAppearance("mist");
    expect(parseAppearance(a)).toEqual(a);
    expect(a.variants.light.wallpaper.colors).not.toEqual(a.variants.dark.wallpaper.colors);
    a.variants.light.wallpaper.colors[0] = "#FFFFFF";
    expect(a.variants.dark.wallpaper.colors[0]).not.toBe("#FFFFFF");
  });
  it("rejects invalid colors, executable wallpaper fields and out-of-range parameters", () => {
    const a = defaultAppearance();
    a.variants.dark.wallpaper.colors = ["url(https://example.com)"];
    expect(() => parseAppearance(a)).toThrow();
    expect(() => parseAppearance({ ...defaultAppearance(), script: "alert(1)" })).toThrow();
    const b = defaultAppearance(); b.speed = 9;
    expect(() => parseAppearance(b)).toThrow();
  });
  it("resolves stable identities without using pane or session IDs", () => {
    expect(resolveAppearanceScope(null)).toBe("meta");
    expect(resolveAppearanceScope("group:g1")).toBe("group:g1");
    expect(resolveAppearanceScope("a1")).toBe("avatar:a1");
    expect(resolveAppearanceScope("automation:task")).toBe("global");
  });
});

function legacyAppearance() {
  const a = JSON.parse(JSON.stringify(presetAppearance("mist")));
  a.version = 1;
  for (const v of Object.values(a.variants) as Array<{wallpaper: Record<string, unknown>}>) delete v.wallpaper.effect;
  a.variants.dark.wallpaper.type = "shader";
  return a;
}
describe("background effect compatibility", () => {
  it("upgrades legacy shader without changing palettes or motion", () => {
    const old = legacyAppearance(); const upgraded = parseAppearance(old);
    expect(upgraded.version).toBe(2);
    expect(upgraded.motion).toBe(old.motion);
    expect(upgraded.variants.dark.wallpaper.colors).toEqual(old.variants.dark.wallpaper.colors);
    expect(upgraded.variants.dark.wallpaper.effect).toEqual({ id: "gradient", opacity: 1, params: {} });
    expect(upgraded.variants.light.wallpaper.effect).toBeNull();
    expect(old.version).toBe(1);
  });
  it.each(["noise", "ripples", "glass", "fluted-glass", "cursor-ripples"] as const)("roundtrips %s and rejects invalid parameters", id => {
    const a = defaultAppearance(); const w = a.variants.dark.wallpaper;
    w.type = "shader"; w.effect = defaultEffect(id);
    expect(parseAppearance(a)).toEqual(a);
    const invalid = JSON.parse(JSON.stringify(a));
    invalid.variants.dark.wallpaper.effect.params.script = "alert(1)";
    expect(() => parseAppearance(invalid)).toThrow();
    const outOfRange = JSON.parse(JSON.stringify(a));
    const key = Object.keys(outOfRange.variants.dark.wallpaper.effect.params)[0];
    outOfRange.variants.dark.wallpaper.effect.params[key] = Infinity;
    expect(() => parseAppearance(outOfRange)).toThrow();
  });
  it("rejects unknown effects, missing v2 fields, fractional seeds and unsupported versions", () => {
    const a = defaultAppearance(); a.variants.dark.wallpaper.type = "shader";
    a.variants.dark.wallpaper.effect = defaultEffect("noise");
    const raw = JSON.parse(JSON.stringify(a)); raw.variants.dark.wallpaper.effect.params.seed = 1.5;
    expect(() => parseAppearance(raw)).toThrow();
    raw.variants.dark.wallpaper.effect = {id: "script", opacity: .5, params: {}};
    expect(() => parseAppearance(raw)).toThrow();
    delete raw.variants.dark.wallpaper.effect;
    expect(() => parseAppearance(raw)).toThrow();
    expect(() => parseAppearance({...a, version: 3})).toThrow();
  });
});

describe("static effect fallbacks", () => {
  it.each([
    ["noise", /^radial-gradient/], ["ripples", /^repeating-radial-gradient/],
    ["glass", /^radial-gradient\(ellipse/], ["fluted-glass", /^repeating-linear-gradient/],
    ["cursor-ripples", /^linear-gradient/],
  ] as const)("uses a local %s approximation with the saved palette", (id, pattern) => {
    const w = defaultAppearance().variants.dark.wallpaper; w.type = "shader"; w.effect = defaultEffect(id);
    w.colors = ["#123456", "#ABCDEF"];
    const css = wallpaperBackground(w)!;
    expect(css).toMatch(pattern); expect(css).toContain("#123456"); expect(css).toContain("#ABCDEF");
    expect(css).not.toMatch(/url\(|https?:/);
  });
  it("updates static pattern strength and flute direction without changing the base colors", () => {
    const w = defaultAppearance().variants.dark.wallpaper; w.type = "shader"; w.effect = defaultEffect("fluted-glass");
    w.effect.opacity = 0; w.effect.params.angle = 45;
    const transparent = wallpaperBackground(w)!;
    expect(transparent).toContain("135deg"); expect(transparent).toContain("#A5B4FC00");
    w.effect.opacity = 1;
    expect(wallpaperBackground(w)).toContain("#A5B4FC30");
  });
});


describe("effect selection thumbnails", () => {
  it("gives every effect a distinct visible motif even with identical background colors", () => {
    const w = defaultAppearance().variants.dark.wallpaper; w.type = "shader"; w.colors = ["#243444", "#243444"];
    const previews = ["gradient", "noise", "ripples", "glass", "fluted-glass", "cursor-ripples"].map(id => effectPreviewBackground({ ...w, effect: defaultEffect(id as Parameters<typeof defaultEffect>[0]) }));
    expect(new Set(previews).size).toBe(6);
    expect(previews[2]).toContain("repeating-radial-gradient");
    expect(previews[3]).toContain("ellipse");
    expect(previews[4]).toContain("repeating-linear-gradient");
    expect(previews[5]).toContain("72% 60%");
    expect(w.colors).toEqual(["#243444", "#243444"]);
  });
});
