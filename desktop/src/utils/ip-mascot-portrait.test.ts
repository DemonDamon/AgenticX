import { describe, expect, it } from "vitest";
import { buildIpMascotPortraitDataUri, buildIpMascotPortraitSvg } from "./ip-mascot-portrait";

describe("ip mascot portrait", () => {
  it("is deterministic for one seed", () => {
    expect(buildIpMascotPortraitSvg("飞坦:abc")).toBe(buildIpMascotPortraitSvg("飞坦:abc"));
  });

  it("marks the svg", () => {
    expect(buildIpMascotPortraitSvg("x")).toContain('data-portrait="ip-mascot"');
  });

  it("fills a solid background and uses a lower corner", () => {
    const svg = buildIpMascotPortraitSvg("seed-1");
    expect(svg).toMatch(/data-corner="(left|right)"/);
    expect(svg).toContain("<rect");
    expect(svg).not.toContain('role="img"');
  });

  it("varies species across seeds", () => {
    const set = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map((s) => {
        const m = buildIpMascotPortraitSvg(s).match(/data-species="([^"]+)"/);
        return m?.[1];
      }),
    );
    expect(set.size).toBeGreaterThanOrEqual(3);
  });

  it("uses a square viewBox so tiles from 20px to 56px stay sharp", () => {
    const svg = buildIpMascotPortraitSvg("Felix");
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(svg).toContain('width="64"');
    expect(svg).toContain('height="64"');
  });

  it("spreads background colors across nearby seeds", () => {
    const backgrounds = new Set(
      Array.from({ length: 16 }, (_, index) => {
        const svg = buildIpMascotPortraitSvg(`expert-${index}`);
        return svg.match(/<rect[^>]*fill="([^"]+)"/)?.[1];
      }),
    );
    expect(backgrounds.size).toBeGreaterThanOrEqual(4);
  });

  it("builds a data uri that encodes the marker", () => {
    const uri = buildIpMascotPortraitDataUri("飞坦:abc");
    expect(uri.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    expect(decodeURIComponent(uri)).toContain('data-portrait="ip-mascot"');
  });
});
