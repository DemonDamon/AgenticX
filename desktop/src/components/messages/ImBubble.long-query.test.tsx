// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "../../i18n/i18n";
import { ImBubble } from "./ImBubble";

const contract = [
  "## Execution Contract (Auto Injected)",
  "- 这是执行任务，不是方案讨论。禁止输出“是否按此方案执行”。",
  "- 禁止把 MCP 工具名当作 bash 命令执行（例如 firecrawl_scrape）。",
  "- mcp_call 参数字段优先使用 arguments；调用前核对目标工具 schema。",
  "- 若某工具参数校验失败，立即按 schema 修正并继续执行；不要向用户追问。",
  "- Preflight strategy: Use basic-web-crawler batch_browser_extract for site-list pages first.",
  "- 时间窗口必须严格限定在最近 7 天，无法解析日期的条目直接丢弃。",
].join("\n");

afterEach(() => {
  cleanup();
});

describe("ImBubble long query expand", () => {
  it("expands the collapsed preview and collapses it again", () => {
    render(
      <ImBubble
        message={{ id: "task-query", role: "user", content: contract }}
        collapseLongUserQuery
      />,
    );
    expect(document.querySelector("[data-user-query='collapsed']")?.textContent).toContain("Execution Contract");
    fireEvent.click(document.querySelector("[data-user-query='collapsed']")!);
    expect(document.querySelector("[data-user-query='expanded']")?.textContent).toContain("最近 7 天");
    fireEvent.click(screen.getByRole("button", { name: i18n.t("actions.collapseQuery", { ns: "chat" }) }));
    expect(document.querySelector("[data-user-query='collapsed']")).toBeTruthy();
  });
});
