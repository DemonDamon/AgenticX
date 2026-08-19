import { describe, expect, it } from "vitest";

import { buildExpertEnvironmentSetupDraft } from "./expert-environment-setup";

describe("buildExpertEnvironmentSetupDraft", () => {
  it("binds setup to the expert workspace and isolates project dependencies", () => {
    const draft = buildExpertEnvironmentSetupDraft({
      expertName: "数据分析专家",
      workspaceDir: "C:\\Work Spaces\\analytics",
    });

    expect(draft).toContain("数字专家「数据分析专家」");
    expect(draft).toContain("C:\\Work Spaces\\analytics");
    expect(draft).toContain("工作区清单中声明的依赖 + 当前机器上可检测的依赖");
    expect(draft).toContain("<工作区>/.venv");
    expect(draft).toContain("py -0p");
    expect(draft).toContain("where.exe python");
    expect(draft).toContain("where.exe conda");
    expect(draft).toContain("绝不能修改 Conda base");
    expect(draft).toContain("~/.agenticx/.venv");
    expect(draft).toContain("内嵌 Python/内嵌后端");
    expect(draft).toContain("通过实际工具调用触发系统确认");
    expect(draft).toContain("在我确认前不要创建环境或安装依赖");
  });

  it("falls back to the currently bound workspace without inventing a path", () => {
    const draft = buildExpertEnvironmentSetupDraft({
      expertName: "  ",
      workspaceDir: "",
    });

    expect(draft).toContain("当前数字专家");
    expect(draft).toContain("当前数字专家绑定的工作区");
    expect(draft).not.toContain("~/.agenticx/avatars/");
  });
});
