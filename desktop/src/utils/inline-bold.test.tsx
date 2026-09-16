import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderInlineBold } from "./inline-bold";

describe("renderInlineBold", () => {
  it("bolds **markers** and leaves the rest as text", () => {
    const html = renderToStaticMarkup(
      <p>{renderInlineBold("命令 **open** 不在已知只读集合中")}</p>,
    );
    expect(html).toContain("<strong");
    expect(html).toContain("open");
    expect(html).not.toContain("**open**");
    expect(html).not.toContain("「open」");
    expect(html).toContain("不在已知只读集合中");
  });

  it("returns plain text when there are no markers", () => {
    const html = renderToStaticMarkup(<p>{renderInlineBold("检测到高风险命令")}</p>);
    expect(html).toBe("<p>检测到高风险命令</p>");
  });
});
