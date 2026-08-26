import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AllowAllConfirmDialog } from "./AllowAllConfirmDialog";

describe("AllowAllConfirmDialog", () => {
  it("renders a warning title, risks, and a high-emphasis enable action", () => {
    const html = renderToStaticMarkup(
      <AllowAllConfirmDialog open onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );

    expect(html).toContain("启用全部允许？");
    expect(html).toContain("读写本地文件");
    expect(html).toContain("执行终端命令");
    expect(html).toContain("可能带来的风险");
    // 审批与隔离是两件事：不再询问 ≠ 关掉工作区隔离。
    expect(html).toContain("工作区隔离仍然生效");
    expect(html).not.toContain("直接在本机执行");
    expect(html).toContain("启用");
    expect(html).toContain("取消");
    expect(html).toContain("bg-amber-500");
    expect(html).toContain("bg-btnPrimary");
  });

  it("does not render when closed", () => {
    const html = renderToStaticMarkup(
      <AllowAllConfirmDialog open={false} onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(html).toBe("");
  });
});
