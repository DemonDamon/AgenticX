import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/i18n";
import { ConfirmDialog } from "./ConfirmDialog";

function renderDialog(node: ReactElement) {
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
}

describe("ConfirmDialog", () => {
  it("offers on-demand and allow-all policies for explicit low-risk requests", () => {
    const html = renderDialog(
      <ConfirmDialog
        open
        question="Write changes to /tmp/a.md?"
        sourceLabel="主智能体"
        context={{ tool: "file_write", path: "/tmp/a.md", risk: "low" }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(html).toContain(i18n.t("policyAskEveryTime"));
    expect(html).toContain(i18n.t("policyUseAllowlist"));
    expect(html).toContain(i18n.t("policyRunEverything"));
  });

  it("does not offer reusable policies for protected requests", () => {
    const html = renderDialog(
      <ConfirmDialog
        open
        question="Run dangerous command?"
        context={{ tool: "bash_exec", command: "rm -rf build", risk: "high" }}
        defaultPolicy="run-everything"
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(html).toContain(i18n.t("protectedOnceOnly"));
    expect(html).toContain(i18n.t("policyAskEveryTime"));
    expect(html).not.toContain(i18n.t("policyUseAllowlist"));
    expect(html).not.toContain(i18n.t("policyRunEverything"));
  });

  it("does not offer reusable policies when risk_categories includes destructive_filesystem", () => {
    const html = renderDialog(
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

    expect(html).toContain(i18n.t("policyAskEveryTime"));
    expect(html).not.toContain(i18n.t("policyUseAllowlist"));
    expect(html).not.toContain(i18n.t("policyRunEverything"));
  });

  it("does not offer reusable policies when risk is missing", () => {
    const html = renderDialog(
      <ConfirmDialog
        open
        question="Run unknown command?"
        context={{ tool: "bash_exec", command: "mystery" }}
        defaultPolicy="run-everything"
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(html).toContain(i18n.t("protectedOnceOnly"));
    expect(html).toContain(i18n.t("policyAskEveryTime"));
    expect(html).not.toContain(i18n.t("policyUseAllowlist"));
    expect(html).not.toContain(i18n.t("policyRunEverything"));
  });

  it("bolds the command name instead of wrapping it in corner quotes", () => {
    const html = renderDialog(
      <ConfirmDialog
        open
        question="命令 **open** 不在已知只读集合中，仍要执行吗？"
        context={{ tool: "bash_exec", command: "open .", risk: "non_whitelisted" }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(html).toContain("<strong");
    expect(html).toContain("open");
    expect(html).not.toContain("**open**");
    expect(html).not.toContain("「open」");
  });

  it("renders policy chrome in English", async () => {
    await i18n.changeLanguage("en");
    try {
      const html = renderDialog(
        <ConfirmDialog
          open
          question="Write changes to /tmp/a.md?"
          context={{ tool: "file_write", path: "/tmp/a.md", risk: "low" }}
          onApprove={vi.fn()}
          onReject={vi.fn()}
        />,
      );
      expect(html).toContain("Ask every time (allow this step only)");
      expect(html).toContain("On-demand confirm (ask only for risky actions)");
      expect(html).toContain("Allow all (do not ask again)");
      expect(html).toContain("Confirmation needed");
      expect(html).not.toContain("始终询问");
      expect(html).not.toContain("需要确认");
    } finally {
      await i18n.changeLanguage("zh");
    }
  });

  it("offers on-demand and allow-all when risk is non_whitelisted", () => {
    const html = renderDialog(
      <ConfirmDialog
        open
        question="Command 'open' is not a contained read-only command. Execute anyway?"
        context={{ tool: "bash_exec", command: "open .", risk: "non_whitelisted" }}
        defaultPolicy="use-allowlist"
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(html).toContain(i18n.t("policyAskEveryTime"));
    expect(html).toContain(i18n.t("policyUseAllowlist"));
    expect(html).toContain(i18n.t("policyRunEverything"));
    expect(html).not.toContain(i18n.t("protectedOnceOnly"));
  });
});
