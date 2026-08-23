import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("offers allowlist and low-risk auto policies for explicit low-risk requests", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        open
        question="Write changes to /tmp/a.md?"
        sourceLabel="主智能体"
        context={{ tool: "file_write", path: "/tmp/a.md", risk: "low" }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(html).toContain("每次询问（仅本次允许）");
    expect(html).toContain("白名单放行（本会话允许同类）");
    expect(html).toContain("低风险自动执行");
    expect(html).not.toContain("全部自动执行");
    expect(html).not.toContain("本会话不再询问");
  });

  it("does not offer allowlist or auto-execute policies for protected requests", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        open
        question="Run dangerous command?"
        context={{ tool: "bash_exec", command: "rm -rf build", risk: "high" }}
        defaultPolicy="run-everything"
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(html).toContain("只能逐次确认");
    expect(html).toContain("每次询问（仅本次允许）");
    expect(html).not.toContain("白名单放行（本会话允许同类）");
    expect(html).not.toContain("低风险自动执行（仅自动放行低风险）");
  });
});
