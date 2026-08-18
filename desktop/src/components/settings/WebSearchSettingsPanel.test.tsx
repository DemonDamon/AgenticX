import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../store", () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      apiToken: "desktop-token",
      apiBase: "http://127.0.0.1:8000",
      userAccount: { loggedIn: true },
    }),
}));

import { WebSearchSettingsPanel } from "./WebSearchSettingsPanel";

describe("WebSearchSettingsPanel", () => {
  it("shows enterprise-managed status without local credential controls", () => {
    const html = renderToStaticMarkup(<WebSearchSettingsPanel />);

    expect(html).toContain("由企业管理员统一配置");
    expect(html).toContain("本机无需填写或保存搜索 API Key");
    expect(html).not.toContain("默认搜索引擎");
    expect(html).not.toContain("测试连通性");
    expect(html).not.toContain("~/.agenticx/config.yaml");
  });
});
