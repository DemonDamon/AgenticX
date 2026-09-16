import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InlineImageBlock, InlineImageLoadFailedNotice } from "./InlineImageBlock";
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

  it("shows remote generating copy", () => {
    const html = renderToStaticMarkup(
      <InlineImageBlock
        block={{ type: "image", id: "img-1", status: "generating", kind: "remote", startedAt: Date.now() }}
      />,
    );
    expect(html).toContain("加载图片中");
    expect(html).not.toContain("生成图片中");
  });

  it("renders remote url img", () => {
    const html = renderToStaticMarkup(
      <InlineImageBlock
        block={{
          type: "image",
          id: "img-1",
          status: "ready",
          url: "https://example.com/a.jpg",
          kind: "remote",
          alt: "西装",
          source_url: "https://example.com/page",
        }}
      />,
    );
    expect(html).toContain("<img");
    expect(html).toContain("https://example.com/a.jpg");
    expect(html).toContain("no-referrer");
    expect(html).toContain("max-h-[240px]");
    expect(html).not.toContain("max-h-[70vh]");
    expect(html).toContain("来源：");
    expect(html).toContain("example.com");
    expect(html.indexOf("西装")).toBeLessThan(html.indexOf("<img"));
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

  it("shows load-error copy without img", () => {
    const html = renderToStaticMarkup(<InlineImageLoadFailedNotice />);
    expect(html).toContain("图片无法加载");
    expect(html).not.toContain("<img");
  });

  it("keeps lightbox arrows unmounted until opened", () => {
    const html = renderToStaticMarkup(
      <InlineImageBlock
        block={{
          type: "image",
          id: "img-1",
          status: "ready",
          url: "https://example.com/a.jpg",
          kind: "remote",
        }}
        gallery={[
          { type: "image", id: "img-1", status: "ready", url: "https://example.com/a.jpg", kind: "remote" },
          { type: "image", id: "img-2", status: "ready", url: "https://example.com/b.jpg", kind: "remote" },
        ]}
      />,
    );
    expect(html).toContain("<img");
    expect(html).not.toContain("上一张");
    expect(html).not.toContain("下一张");
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
