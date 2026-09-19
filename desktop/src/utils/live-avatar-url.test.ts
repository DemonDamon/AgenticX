import { describe, expect, it } from "vitest";
import { DEFAULT_META_AVATAR_URL } from "../constants/meta-avatar";
import { findLiveAvatar, preferCostumeOverBrandMark, preferLiveAvatarUrl } from "./live-avatar-url";

describe("preferLiveAvatarUrl", () => {
  it("uses the current portrait when the registry has one", () => {
    expect(preferLiveAvatarUrl("data:image/svg+xml;base64,new", "data:image/png;base64,old")).toBe(
      "data:image/svg+xml;base64,new",
    );
  });

  it("falls back to the stored snapshot when the live url is empty", () => {
    expect(preferLiveAvatarUrl("", "data:image/png;base64,old")).toBe("data:image/png;base64,old");
    expect(preferLiveAvatarUrl(undefined, undefined)).toBeUndefined();
  });
});

describe("preferCostumeOverBrandMark", () => {
  const costume = "data:image/svg+xml;base64,Y290dG9u";

  it("replaces the official brand mark with the selected costume", () => {
    expect(preferCostumeOverBrandMark(DEFAULT_META_AVATAR_URL, costume)).toBe(costume);
    expect(preferCostumeOverBrandMark("/assets/export_embedded-ab12.png", costume)).toBe(costume);
    expect(preferCostumeOverBrandMark("", costume)).toBe(costume);
  });

  it("keeps an expert or custom portrait", () => {
    expect(preferCostumeOverBrandMark("data:image/svg+xml;base64,expert", costume)).toBe(
      "data:image/svg+xml;base64,expert",
    );
  });

  it("keeps the official mark when no costume is selected", () => {
    expect(preferCostumeOverBrandMark(DEFAULT_META_AVATAR_URL, "")).toBe(DEFAULT_META_AVATAR_URL);
    expect(preferCostumeOverBrandMark(DEFAULT_META_AVATAR_URL, undefined)).toBe(DEFAULT_META_AVATAR_URL);
  });
});

describe("findLiveAvatar", () => {
  const avatars = [
    { id: "6d80f22b6daa", name: "后端·北辰", avatarUrl: "live-beichen" },
    { id: "other", name: "前端·晴空", avatarUrl: "live-qingkong" },
  ];

  it("resolves by id first", () => {
    expect(findLiveAvatar(avatars, { avatarId: "6d80f22b6daa", name: "前端·晴空" })?.avatarUrl).toBe(
      "live-beichen",
    );
  });

  it("resolves historical rows by display name when id is missing", () => {
    expect(findLiveAvatar(avatars, { avatarId: "", name: "后端·北辰" })?.id).toBe("6d80f22b6daa");
  });

  it("ignores meta placeholder ids", () => {
    expect(findLiveAvatar(avatars, { avatarId: "meta", name: "" })).toBeUndefined();
  });
});
