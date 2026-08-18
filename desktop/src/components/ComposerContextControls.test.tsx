import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ComposerContextControls,
  composerPermissionLabel,
  composerWorkspaceLabel,
  effectiveComposerWorkspaceId,
  filterComposerWorkspaces,
} from "./ComposerContextControls";
import {
  CONFIRM_STRATEGY_OPTIONS,
  defaultConfirmPolicyForStrategy,
} from "../constants/confirm-strategy-options";
import {
  ensureWorkspaceSessionBeforeFirstMessage,
  shouldKeepNewTopicWorkspaceControls,
} from "../utils/workspace-session-visibility";

describe("ComposerContextControls", () => {
  it("uses a clear label for the session default workspace", () => {
    expect(
      composerWorkspaceLabel(
        [{ id: "default", label: "default", path: "/tmp/workspace" }],
        "default",
      ),
    ).toBe("会话工作区");
  });

  it("shows an explicit workspace label and keeps the implicit default stable", () => {
    expect(
      composerWorkspaceLabel(
        [{ id: "finance", label: "财报分析", path: "/tmp/finance" }],
        "finance",
      ),
    ).toBe("财报分析");
    expect(composerWorkspaceLabel([], null)).toBe("会话工作区");
    expect(
      composerWorkspaceLabel(
        [{ id: "default", label: "default", path: "/tmp/session/default" }],
        null,
      ),
    ).toBe("会话工作区");
  });

  it("uses the session workspace implicitly without persisting a selection", () => {
    const workspaces = [
      { id: "project", label: "项目", path: "/tmp/project" },
      { id: "default", label: "default", path: "/tmp/session/default" },
    ];
    expect(effectiveComposerWorkspaceId(workspaces, null)).toBe("default");
    expect(effectiveComposerWorkspaceId(workspaces, "project")).toBe("project");
    expect(effectiveComposerWorkspaceId([], null)).toBeNull();
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

  it("keeps the workspace control mounted while the first session is loading", () => {
    expect(shouldKeepNewTopicWorkspaceControls(false, true, true)).toBe(true);
    expect(shouldKeepNewTopicWorkspaceControls(false, true, false)).toBe(false);
    expect(shouldKeepNewTopicWorkspaceControls(true, true, true)).toBe(false);
  });

  it("uses the same three permission modes as settings", () => {
    expect(CONFIRM_STRATEGY_OPTIONS.map((option) => option.value)).toEqual([
      "manual",
      "semi-auto",
      "auto",
    ]);
    expect(composerPermissionLabel("manual")).toBe("每次询问");
    expect(composerPermissionLabel("semi-auto")).toBe("同类操作自动允许");
    expect(composerPermissionLabel("auto")).toBe("全部自动执行");
    expect(defaultConfirmPolicyForStrategy("manual")).toBe("ask-every-time");
    expect(defaultConfirmPolicyForStrategy("semi-auto")).toBe("use-allowlist");
    expect(defaultConfirmPolicyForStrategy("auto")).toBe("run-everything");
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
    expect(html).toContain("同类操作自动允许");
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
    expect(renderStrategy("auto")).toContain("lucide-triangle-alert");
    expect(CONFIRM_STRATEGY_OPTIONS[2].description).toContain("其他高风险操作可能直接运行");
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
