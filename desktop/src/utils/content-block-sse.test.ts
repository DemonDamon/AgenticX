import { describe, expect, it } from "vitest";
import { applyContentBlockEvent, applyTokenDelta } from "./content-block-sse";
import { projectContentFromBlocks, type ContentBlock } from "./content-blocks";

describe("applyContentBlockEvent", () => {
  it("token → start → token → end → commit extras contain blocks", () => {
    let blocks: ContentBlock[] = [];
    blocks = applyTokenDelta(blocks, "先画一只猫。");
    blocks = applyContentBlockEvent(blocks, {
      type: "content_block",
      data: {
        mode: "start",
        block: { type: "image", id: "img-call1", status: "generating", alt: "cat" },
      },
    });
    blocks = applyTokenDelta(blocks, "图在下面。");
    blocks = applyContentBlockEvent(blocks, {
      type: "content_block",
      data: {
        mode: "end",
        block: {
          type: "image",
          id: "img-call1",
          status: "ready",
          path: "/tmp/cat.png",
          mime: "image/png",
        },
      },
    });
    const extras = { blocks };
    expect(projectContentFromBlocks(extras.blocks)).toBe("先画一只猫。图在下面。");
    expect(extras.blocks).toHaveLength(3);
    expect(extras.blocks[1]).toMatchObject({
      type: "image",
      id: "img-call1",
      status: "ready",
      path: "/tmp/cat.png",
    });
  });

  it("keeps https url and drops data url", () => {
    let blocks: ContentBlock[] = [];
    blocks = applyContentBlockEvent(blocks, {
      type: "content_block",
      data: {
        mode: "end",
        block: {
          type: "image",
          id: "img-remote-0",
          status: "ready",
          url: "https://example.com/a.jpg",
          source_url: "https://example.com/page",
          kind: "remote",
        },
      },
    });
    expect(blocks[0]).toMatchObject({
      type: "image",
      id: "img-remote-0",
      url: "https://example.com/a.jpg",
      source_url: "https://example.com/page",
      kind: "remote",
    });

    blocks = applyContentBlockEvent([], {
      type: "content_block",
      data: {
        mode: "end",
        block: {
          type: "image",
          id: "img-data",
          status: "ready",
          url: "data:image/png;base64,AAAA",
        },
      },
    });
    expect(blocks).toEqual([]);
  });

  it("upgrades listing thumb url on end frame", () => {
    const blocks = applyContentBlockEvent([], {
      type: "content_block",
      data: {
        mode: "end",
        block: {
          type: "image",
          id: "img-thumb-0",
          status: "ready",
          url: "https://c-ssl.dtstatic.com/uploads/blog/x.thumb.400_0.jpeg",
          kind: "remote",
        },
      },
    });
    expect(blocks[0]).toMatchObject({
      url: "https://c-ssl.dtstatic.com/uploads/blog/x.jpeg",
    });
  });

  it("drops ops banner end frames", () => {
    const blocks = applyContentBlockEvent([], {
      type: "content_block",
      data: {
        mode: "end",
        block: {
          type: "image",
          id: "img-ops-0",
          status: "ready",
          url: "https://a-ssl.dtstatic.com/uploads/ops/202411/06/WXS7Bx1OfQDJYVX.jpeg",
          kind: "remote",
        },
      },
    });
    expect(blocks).toEqual([]);
  });
});
