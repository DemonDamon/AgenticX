import { describe, expect, it } from "vitest";
import {
  markGeneratingBlocksCancelled,
  projectContentFromBlocks,
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
});
