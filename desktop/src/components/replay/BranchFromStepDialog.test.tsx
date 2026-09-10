import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import { i18n } from "../../i18n/i18n";
import { BranchFromStepDialog } from "./BranchFromStepDialog";

describe("BranchFromStepDialog", () => {
  it("explains requested and restored steps and preserves failed input", () => {
    void i18n.changeLanguage("zh");
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <BranchFromStepDialog
          open
          requestedSeq={101}
          resolvedSeq={100}
          skippedToolCount={100}
          workspaceStatus="git_isolate_ready"
          warnings={[{ effectClass: "unknown", toolName: "mcp_call", count: 1 }]}
          initialInstruction="use file_edit"
          submitting={false}
          error={{ code: "workspace_restore_failed:read_tree", detail: "restore failed" }}
          onCancel={() => undefined}
          onSubmit={async () => undefined}
        />
      </I18nextProvider>,
    );
    expect(html).toContain("#101");
    expect(html).toContain("#100");
    expect(html).toContain("use file_edit");
    expect(html).toContain("workspace_restore_failed:read_tree");
    expect(html).toContain("mcp_call");
  });

  it("localizes every label and shows only the real active stage", () => {
    void i18n.changeLanguage("en");
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <BranchFromStepDialog
          open
          requestedSeq={101}
          resolvedSeq={100}
          skippedToolCount={100}
          workspaceStatus="not_git_isolate"
          warnings={[]}
          initialInstruction="continue"
          submitting
          stage="open_session"
          error={null}
          onCancel={() => undefined}
          onSubmit={async () => undefined}
        />
      </I18nextProvider>,
    );

    expect(html).toContain("Opening the new session");
    expect(html).toContain("This session is not in an isolated Git worktree");
    expect(html).not.toContain("正在");
    expect(html).not.toContain("Restoring the workspace");
  });
});
