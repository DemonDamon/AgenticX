import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ComposerContextControls, composerPermissionLabel, composerWorkspaceLabel } from "./ComposerContextControls";

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

  it("collapses legacy non-auto modes into the truthful quick status", () => {
    expect(composerPermissionLabel("manual")).toBe("逐项确认");
    expect(composerPermissionLabel("semi-auto")).toBe("逐项确认");
    expect(composerPermissionLabel("auto")).toBe("自动批准");
  });

  it("keeps workspace and permission controls visible in the composer", () => {
    const html = renderToStaticMarkup(
      <ComposerContextControls
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
    expect(html).toContain("自动批准");
    expect(html).toContain('aria-haspopup="menu"');
  });
});
