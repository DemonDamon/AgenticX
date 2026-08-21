import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InlineImageBlock } from "./InlineImageBlock";
import { appendMissingImageMarkdown } from "../../utils/session-artifacts";
import { hasImageBlock, type ContentBlock } from "../../utils/content-blocks";

describe("InlineImageBlock", () => {
  it("shows generating copy", () => {
    const html = renderToStaticMarkup(
      <InlineImageBlock block={{ type: "image", id: "img-1", status: "generating", startedAt: Date.now() }} />,
    );
    expect(html).toContain("生成图片中");
    expect(html).not.toContain("<img");
  });

  it("renders img when ready", () => {
    const html = renderToStaticMarkup(
      <InlineImageBlock
        block={{ type: "image", id: "img-1", status: "ready", path: "/tmp/cat.png", alt: "cat" }}
      />,
    );
    expect(html).toContain("<img");
    expect(html).toContain("file://");
  });

  it("error and cancelled have no img", () => {
    const err = renderToStaticMarkup(
      <InlineImageBlock block={{ type: "image", id: "img-1", status: "error", error: "未配置" }} />,
    );
    const cancelled = renderToStaticMarkup(
      <InlineImageBlock block={{ type: "image", id: "img-1", status: "cancelled" }} />,
    );
    expect(err).not.toContain("<img");
    expect(cancelled).not.toContain("<img");
    expect(cancelled).toContain("已取消");
  });
});

describe("MessageRenderer image markdown skip", () => {
  it("does not append markdown images when image blocks exist", () => {
    const blocks: ContentBlock[] = [
      { type: "image", id: "img-1", status: "ready", path: "/tmp/cat.png" },
    ];
    const content = "画好了";
    const displayContent = hasImageBlock(blocks)
      ? content
      : appendMissingImageMarkdown(content, ["/tmp/cat.png"]);
    expect(displayContent).toBe("画好了");
    expect(displayContent).not.toContain("![](");
  });
});
