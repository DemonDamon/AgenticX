import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SidebarAccountBar } from "./SidebarAccountBar";
import { Topbar } from "./Topbar";
import { TopbarLeftControls } from "./TopbarLeftControls";

const mocks = vi.hoisted(() => ({
  theme: "dark" as "dark" | "dim" | "light",
  setTheme: vi.fn(),
  openSettings: vi.fn(),
  openTokenDashboard: vi.fn(),
  userNickname: "Damon",
  userAvatarUrl: "",
  agxAccount: { loggedIn: true, email: "damon@example.com", displayName: "Damon" },
  mainView: "chat" as const,
  chatReturnSnapshot: null,
  returnToPreviousChat: vi.fn(),
}));

vi.mock("../store", () => ({
  useAppStore: (selector: (s: typeof mocks) => unknown) => selector(mocks),
}));

describe("sidebar account chrome", () => {
  it("docks token and settings next to the identity pill", () => {
    const html = renderToStaticMarkup(<SidebarAccountBar />);
    expect(html).toContain("Damon");
    expect(html).toContain("Token 消耗看板");
    expect(html).toContain("设置");
    expect(html.indexOf("Damon")).toBeLessThan(html.indexOf("Token 消耗看板"));
    expect(html.indexOf("Token 消耗看板")).toBeLessThan(html.indexOf("aria-label=\"设置\""));
  });

  it("places theme toggle to the left of search in the nav header cluster", () => {
    const html = renderToStaticMarkup(
      <TopbarLeftControls onToggleSidebar={() => {}} toggleTitle="收起侧栏" />,
    );
    expect(html).toContain("切换到亮色");
    expect(html).toContain("搜索文件与历史对话");
    expect(html.indexOf("切换到亮色")).toBeLessThan(html.indexOf("搜索文件与历史对话"));
    expect(html.indexOf("搜索文件与历史对话")).toBeLessThan(html.indexOf("收起侧栏"));
  });

  it("keeps token/settings/account on the topbar only while the sidebar is collapsed", () => {
    const collapsed = renderToStaticMarkup(
      <Topbar sidebarCollapsed onToggleSidebar={() => {}} />,
    );
    expect(collapsed).toContain("Token 消耗看板");
    expect(collapsed).toContain("aria-label=\"设置\"");
    expect(collapsed).toContain("账号菜单");

    expect(collapsed).not.toContain("本地");

    const expanded = renderToStaticMarkup(
      <Topbar sidebarCollapsed={false} onToggleSidebar={() => {}} />,
    );
    expect(expanded).toBe("");
  });
});
