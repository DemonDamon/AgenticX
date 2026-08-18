import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePersistedThemeMode } from "./theme-preference";

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

function surfaceBase(css: string): string {
  const match = css.match(/--surface-base:\s*(#[0-9a-f]{6})\s*;/i);
  if (!match) throw new Error("--surface-base is missing");
  return match[1];
}

function hexLuminance(hex: string): number {
  const rgb = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = rgb.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

describe("desktop theme contract", () => {
  it("preserves every supported appearance mode from persisted layout", () => {
    expect(parsePersistedThemeMode("light")).toBe("light");
    expect(parsePersistedThemeMode("dim")).toBe("dim");
    expect(parsePersistedThemeMode("dark")).toBe("dark");
    expect(parsePersistedThemeMode("unknown")).toBeNull();
    expect(read("index.html")).toContain('savedTheme === "dim"');
  });

  it("keeps dim visibly lighter than dark", () => {
    const dim = surfaceBase(read("src/styles/themes/dim.css"));
    const dark = surfaceBase(read("src/styles/themes/dark.css"));
    expect(hexLuminance(dim)).toBeGreaterThan(hexLuminance(dark));
  });

  it("keeps the white accent fill white in every appearance", () => {
    const css = read("src/index.css");
    const whiteBlock = css.match(/:root\[data-theme-color="white"\]\s*\{([^}]*)\}/)?.[1] ?? "";
    const lightWhiteBlock =
      css.match(/:root\[data-theme="light"\]\[data-theme-color="white"\]\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(whiteBlock).toContain("--theme-color-rgb: 255, 255, 255");
    expect(lightWhiteBlock).not.toContain("--theme-color-rgb:");
  });
});
