import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ComposerContextControls,
  defaultWorkspacePath,
  workspaceDraftPath,
} from "./ComposerContextControls";

describe("composer workspace controls", () => {
  it("uses the real session workspace as the default creation root", () => {
    const workspaces = [
      { id: "project", label: "项目", path: "/tmp/project" },
      { id: "default", label: "默认", path: "/tmp/session/default" },
    ];
    expect(defaultWorkspacePath(workspaces)).toBe("/tmp/session/default");
    expect(workspaceDraftPath(defaultWorkspacePath(workspaces), "财报/分析")).toBe(
      "/tmp/session/default/财报-分析",
    );
  });

  it("keeps Windows workspace paths native while sanitizing the folder name", () => {
    expect(
      workspaceDraftPath(
        "C:\\Users\\demo\\.agenticx\\taskspaces\\sid\\default\\",
        "季度:分析",
      ),
    ).toBe("C:\\Users\\demo\\.agenticx\\taskspaces\\sid\\default\\季度-分析");
  });

  it("shows the selected workspace path beside the new-topic control", () => {
    const html = renderToStaticMarkup(
      <ComposerContextControls
        mode="new-topic"
        workspaces={[{ id: "default", label: "default", path: "/tmp/session/default" }]}
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
    expect(html).toContain("会话工作区");
    expect(html).toContain("/tmp/session/default");
  });
});
