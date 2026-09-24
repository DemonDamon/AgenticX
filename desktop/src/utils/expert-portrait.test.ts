/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CUBE_PORTRAIT_STYLE,
  buildCollectionPortraitDataUri,
  describeStyleOptions,
  displayedMetaAvatarUrl,
  promptToStyleOptions,
  isCustomExpertPortrait,
  loadCollectionPortraitStyle,
  portraitSeed,
  writeCollectionPortraitStyle,
} from "./expert-portrait";

describe("expert portraits", () => {
  const memory = new Map<string, string>();

  beforeEach(() => {
    memory.clear();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => memory.get(key) ?? null,
        setItem: (key: string, value: string) => {
          memory.set(key, value);
        },
        removeItem: (key: string) => {
          memory.delete(key);
        },
      },
    });
  });

  afterEach(() => {
    memory.clear();
  });

  it("builds a stable seed from name and id", () => {
    expect(portraitSeed("飞坦", "abc")).toBe("飞坦:abc");
  });

  it("renders the same portrait twice for one style and seed", () => {
    const first = buildCollectionPortraitDataUri("lorelei", "飞坦:abc");
    const second = buildCollectionPortraitDataUri("lorelei", "飞坦:abc");
    expect(first).toBe(second);
    expect(decodeURIComponent(first)).toContain('data-portrait="dicebear-lorelei"');
    expect(describeStyleOptions("voxel-art")).toContain("glassesProbability");
    const asked = promptToStyleOptions("voxel-art", "头发是金色，不戴眼镜，穿着黑色西装");
    expect(asked.hairColor).toEqual(["#E6B325"]);
    expect(asked.hairColorOrder).toBe("fixed");
    expect(asked.glassesProbability).toBe(0);
    expect(asked.outfitVariant).toBe("suit");
    expect(asked.jacketColor).toEqual(["#1C1917"]);
    const detailed = promptToStyleOptions("voxel-art", "装领带，戴眼镜，西装，粉红色头发，女生");
    expect(detailed.hairColor).toEqual(["#F9A8D4"]);
    expect(detailed.glassesProbability).toBe(100);
    expect(detailed.outfitVariant).toBe("tie");
    expect(detailed.topVariant).toBe("longStraight");
    expect(detailed.beardProbability).toBe(0);
    const male = promptToStyleOptions("voxel-art", "装领带，戴眼镜，西装，红色红色头发，男生");
    expect(male.hairColor).toEqual(["#E11D48"]);
    expect(male.hairColorOrder).toBe("fixed");
    expect(decodeURIComponent(buildCollectionPortraitDataUri("blobs", "飞坦:abc"))).toContain(
      'data-portrait="dicebear-blobs"',
    );
  });

  it("leaves cube generation to the backend", () => {
    expect(buildCollectionPortraitDataUri("near-cube-v3", "x")).toBe("");
  });

  it("treats uploads as custom and generated svg as replaceable", () => {
    expect(isCustomExpertPortrait({ portraitStyle: "custom" })).toBe(true);
    expect(
      isCustomExpertPortrait({
        portraitStyle: "lorelei",
        avatarUrl: "data:image/svg+xml,abc",
      }),
    ).toBe(false);
    expect(isCustomExpertPortrait({ avatarUrl: "data:image/png;base64,aaa" })).toBe(true);
    const generated = buildCollectionPortraitDataUri("lorelei", "飞坦:abc");
    expect(isCustomExpertPortrait({ portraitStyle: "custom", avatarUrl: generated })).toBe(false);
  });

  it("uses the shared style for Near and keeps the cube costume for cube style", () => {
    expect(displayedMetaAvatarUrl("near-cube-v3", "data:image/svg+xml,cube")).toBe(
      "data:image/svg+xml,cube",
    );
    expect(decodeURIComponent(displayedMetaAvatarUrl("lorelei", "data:image/svg+xml,cube"))).toContain(
      'data-portrait="dicebear-lorelei"',
    );
  });

  it("falls back to cubes when nothing is saved", () => {
    expect(loadCollectionPortraitStyle()).toBe(CUBE_PORTRAIT_STYLE);
    writeCollectionPortraitStyle("lorelei");
    expect(loadCollectionPortraitStyle()).toBe("lorelei");
    writeCollectionPortraitStyle(CUBE_PORTRAIT_STYLE);
    expect(loadCollectionPortraitStyle()).toBe(CUBE_PORTRAIT_STYLE);
  });
});
