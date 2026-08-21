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
});
