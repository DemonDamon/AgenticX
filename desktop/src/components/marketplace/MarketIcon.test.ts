import { describe, expect, it } from "vitest";
import {
  classifySvgTone,
  decodeSvgDataUri,
  extractSvgFillColors,
  resolveMarkTone,
  isDarkLikeTheme,
  isMarkStyleAsset,
  isNearBlackColor,
  isNearBlackMonochromeSvgDataUri,
  isNearWhiteMonochromeSvgDataUri,
  MARK_INVERT_FILTER,
  MARK_TO_DARK_FILTER,
  NEUTRAL_TILE_BG_DARK,
  NEUTRAL_TILE_BG_LIGHT,
  neutralTileBg,
  pickTileBackground,
  shouldInvertMark,
} from "./MarketIcon";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BRAND_ICON_SRC, MARK_INVERT_BRANDS, MARK_TONE } from "./brand-assets";
import { pickBrandIcon } from "./icon-model";

const ASSETS_DIR = resolve(process.cwd(), "src/assets/connectors");
function readAsset(rel: string): string {
  return readFileSync(resolve(ASSETS_DIR, rel), "utf8");
}
function svgUri(svg: string): string {
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

describe("isMarkStyleAsset", () => {
  it("treats Vite-inlined SVG data URIs as logo marks (not cover tiles)", () => {
    expect(
      isMarkStyleAsset(
        "data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20256%20193'%3e%3c/svg%3e",
      ),
    ).toBe(true);
    expect(isMarkStyleAsset("data:image/svg+xml;base64,PHN2Zy4uLj4=")).toBe(true);
  });

  it("treats .svg URLs and Simple Icons CDN as marks", () => {
    expect(isMarkStyleAsset("/assets/gmail-abc123.svg")).toBe(true);
    expect(isMarkStyleAsset("./assets/supabase.svg")).toBe(true);
    expect(isMarkStyleAsset("https://cdn.simpleicons.org/docker")).toBe(true);
  });

  it("does not treat raster PNGs as marks", () => {
    expect(isMarkStyleAsset("/src/assets/connectors/stubs/dingtalk.png")).toBe(false);
    expect(isMarkStyleAsset("data:image/png;base64,aaa")).toBe(false);
  });
});

describe("isNearBlackColor", () => {
  it("detects near-black hex used by GitHub / Agent Mail marks", () => {
    expect(isNearBlackColor("#161614")).toBe(true);
    expect(isNearBlackColor("#111111")).toBe(true);
    expect(isNearBlackColor("#000")).toBe(true);
    expect(isNearBlackColor("black")).toBe(true);
  });

  it("rejects brand / light colors", () => {
    expect(isNearBlackColor("#FC6D26")).toBe(false);
    expect(isNearBlackColor("#fff")).toBe(false);
    expect(isNearBlackColor("none")).toBe(false);
  });
});

describe("isNearBlackMonochromeSvgDataUri", () => {
  it("flags GitHub-like near-black monochrome data-URI SVG", () => {
    const src =
      "data:image/svg+xml," +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><path fill="#161614" d="M0 0h1v1z"/></svg>');
    expect(isNearBlackMonochromeSvgDataUri(src)).toBe(true);
  });

  it("flags Agent Mail-like near-black monochrome data-URI SVG", () => {
    const src =
      "data:image/svg+xml," +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><path fill="#111111" d="M0 0h1v1z"/></svg>');
    expect(isNearBlackMonochromeSvgDataUri(src)).toBe(true);
  });

  it("does not flag multicolor logos", () => {
    const src =
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#EA4335" d="M0"/><path fill="#34A853" d="M1"/></svg>',
      );
    expect(isNearBlackMonochromeSvgDataUri(src)).toBe(false);
  });

  it("does not flag white-only marks (local Notion)", () => {
    const src =
      "data:image/svg+xml," +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><path fill="#fff" d="M0 0h1v1z"/></svg>');
    expect(isNearBlackMonochromeSvgDataUri(src)).toBe(false);
  });
});

describe("shouldInvertMark", () => {
  it("inverts GitHub via brand table and name", () => {
    expect(MARK_INVERT_BRANDS.has("github")).toBe(true);
    expect(shouldInvertMark("GitHub", "github")).toBe(true);
    expect(shouldInvertMark("GitHub MCP Server")).toBe(true);
  });

  it("inverts Agent Mail / qqmail", () => {
    expect(MARK_INVERT_BRANDS.has("qqmail")).toBe(true);
    expect(pickBrandIcon("Agent Mail")).toEqual({ brand: "qqmail" });
    expect(shouldInvertMark("Agent Mail", "qqmail")).toBe(true);
    expect(shouldInvertMark("Agent Mail")).toBe(true);
  });

  it("inverts near-black data-URI SVG even without brand key", () => {
    const src =
      "data:image/svg+xml," +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><path fill="#111111" d="M0"/></svg>');
    expect(shouldInvertMark("Unknown Connector", undefined, src)).toBe(true);
  });

  it("does not invert multicolor marks", () => {
    const src =
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#EA4335" d="M0"/><path fill="#4285F4" d="M1"/></svg>',
      );
    expect(shouldInvertMark("Gmail", "gmail", src)).toBe(false);
  });
});

