import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PendingClarification } from "../../store";
import { ClarificationCard } from "./ClarificationCard";

function prompt(overrides: Partial<PendingClarification> = {}): PendingClarification {
  return {
    requestId: "clarify-open",
    prompt: "需要先确认研究方向",
    options: [],
    allowFreeText: true,
    agentId: "meta",
    sessionId: "session-1",
    ...overrides,
  };
}

describe("ClarificationCard", () => {
  it("renders an open-ended prompt with its text box immediately visible", () => {
    const html = renderToStaticMarkup(<ClarificationCard prompt={prompt()} />);

    expect(html).toContain("你的回复");
    expect(html).toContain("请输入你的回复…");
    expect(html).toContain("输入回复后提交");
    expect(html).not.toContain("自定义回复");
    expect(html).not.toContain("可多选");
  });

  it("keeps malformed choice-less payloads answerable", () => {
    const html = renderToStaticMarkup(
      <ClarificationCard prompt={prompt({ allowFreeText: false })} />,
    );

    expect(html).toContain("请输入你的回复…");
  });

  it("keeps custom text optional when preset choices exist", () => {
    const html = renderToStaticMarkup(
      <ClarificationCard prompt={prompt({ options: ["聚焦财务", "聚焦产品"] })} />,
    );

    expect(html).toContain("聚焦财务");
    expect(html).toContain("聚焦产品");
    expect(html).toContain("自定义回复");
    expect(html).toContain("可多选");
    expect(html).not.toContain("请输入你的回复…");
  });
});
