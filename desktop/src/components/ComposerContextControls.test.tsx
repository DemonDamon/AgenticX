import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ComposerContextControls,
  composerPermissionLabel,
  composerWorkspaceLabel,
  filterComposerWorkspaces,
} from "./ComposerContextControls";
import { CONFIRM_STRATEGY_OPTIONS } from "../constants/confirm-strategy-options";
import { ensureWorkspaceSessionBeforeFirstMessage } from "../utils/workspace-session-visibility";

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

  it("filters the compact workspace menu by label or path", () => {
    const workspaces = [
      { id: "alpha", label: "研究资料", path: "/Users/demo/research" },
      { id: "beta", label: "产品代码", path: "/Users/demo/agenticx" },
    ];

    expect(filterComposerWorkspaces(workspaces, "产品")).toEqual([workspaces[1]]);
    expect(filterComposerWorkspaces(workspaces, "RESEARCH")).toEqual([workspaces[0]]);
    expect(filterComposerWorkspaces(workspaces, "  ")).toEqual(workspaces);
  });

  it("materializes a session when workspace is the first new-topic action", async () => {
    const materialize = vi.fn(async () => "sid-workspace-first");
    await expect(ensureWorkspaceSessionBeforeFirstMessage("", materialize)).resolves.toBe(
      "sid-workspace-first",
    );
    expect(materialize).toHaveBeenCalledOnce();
  });

  it("reuses the current session when workspace is selected after materialization", async () => {
    const materialize = vi.fn(async () => "sid-unexpected");
    await expect(
      ensureWorkspaceSessionBeforeFirstMessage("sid-existing", materialize),
    ).resolves.toBe("sid-existing");
    expect(materialize).not.toHaveBeenCalled();
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
        onCreateWorkspace={vi.fn(async () => true)}
        onOpenLocalFolder={vi.fn(async () => true)}
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
        onCreateWorkspace={vi.fn(async () => true)}
        onOpenLocalFolder={vi.fn(async () => true)}
        confirmStrategy="semi-auto"
        onConfirmStrategyChange={vi.fn(async () => true)}
      />,
    );
    expect(html).not.toContain("会话工作区");
    expect(html).toContain("白名单放行");
    expect(html).toContain('aria-haspopup="menu"');
  });

  it("uses a distinct icon for every permission strategy", () => {
    const renderStrategy = (confirmStrategy: "manual" | "semi-auto" | "auto") =>
      renderToStaticMarkup(
        <ComposerContextControls
          mode="conversation"
          workspaces={[]}
          activeTaskspaceId={null}
          workspacePanelOpen={false}
          onWorkspaceMenuOpen={vi.fn()}
          onWorkspaceSelect={vi.fn()}
          onCreateWorkspace={vi.fn(async () => true)}
          onOpenLocalFolder={vi.fn(async () => true)}
          confirmStrategy={confirmStrategy}
          onConfirmStrategyChange={vi.fn(async () => true)}
        />,
      );

    expect(renderStrategy("manual")).toContain("lucide-circle-question-mark");
    expect(renderStrategy("semi-auto")).toContain("lucide-shield-check");
    expect(renderStrategy("auto")).toContain("lucide-zap");
  });

  it("keeps new-topic controls inline without a second-row padding wrapper", () => {
    const html = renderToStaticMarkup(
      <ComposerContextControls
        mode="new-topic"
        workspaces={[{ id: "default", label: "default", path: "/tmp/workspace" }]}
        activeTaskspaceId="default"
        workspacePanelOpen={false}
        onWorkspaceMenuOpen={vi.fn()}
        onWorkspaceSelect={vi.fn()}
        onCreateWorkspace={vi.fn(async () => true)}
        onOpenLocalFolder={vi.fn(async () => true)}
        confirmStrategy="manual"
        onConfirmStrategyChange={vi.fn(async () => true)}
      />,
    );

    expect(html).not.toContain("px-2.5 pb-2.5 pt-1");
  });
});