describe("isNearWhiteMonochromeSvgDataUri", () => {
  it("flags Notion-like white-only data-URI SVG", () => {
    const src =
      "data:image/svg+xml," +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><path fill="#fff" d="M0 0h1v1z"/></svg>');
    expect(isNearWhiteMonochromeSvgDataUri(src)).toBe(true);
  });

  it("does not flag near-black or multicolor marks", () => {
    const black =
      "data:image/svg+xml," +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><path fill="#161614" d="M0"/></svg>');
    const multi =
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#EA4335" d="M0"/><path fill="#fff" d="M1"/></svg>',
      );
    expect(isNearWhiteMonochromeSvgDataUri(black)).toBe(false);
    expect(isNearWhiteMonochromeSvgDataUri(multi)).toBe(false);
  });
});

describe("theme-adaptive MarketIcon tiles", () => {
  it("maps dark/dim vs light to neutral tile colors", () => {
    expect(isDarkLikeTheme("dark")).toBe(true);
    expect(isDarkLikeTheme("dim")).toBe(true);
    expect(isDarkLikeTheme("light")).toBe(false);
    expect(neutralTileBg(true)).toBe(NEUTRAL_TILE_BG_DARK);
    expect(neutralTileBg(false)).toBe(NEUTRAL_TILE_BG_LIGHT);
    expect(NEUTRAL_TILE_BG_DARK).toBe("#1C1C1E");
    expect(NEUTRAL_TILE_BG_LIGHT).toBe("#F2F2F7");
  });

  it("does not invert near-black marks in light theme", () => {
    expect(shouldInvertMark("GitHub", "github", undefined, false)).toBe(false);
    expect(shouldInvertMark("Agent Mail", "qqmail", undefined, false)).toBe(false);
    const src =
      "data:image/svg+xml," +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><path fill="#111111" d="M0"/></svg>');
    expect(shouldInvertMark("Unknown Connector", undefined, src, false)).toBe(false);
  });

  it("still inverts near-black marks in dark theme", () => {
    expect(shouldInvertMark("GitHub", "github", undefined, true)).toBe(true);
    expect(shouldInvertMark("Agent Mail", "qqmail", undefined, true)).toBe(true);
  });

  it("darkens a white-only monochrome mark only in light theme", () => {
    const src =
      "data:image/svg+xml," +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><path fill="#fff" d="M0"/></svg>');
    expect(shouldInvertMark("Some White Mark", undefined, src, false)).toBe(true);
    expect(shouldInvertMark("Some White Mark", undefined, src, true)).toBe(false);
  });

  it("never filters the two-tone Notion mark (regression: solid black blob in light theme)", () => {
    expect(MARK_TONE.notion).toBe("duo");
    for (const darkLike of [false, true]) {
      expect(shouldInvertMark("Notion", "notion", undefined, darkLike)).toBe(false);
      expect(shouldInvertMark("Notion", "notion", "/src/assets/connectors/notion.svg", darkLike)).toBe(false);
      expect(shouldInvertMark("Notion 笔记", undefined, svgUri(readAsset("notion.svg")), darkLike)).toBe(false);
    }
  });

  it("uses light neutral tile for multicolor / raster logos in light theme", () => {
    const feishu = pickTileBackground({
      name: "Feishu",
      brandKey: "feishu",
      src: "/assets/connectors/feishu.svg",
      mark: true,
      invert: false,
      darkLike: false,
    });
    const gmail = pickTileBackground({
      name: "Gmail",
      brandKey: "gmail",
      src: "/assets/connectors/gmail.svg",
      mark: true,
      invert: false,
      darkLike: false,
    });
    const wecom = pickTileBackground({
      name: "WeCom",
      src: "/assets/connectors/wecom.svg",
      mark: true,
      invert: false,
      darkLike: false,
    });
    expect(feishu).toBe(NEUTRAL_TILE_BG_LIGHT);
    expect(gmail).toBe(NEUTRAL_TILE_BG_LIGHT);
    expect(wecom).toBe(NEUTRAL_TILE_BG_LIGHT);
  });

  it("keeps dark neutral tile in dark theme for multicolor marks", () => {
    const feishu = pickTileBackground({
      name: "Feishu",
      brandKey: "feishu",
      src: "/assets/connectors/feishu.svg",
      mark: true,
      invert: false,
      darkLike: true,
    });
    expect(feishu).toBe(NEUTRAL_TILE_BG_DARK);
  });

  it("avoids near-black brand pads in light theme even for Simple Icons", () => {
    const vercel = pickTileBackground({
      name: "Vercel",
      brandKey: "vercel",
      src: "https://cdn.simpleicons.org/vercel",
      mark: true,
      invert: false,
      darkLike: false,
    });
    expect(vercel).toBe(NEUTRAL_TILE_BG_LIGHT);
  });

  it("keeps Simple Icons (brand-coloured glyph) on a neutral tile in both themes", () => {
    for (const darkLike of [false, true]) {
      const docker = pickTileBackground({
        name: "Docker",
        brandKey: "docker",
        src: "https://cdn.simpleicons.org/docker",
        mark: true,
        invert: false,
        darkLike,
      });
      // 旧口径铺 #2496ED → 蓝标在蓝底上隐身。
      expect(docker).toBe(neutralTileBg(darkLike));
    }
  });

  it("uses brand/dark tint for inverted marks in dark theme", () => {
    const github = pickTileBackground({
      name: "GitHub",
      brandKey: "github",
      src: "/assets/connectors/github.svg",
      mark: true,
      invert: true,
      darkLike: true,
    });
    expect(github).toBe("#24292F");
  });

  it("exports opposite mark filters for dark vs light", () => {
    expect(MARK_INVERT_FILTER).toContain("invert");
    expect(MARK_TO_DARK_FILTER).toBe("brightness(0)");
  });
});

