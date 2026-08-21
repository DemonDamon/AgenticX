import { describe, expect, it } from "vitest";
import {
  asContentImageUrl,
  isJunkRemoteImageUrl,
  markGeneratingBlocksCancelled,
  projectContentFromBlocks,
  sanitizeLoadedBlocks,
  synthesizeImageBlocksFromTurn,
  upgradeRemoteImageUrl,
  upsertImageBlock,
  type ContentBlock,
} from "./content-blocks";

describe("content-blocks", () => {
  it("start then end on the same id updates status and path", () => {
    const start: ContentBlock = {
      type: "image",
      id: "img-1",
      status: "generating",
      alt: "cat",
    };
    const end: ContentBlock = {
      type: "image",
      id: "img-1",
      status: "ready",
      path: "/tmp/cat.png",
    };
    const after = upsertImageBlock(upsertImageBlock([], start), end);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      type: "image",
      id: "img-1",
      status: "ready",
      path: "/tmp/cat.png",
      alt: "cat",
    });
  });

  it("keeps text / image / text order for different ids", () => {
    const blocks: ContentBlock[] = [
      { type: "text", text: "先看这只" },
      { type: "image", id: "img-a", status: "ready", path: "/tmp/a.png" },
      { type: "text", text: "再看这只" },
    ];
    const next = upsertImageBlock(blocks, {
      type: "image",
      id: "img-b",
      status: "generating",
    });
    expect(next.map((b) => (b.type === "text" ? b.text : b.id))).toEqual([
      "先看这只",
      "img-a",
      "再看这只",
      "img-b",
    ]);
  });

  it("projectContentFromBlocks joins only text", () => {
    const text = projectContentFromBlocks([
      { type: "text", text: "hello" },
      { type: "image", id: "img-1", status: "ready", path: "/tmp/a.png" },
      { type: "text", text: " world" },
    ]);
    expect(text).toBe("hello world");
  });

  it("cancel only flips generating, not ready", () => {
    const out = markGeneratingBlocksCancelled([
      { type: "image", id: "img-1", status: "generating" },
      { type: "image", id: "img-2", status: "ready", path: "/tmp/a.png" },
      { type: "text", text: "ok" },
    ]);
    expect(out[0]).toMatchObject({ id: "img-1", status: "cancelled" });
    expect(out[1]).toMatchObject({ id: "img-2", status: "ready", path: "/tmp/a.png" });
    expect(out[2]).toEqual({ type: "text", text: "ok" });
  });

  it("sanitizeLoadedBlocks keeps https url and drops data url", () => {
    const kept = sanitizeLoadedBlocks([
      {
        type: "image",
        id: "img-1",
        status: "ready",
        url: "https://example.com/a.jpg",
        source_url: "https://example.com/page",
        kind: "remote",
      },
    ]);
    expect(kept?.[0]).toMatchObject({
      id: "img-1",
      url: "https://example.com/a.jpg",
      source_url: "https://example.com/page",
      kind: "remote",
    });
    const dropped = sanitizeLoadedBlocks([
      {
        type: "image",
        id: "img-2",
        status: "ready",
        url: "data:image/png;base64,AAAA",
        path: "/tmp/ok.png",
      },
    ]);
    expect(dropped?.[0]).toMatchObject({ id: "img-2", path: "/tmp/ok.png" });
    expect((dropped?.[0] as { url?: string }).url).toBeUndefined();
  });

  it("synthesizes two remote blocks from show_images gallery", () => {
    const blocks = synthesizeImageBlocksFromTurn(
      [
        { id: "u1", role: "user", content: "搜照片" },
        {
          id: "t1",
          role: "tool",
          toolName: "show_images",
          toolCallId: "call_abc",
          content: JSON.stringify({
            type: "image_gallery",
            images: [
              { type: "image", url: "https://example.com/a.jpg", alt: "a" },
              { type: "image", url: "https://example.com/b.jpg", alt: "b" },
            ],
          }),
        },
        { id: "a1", role: "assistant", content: "找到了" },
      ],
      "a1",
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      id: "img-call_abc-0",
      url: "https://example.com/a.jpg",
      kind: "remote",
    });
    expect(blocks[1]).toMatchObject({
      id: "img-call_abc-1",
      url: "https://example.com/b.jpg",
    });
  });

  it("does not synthesize show_images onto a mid-turn assistant", () => {
    const gallery = JSON.stringify({
      type: "image_gallery",
      images: [{ type: "image", url: "https://example.com/a.jpg" }],
    });
    const turn = [
      { id: "u1", role: "user", content: "搜照片" },
      { id: "mid", role: "assistant", content: "给你看看" },
      { id: "t1", role: "tool", toolName: "show_images", toolCallId: "call_abc", content: gallery },
      {
        id: "final",
        role: "assistant",
        content: "以上",
        blocks: [
          { type: "image" as const, id: "img-call_abc-0", status: "ready" as const, url: "https://example.com/a.jpg" },
        ],
      },
    ];
    expect(synthesizeImageBlocksFromTurn(turn, "mid")).toEqual([]);
    expect(synthesizeImageBlocksFromTurn(turn, "final")).toHaveLength(1);
  });

  it("upgrades listing thumb urls to the original filename", () => {
    expect(
      upgradeRemoteImageUrl(
        "https://c-ssl.dtstatic.com/uploads/blog/x.thumb.400_0.jpeg",
      ),
    ).toBe("https://c-ssl.dtstatic.com/uploads/blog/x.jpeg");
    expect(
      upgradeRemoteImageUrl("https://example.com/a.thumb.100_100_c.jpg"),
    ).toBe("https://example.com/a.jpg");
    expect(upgradeRemoteImageUrl("https://example.com/plain.jpg")).toBe(
      "https://example.com/plain.jpg",
    );
    const kept = sanitizeLoadedBlocks([
      {
        type: "image",
        id: "img-1",
        status: "ready",
        url: "https://c-ssl.dtstatic.com/uploads/blog/x.thumb.400_0.jpeg",
        kind: "remote",
      },
    ]);
    expect(kept?.[0]).toMatchObject({
      url: "https://c-ssl.dtstatic.com/uploads/blog/x.jpeg",
    });
  });

  it("drops ops banners and avatar thumbs from remote image urls", () => {
    expect(
      isJunkRemoteImageUrl(
        "https://a-ssl.dtstatic.com/uploads/ops/202411/06/WXS7Bx1OfQDJYVX.jpeg",
      ),
    ).toBe(true);
    expect(
      asContentImageUrl(
        "https://a-ssl.dtstatic.com/uploads/ops/202411/06/WXS7Bx1OfQDJYVX.jpeg",
      ),
    ).toBeUndefined();
    expect(
      asContentImageUrl(
        "https://c-ssl.dtstatic.com/uploads/blog/202410/15/gVS3yGBiQdnmeE.thumb.400_0.jpeg",
      ),
    ).toBe("https://c-ssl.dtstatic.com/uploads/blog/202410/15/gVS3yGBiQdnmeE.jpeg");
    const sanitized = sanitizeLoadedBlocks([
      {
        type: "image",
        id: "img-ops",
        status: "ready",
        url: "https://a-ssl.dtstatic.com/uploads/ops/202411/06/WXS7Bx1OfQDJYVX.jpeg",
        kind: "remote",
      },
      {
        type: "image",
        id: "img-ok",
        status: "ready",
        url: "https://c-ssl.dtstatic.com/uploads/blog/x.jpeg",
        kind: "remote",
      },
    ]);
    expect(sanitized).toHaveLength(1);
    expect(sanitized?.[0]).toMatchObject({ id: "img-ok" });
  });
});
