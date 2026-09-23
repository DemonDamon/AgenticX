import { describe, expect, it } from "vitest";
import { BRAND_CUBE_COLORWAY_ID, buildCubePortraitDataUrl } from "./cube-colorway";
import { isPersistedUserAvatarUrl, resolveMetaAvatarFromColorway } from "./identity-avatar";
import { buildStudioSvgDataUri, defaultRecipe } from "./identity-studio";

describe("isPersistedUserAvatarUrl", () => {
  it("keeps a real uploaded photo", () => {
    expect(isPersistedUserAvatarUrl("data:image/png;base64,aaa")).toBe(true);
    expect(isPersistedUserAvatarUrl("https://example.test/me.jpg")).toBe(true);
  });

  it("keeps a generated studio portrait", () => {
    const portrait = buildStudioSvgDataUri(defaultRecipe("阿来"));
    expect(isPersistedUserAvatarUrl(portrait)).toBe(true);
  });

  it("rejects empty values and leftover cube skins", () => {
    expect(isPersistedUserAvatarUrl("")).toBe(false);
    expect(isPersistedUserAvatarUrl("   ")).toBe(false);
    expect(isPersistedUserAvatarUrl(buildCubePortraitDataUrl("matcha-lid"))).toBe(false);
  });
});

describe("resolveMetaAvatarFromColorway", () => {
  it("uses the official mark for brand and a cube paint otherwise", () => {
    expect(resolveMetaAvatarFromColorway(BRAND_CUBE_COLORWAY_ID)).toBe("");
    expect(resolveMetaAvatarFromColorway("matcha-lid")).toContain("data:image/svg+xml");
  });
});