describe("SVG tone classification (implicit fills)", () => {
  it("counts shapes without a fill attribute as default black", () => {
    expect(extractSvgFillColors('<svg><path d="M0"/></svg>')).toEqual(["#000000"]);
    expect(classifySvgTone('<svg><path fill="#fff" d="M0"/><path d="M1"/></svg>')).toBe("duo");
  });

  it("inherits root / group fill and honours fill=none", () => {
    expect(classifySvgTone('<svg fill="#FFFFFF"><path d="M0"/></svg>')).toBe("light");
    expect(classifySvgTone('<svg fill="none"><path fill="#111111" d="M0"/></svg>')).toBe("dark");
    expect(classifySvgTone('<svg><g fill="#5E6AD2"><path d="M0"/></g></svg>')).toBe("color");
    expect(classifySvgTone('<svg><g fill="#fff"><path d="M0"/></g><path d="M1"/></svg>')).toBe("duo");
  });

  it("does not report the official Notion SVG as white-only", () => {
    const uri = svgUri(readAsset("notion.svg"));
    expect(isNearWhiteMonochromeSvgDataUri(uri)).toBe(false);
    expect(isNearBlackMonochromeSvgDataUri(uri)).toBe(false);
    expect(resolveMarkTone("Notion", undefined, uri)).toBe("duo");
  });
});

describe("bundled monochrome assets stay readable in both themes", () => {
  // 资产 → 期望口径;dark 只在深色主题反白,light 只在浅色主题压黑,其余不加滤镜。
  const cases: Array<[string, string, string | undefined, "dark" | "light" | "duo" | "color"]> = [
    ["GitHub", "github.svg", "github", "dark"],
    ["Agent Mail", "qqmail.svg", "qqmail", "dark"],
    ["Notion", "notion.svg", "notion", "duo"],
    ["Linear", "stubs/linear.svg", undefined, "color"],
    ["Cloudflare", "stubs/cloudflare.svg", undefined, "color"],
    ["GitLab", "stubs/gitlab.svg", undefined, "color"],
  ];
  for (const [name, file, brand, tone] of cases) {
    it(`${name} (${file}) → ${tone}`, () => {
      const uri = svgUri(readAsset(file));
      expect(resolveMarkTone("x-" + file, undefined, uri)).toBe(tone);
      expect(shouldInvertMark(name, brand, uri, true)).toBe(tone === "dark");
      expect(shouldInvertMark(name, brand, uri, false)).toBe(tone === "light");
    });
  }

  it("brand tone table agrees with the bundled SVGs", () => {
    let checked = 0;
    for (const [brand, tone] of Object.entries(MARK_TONE)) {
      const src = BRAND_ICON_SRC[brand];
      if (!src) continue;
      const svg = src.startsWith("data:") ? decodeSvgDataUri(src) : readAsset(src.split("/assets/connectors/")[1] ?? "");
      expect(svg, brand).toBeTruthy();
      expect(classifySvgTone(svg ?? ""), brand).toBe(tone);
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(3); // github / qqmail / notion
  });

  it("near-black CDN brands (Vercel/X-like) invert only in dark theme and sit on a dark tile", () => {
    expect(shouldInvertMark("Vercel", "vercel", "https://cdn.simpleicons.org/vercel", true)).toBe(true);
    expect(shouldInvertMark("Vercel", "vercel", "https://cdn.simpleicons.org/vercel", false)).toBe(false);
    const tile = pickTileBackground({
      name: "Vercel",
      brandKey: "vercel",
      src: "https://cdn.simpleicons.org/vercel",
      mark: true,
      invert: true,
      darkLike: true,
    });
    expect(tile).toBe("#000000");
  });
});
