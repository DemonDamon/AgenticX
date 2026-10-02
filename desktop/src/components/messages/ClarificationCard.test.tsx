import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "../../i18n/i18n";
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

  it("renders comparison choice panel with sources and no Jev copy", () => {
    const html = renderToStaticMarkup(
      <ClarificationCard
        prompt={prompt({
          allowFreeText: false,
          panelId: "panel-1",
          candidateSetVersion: 1,
          panelType: "comparison",
          choiceOptions: [
            {
              id: "rocky",
              label: "Rocky Shore",
              details: ["Tide pools"],
              sources: [{ title: "Aquarium", url: "https://example.com/rocky" }],
            },
            {
              id: "ocean",
              label: "Open Ocean",
              details: ["Large tank"],
              sources: [{ title: "Ocean", url: "https://example.com/ocean" }],
            },
          ],
        })}
      />,
    );
    expect(html).toContain("对比选项");
    expect(html).toContain("Rocky Shore");
    expect(html).toContain("Tide pools");
    expect(html).toContain("来源");
    expect(html).toContain("https://example.com/rocky");
    expect(html).toContain("Aquarium");
    expect(html).toContain("将提交你选中的一项");
    expect(html.toLowerCase()).not.toContain("jev");
  });

  it("disables superseded choice panel selection", () => {
    const html = renderToStaticMarkup(
      <ClarificationCard
        prompt={prompt({
          panelId: "panel-old",
          candidateSetVersion: 1,
          panelType: "clarification",
          superseded: true,
          choiceOptions: [
            { id: "a", label: "Option A" },
            { id: "b", label: "Option B" },
          ],
        })}
      />,
    );
    expect(html).toContain("选择面板");
    expect(html).toContain("已有更新的选择面板");
    expect(html).toContain('disabled=""');
    expect(html).toContain("aria-disabled");
    expect(html).not.toContain("提交决定");
    expect(html.toLowerCase()).not.toContain("jev");
  });
});
