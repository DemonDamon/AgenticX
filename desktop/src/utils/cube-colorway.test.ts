import { describe, expect, it } from "vitest";
import {
  BRAND_CUBE_COLORWAY_ID,
  CUBE_COLORWAYS,
  avatarUrlForCubeColorway,
  buildCubePortraitSvg,
  buildCubePortraitSvgFromWay,
  contrastEyeHex,
  cubeColorwayById,
  isUserCubeColorwayId,
  pickRandomCubeColorwayId,
  readableCubeFill,
} from "./cube-colorway";

describe("cube-colorway", () => {
  it("keeps brand as the official fallback, not a generated paint", () => {
    expect(cubeColorwayById(BRAND_CUBE_COLORWAY_ID)).toBeUndefined();
    expect(avatarUrlForCubeColorway(BRAND_CUBE_COLORWAY_ID)).toBe("");
    expect(isUserCubeColorwayId(BRAND_CUBE_COLORWAY_ID)).toBe(true);
  });

  it("drops speckled marble skins from the catalog", () => {
    expect(CUBE_COLORWAYS.some((item) => item.kind === "marble" || item.id === "sesame")).toBe(false);
  });

  it("paints the same cube mold with a catalog colorway", () => {
    expect(CUBE_COLORWAYS.length).toBeGreaterThan(8);
    const svg = buildCubePortraitSvg("ink-coral");
    expect(svg).toContain('data-portrait="near-cube-v3"');
    expect(svg).toContain('data-colorway="ink-coral"');
    expect(svg).toContain("#0F172A");
    expect(svg).toContain("#FB7185");
    expect(svg).toContain("mask-type=\"alpha\"");
    expect(avatarUrlForCubeColorway("ink-coral")).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("keeps light-body skins readable with dark eyes", () => {
    expect(contrastEyeHex("#FFFFFF")).toBe("#1C1917");
    expect(contrastEyeHex("#0F172A")).toBe("#FFFFFF");
    expect(readableCubeFill("#FFFFFF")).not.toBe("#FFFFFF");
    const svg = buildCubePortraitSvgFromWay({
      id: "dalmatian-bug",
      kind: "dual",
      lid: "#111111",
      body: "#FFFFFF",
      eye: "#FFFFFF",
    });
    expect(svg).toContain("#1C1917");
    expect(svg.match(/fill="#FFFFFF"/)).toBeNull();
  });

  it("shuffles among rich catalog ids", () => {
    const first = pickRandomCubeColorwayId();
    expect(isUserCubeColorwayId(first)).toBe(true);
    expect(first).not.toBe(BRAND_CUBE_COLORWAY_ID);
    expect(cubeColorwayById(first)?.kind).not.toBe("shade");
  });
});
