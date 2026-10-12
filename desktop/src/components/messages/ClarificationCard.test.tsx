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

describe("ClarificationCard form mode (connector assistant)", () => {
  const formPrompt = (): PendingClarification =>
    prompt({
      requestId: "clarify-form",
      prompt: "为了创建连接器「abc」，需要确认以下信息",
      allowFreeText: false,
      context: { submit_label: "确认", skip_label: "忽略" },
      decisions: [
        {
          id: "system_type",
          question: "abc 要接入的是什么类型的系统？",
          options: ["REST API（提供 HTTP 接口文档）", "MCP Server（提供 MCP 接入 URL）", "其他（自定义输入）"],
          selectionMode: "single",
          exclusiveOptions: [],
          customOption: "其他（自定义输入）",
        },
        {
          id: "upstream_url",
          question: "请提供上游服务地址（REST API 的 base_url，或 MCP Server 完整 URL，须含 path）",
          options: [],
          selectionMode: "single",
          exclusiveOptions: [],
          inputType: "url",
          label: "上游地址",
          placeholder: "https://example.com/api 或 https://example.com/mcp",
        },
      ],
    });

  it("renders choices, a required URL field and custom button labels with confirm disabled", () => {
    const html = renderToStaticMarkup(<ClarificationCard prompt={formPrompt()} />);
    expect(html).toContain("abc 要接入的是什么类型的系统？");
    expect(html).toContain("MCP Server（提供 MCP 接入 URL）");
    expect(html).toContain("上游地址");
    expect(html).toContain('placeholder="https://example.com/api 或 https://example.com/mcp"');
    expect(html).toContain('type="url"');
    expect(html).toContain("忽略");
    expect(html).toContain("确认");
    expect(html).not.toContain("跳过（按默认推进）");
    expect(html).not.toContain("自定义回复");
    // context labels are not echoed as a snapshot
    expect(html).not.toContain("submit_label");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*确认/);
  });

  it("renders secret fields as password inputs", () => {
    const html = renderToStaticMarkup(
      <ClarificationCard
        prompt={prompt({
          allowFreeText: false,
          decisions: [
            {
              id: "credential",
              question: "请输入「abc」的 Token",
              options: [],
              selectionMode: "single",
              exclusiveOptions: [],
              inputType: "secret",
              label: "Token",
            },
          ],
        })}
      />,
    );
    expect(html).toContain('type="password"');
    expect(html).toContain("不会发送到对话或模型");
  });

  it("renders unmasked secret fields (AK / Client ID) as text, masked ones as password", () => {
    const html = renderToStaticMarkup(
      <ClarificationCard
        prompt={prompt({
          allowFreeText: false,
          decisions: [
            {
              id: "accessKeyId",
              question: "Access Key ID",
              options: [],
              selectionMode: "single",
              exclusiveOptions: [],
              inputType: "secret",
              masked: false,
              label: "AK",
            },
            {
              id: "secretKey",
              question: "Secret Key",
              options: [],
              selectionMode: "single",
              exclusiveOptions: [],
              inputType: "secret",
              label: "SK",
            },
          ],
        })}
      />,
    );
    expect(html.match(/type="password"/g)?.length).toBe(1);
    expect(html).toMatch(/type="text"/);
  });
});
