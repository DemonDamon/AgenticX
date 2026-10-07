import { describe, expect, it } from "vitest";
import {
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
import { MARK_INVERT_BRANDS } from "./brand-assets";
import { pickBrandIcon } from "./icon-model";

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

  it("inverts white Notion mark only in light theme", () => {
    const src =
      "data:image/svg+xml," +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><path fill="#fff" d="M0"/></svg>');
    expect(shouldInvertMark("Notion", "notion", src, false)).toBe(true);
    expect(shouldInvertMark("Notion", "notion", src, true)).toBe(false);
    expect(shouldInvertMark("Notion", "notion", undefined, false)).toBe(true);
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

  it("allows chromatic Simple Icons brand tint in light theme", () => {
    const docker = pickTileBackground({
      name: "Docker",
      brandKey: "docker",
      src: "https://cdn.simpleicons.org/docker",
      mark: true,
      invert: false,
      darkLike: false,
    });
    expect(docker).toBe("#2496ED");
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
