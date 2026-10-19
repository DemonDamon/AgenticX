import { describe, expect, it } from "vitest";
import { defaultAppearance, parseAppearance, presetAppearance, resolveAppearanceScope } from "../../shared/chat-appearance";
import { appearanceVariables } from "./render";

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
