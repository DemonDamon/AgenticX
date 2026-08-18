import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (fileName: string) =>
  fs.readFileSync(path.resolve(process.cwd(), "src/components/groups", fileName), "utf8");

describe("team template UI contract", () => {
  it("routes template cards to the dedicated provisioning dialog", () => {
    const projects = readSource("ProjectsView.tsx");
    const customEditor = readSource("GroupEditorInline.tsx");

    expect(projects).toContain("<GroupTemplateCreateDialog");
    expect(projects).not.toContain("matchTemplateAvatarIds");
    expect(customEditor).not.toContain("initialAvatarIds");
  });

  it("states that existing avatars are untouched and keeps cancellation available", () => {
    const dialog = readSource("GroupTemplateCreateDialog.tsx");

    expect(dialog).toContain("不会使用或修改你已有的分身");
    expect(dialog).toContain("取消创建");
    expect(dialog).toContain("shouldCancel: () => cancelRequestedRef.current");
  });
});
