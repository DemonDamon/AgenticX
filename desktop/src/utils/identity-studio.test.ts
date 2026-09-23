import { describe, expect, it } from "vitest";
import {
  STUDIO_STYLE_IDS,
  buildStudioSvgDataUri,
  defaultRecipe,
  normalizeOptions,
  randomStudioSeed,
  stylePreviewDataUri,
} from "./identity-studio";

function decodeSvgDataUri(uri: string): string {
  const marker = "base64,";
  const base64At = uri.indexOf(marker);
  if (base64At >= 0) {
    return Buffer.from(uri.slice(base64At + marker.length), "base64").toString("utf8");
  }
  const comma = uri.indexOf(",");
  return decodeURIComponent(uri.slice(comma + 1));
}

describe("identity studio generator", () => {
  it("defaults to a line-art style seeded by the nickname", () => {
    const recipe = defaultRecipe("阿来");
    expect(recipe.source).toBe("studio");
    expect(recipe.style).toBe("notionists-neutral");
    expect(recipe.seed).toBe("阿来");
    expect(recipe.seedFrozen).toBe(false);
  });

  it("builds an svg data uri for every curated style", () => {
    for (const style of STUDIO_STYLE_IDS) {
      const uri = buildStudioSvgDataUri({
        ...defaultRecipe("Felix"),
        style,
        options: { glasses: false, hair: "short", background: "none", unknown: "drop-me" },
      });
      expect(uri.startsWith("data:image/svg+xml")).toBe(true);
      const svg = decodeSvgDataUri(uri);
      expect(svg).toContain("<svg");
      expect(svg).toContain('data-portrait="identity-studio"');
      expect(svg).not.toContain('data-portrait="near-cube');
      expect(svg).not.toContain("drop-me");
    }
  });

  it("drops option keys the style does not understand", () => {
    const normalized = normalizeOptions("notionists-neutral", {
      glasses: true,
      hair: "long",
      background: "light",
      notARealOption: "drop-me",
    });
    expect(normalized).not.toHaveProperty("notARealOption");
    expect(normalized).not.toHaveProperty("hair");
    expect(JSON.stringify(normalized)).not.toContain("drop-me");
    expect(normalized.glassesProbability).toBe(100);
    expect(normalized.backgroundColor).toEqual(["e7e5e4"]);
  });

  it("draws a new seed on each shuffle", () => {
    const first = randomStudioSeed();
    const second = randomStudioSeed();
    expect(first.startsWith("studio-")).toBe(true);
    expect(second.startsWith("studio-")).toBe(true);
    expect(first).not.toBe(second);
  });

  it("keeps style-rail previews on the fixed Felix seed", () => {
    const rail = stylePreviewDataUri("lorelei-neutral");
    const same = stylePreviewDataUri("lorelei-neutral");
    const user = buildStudioSvgDataUri({
      ...defaultRecipe("阿来"),
      style: "lorelei-neutral",
    });
    expect(rail).toBe(same);
    expect(rail).not.toBe(user);
  });
});
