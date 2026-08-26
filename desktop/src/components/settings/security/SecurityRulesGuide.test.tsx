import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SecurityRulesGuide } from "./SecurityRulesGuide";

describe("SecurityRulesGuide", () => {
  it("explains the difference between run mode and the rule panels", () => {
    const html = renderToStaticMarkup(<SecurityRulesGuide />);
    expect(html).toContain("从这里改路径、命令和工具规则");
    expect(html).toContain("运行模式只决定会不会弹确认");
    expect(html).toContain("下面三块");
    expect(html).not.toContain("关闭说明");
  });

  it("can be dismissed when opened from 自定义", () => {
    const html = renderToStaticMarkup(<SecurityRulesGuide onDismiss={vi.fn()} />);
    expect(html).toContain("关闭说明");
  });
});
