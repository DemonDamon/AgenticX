import { describe, expect, it } from "vitest";
import { findLiveAvatar, preferLiveAvatarUrl } from "./live-avatar-url";

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
