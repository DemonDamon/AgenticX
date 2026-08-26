import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("offers on-demand and allow-all policies for explicit low-risk requests", () => {
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

    expect(html).toContain("始终询问（仅本次允许）");
    expect(html).toContain("按需确认（只问有风险的操作）");
    expect(html).toContain("全部允许（之后不再询问）");
  });

  it("does not offer reusable policies for protected requests", () => {
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
    expect(html).toContain("始终询问（仅本次允许）");
    expect(html).not.toContain("按需确认（只问有风险的操作）");
    expect(html).not.toContain("全部允许（之后不再询问）");
  });

  it("does not offer reusable policies when risk_categories includes destructive_filesystem", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        open
        question="Delete files?"
        context={{
          tool: "bash_exec",
          command: "rm -rf build",
          risk: "low",
          risk_categories: [{ code: "destructive_filesystem" }],
        }}
        defaultPolicy="run-everything"
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(html).toContain("始终询问（仅本次允许）");
    expect(html).not.toContain("按需确认（只问有风险的操作）");
    expect(html).not.toContain("全部允许（之后不再询问）");
  });

  it("does not offer reusable policies when risk is missing", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        open
        question="Run unknown command?"
        context={{ tool: "bash_exec", command: "mystery" }}
        defaultPolicy="run-everything"
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(html).toContain("只能逐次确认");
    expect(html).toContain("始终询问（仅本次允许）");
    expect(html).not.toContain("按需确认（只问有风险的操作）");
    expect(html).not.toContain("全部允许（之后不再询问）");
  });

  it("offers on-demand and allow-all when risk is non_whitelisted", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        open
        question="Command 'open' is not a contained read-only command. Execute anyway?"
        context={{ tool: "bash_exec", command: "open .", risk: "non_whitelisted" }}
        defaultPolicy="use-allowlist"
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(html).toContain("始终询问（仅本次允许）");
    expect(html).toContain("按需确认（只问有风险的操作）");
    expect(html).toContain("全部允许（之后不再询问）");
    expect(html).not.toContain("只能逐次确认");
  });
});
