import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MCPMarketplacePanel } from "./MCPMarketplacePanel";

function makeItems(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `service-${index + 1}`,
    name: `服务 ${index + 1}`,
    description: "用于处理企业数据",
    is_verified: true,
    is_hosted: true,
  }));
}

describe("MCPMarketplacePanel", () => {
  it("uses the same directory hierarchy as the skill marketplace", () => {
    const html = renderToStaticMarkup(
      <MCPMarketplacePanel
        loading={false}
        items={makeItems(13)}
        search=""
        onSearchChange={vi.fn()}
        onRefresh={vi.fn(async () => undefined)}
        onInstall={vi.fn(async () => undefined)}
      />,
    );

    expect(html).toContain("MCP 服务目录");
    expect(html).toContain('aria-label="刷新 MCP 服务目录"');
    expect(html).toContain('aria-label="搜索 MCP 服务"');
    expect(html).toContain('aria-label="搜索 MCP 市场"');
    expect(html).toContain("查看全部 13 个服务");
    expect(html).toContain("服务 6</span>");
    expect(html).not.toContain("服务 7</span>");
    expect(html).not.toContain("服务 13</span>");
  });

  it("keeps installed status on the card instead of offering add again", () => {
    const html = renderToStaticMarkup(
      <MCPMarketplacePanel
        loading={false}
        items={makeItems(1)}
        search=""
        onSearchChange={vi.fn()}
        onRefresh={vi.fn(async () => undefined)}
        onInstall={vi.fn(async () => undefined)}
        installedIds={new Set(["service-1"])}
      />,
    );

    expect(html).toContain("已添加");
    expect(html).not.toContain(">添加<");
  });
});
