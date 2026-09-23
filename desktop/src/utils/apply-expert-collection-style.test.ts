import { describe, expect, it, vi } from "vitest";
import { applyCollectionStyleToExperts } from "./apply-expert-collection-style";
import { buildCollectionPortraitDataUri } from "./expert-portrait";

describe("applyCollectionStyleToExperts", () => {
  it("skips uploads, clears cubes, and writes a marked character portrait", async () => {
    const calls: Array<{ id: string; avatar_url: string; portrait_style: string }> = [];
    const updateAvatar = async (payload: { id: string; avatar_url: string; portrait_style: string }) => {
      calls.push(payload);
      return { ok: true };
    };
    const result = await applyCollectionStyleToExperts({
      style: "lorelei",
      avatars: [
        { id: "photo", name: "照片", portraitStyle: "custom", avatarUrl: "data:image/png;base64,aaa" },
        { id: "cube", name: "飞坦", portraitStyle: "near-cube-v3", avatarUrl: "data:image/svg+xml,cube" },
      ],
      updateAvatar,
    });
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.updated).toBe(1);
    expect(calls).toHaveLength(1);
    const payload = calls[0];
    if (!payload) throw new Error("missing payload");
    expect(payload.id).toBe("cube");
    expect(payload.portrait_style).toBe("lorelei");
    expect(decodeURIComponent(payload.avatar_url)).toContain('data-portrait="dicebear-lorelei"');
  });

  it("still replaces a generated face that was saved as a custom upload", async () => {
    const previous = buildCollectionPortraitDataUri("fun-emoji", "飞坦:abc");
    const calls: string[] = [];
    const result = await applyCollectionStyleToExperts({
      style: "lorelei",
      avatars: [{ id: "abc", name: "飞坦", portraitStyle: "custom", avatarUrl: previous }],
      updateAvatar: async (payload) => {
        calls.push(payload.portrait_style);
        return { ok: true };
      },
    });
    expect(result.skipped).toBe(0);
    expect(result.updated).toBe(1);
    expect(calls).toEqual(["lorelei"]);
  });

  it("asks the backend to rebuild cubes", async () => {
    const updateAvatar = vi.fn(async () => ({ ok: true }));
    await applyCollectionStyleToExperts({
      style: "near-cube-v3",
      avatars: [{ id: "a", name: "飞坦", portraitStyle: "lorelei", avatarUrl: "data:image/svg+xml,face" }],
      updateAvatar,
    });
    expect(updateAvatar).toHaveBeenCalledWith({
      id: "a",
      avatar_url: "",
      portrait_style: "near-cube-v3",
    });
  });

  it("stops on the first failed write", async () => {
    const updateAvatar = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: "HTTP 500" });
    const result = await applyCollectionStyleToExperts({
      style: "lorelei",
      avatars: [
        { id: "a", name: "甲", portraitStyle: "near-cube-v3" },
        { id: "b", name: "乙", portraitStyle: "near-cube-v3" },
        { id: "c", name: "丙", portraitStyle: "near-cube-v3" },
      ],
      updateAvatar,
    });
    expect(result.error).toBe("HTTP 500");
    expect(result.updated).toBe(1);
    expect(updateAvatar).toHaveBeenCalledTimes(2);
  });
});
