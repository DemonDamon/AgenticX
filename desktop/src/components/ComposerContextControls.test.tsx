import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ComposerContextControls, composerPermissionLabel, composerWorkspaceLabel } from "./ComposerContextControls";
import { CONFIRM_STRATEGY_OPTIONS } from "../constants/confirm-strategy-options";

describe("ComposerContextControls", () => {
  it("uses a clear label for the session default workspace", () => {
    expect(
      composerWorkspaceLabel(
        [{ id: "default", label: "default", path: "/tmp/workspace" }],
        "default",
      ),
    ).toBe("会话工作区");
  });

  it("shows an explicit workspace label and a safe empty fallback", () => {
    expect(
      composerWorkspaceLabel(
        [{ id: "finance", label: "财报分析", path: "/tmp/finance" }],
        "finance",
      ),
    ).toBe("财报分析");
    expect(composerWorkspaceLabel([], null)).toBe("选择工作区");
  });

  it("uses the same three permission modes as settings", () => {
    expect(CONFIRM_STRATEGY_OPTIONS.map((option) => option.value)).toEqual([
      "manual",
      "semi-auto",
      "auto",
    ]);
    expect(composerPermissionLabel("manual")).toBe("每次询问");
    expect(composerPermissionLabel("semi-auto")).toBe("白名单放行");
    expect(composerPermissionLabel("auto")).toBe("全部自动执行");
  });

  it("shows workspace and permission controls for a new conversation", () => {
    const html = renderToStaticMarkup(
      <ComposerContextControls
        mode="new-topic"
        workspaces={[{ id: "default", label: "default", path: "/tmp/workspace" }]}
        activeTaskspaceId="default"
        workspacePanelOpen={false}
        onWorkspaceMenuOpen={vi.fn()}
        onWorkspaceSelect={vi.fn()}
        onOpenWorkspacePanel={vi.fn()}
        confirmStrategy="auto"
        onConfirmStrategyChange={vi.fn(async () => true)}
      />,
    );
    expect(html).toContain("会话工作区");
    expect(html).toContain("全部自动执行");
    expect(html).toContain('aria-haspopup="menu"');
  });

  it("keeps only the permission control in an existing conversation", () => {
    const html = renderToStaticMarkup(
      <ComposerContextControls
        mode="conversation"
        workspaces={[{ id: "default", label: "default", path: "/tmp/workspace" }]}
        activeTaskspaceId="default"
        workspacePanelOpen={false}
        onWorkspaceMenuOpen={vi.fn()}
        onWorkspaceSelect={vi.fn()}
        onOpenWorkspacePanel={vi.fn()}
        confirmStrategy="semi-auto"
        onConfirmStrategyChange={vi.fn(async () => true)}
      />,
    );
    expect(html).not.toContain("会话工作区");
    expect(html).toContain("白名单放行");
    expect(html).toContain('aria-haspopup="menu"');
  });
});
