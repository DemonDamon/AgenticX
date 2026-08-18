import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (fileName: string) =>
  fs.readFileSync(path.resolve(process.cwd(), "src/components/groups", fileName), "utf8");

describe("group management UI contract", () => {
  it("keeps member actions separate from deleting the group", () => {
    const source = readSource("GroupEditorInline.tsx");

    expect(source).toContain("移出成员");
    expect(source).toContain("删除群聊");
    expect(source).toContain("添加成员");
    expect(source).not.toContain('type="checkbox"');
    expect(source).not.toContain("选择分身");
  });

  it("exposes distinct open and manage actions on group cards", () => {
    const source = readSource("ProjectsView.tsx");

    expect(source).toContain("打开对话");
    expect(source).toContain("管理");
    expect(source).toContain("GroupMemberStack");
  });

  it("uses stable icon identities instead of text monograms for defaults", () => {
    const source = readSource("GroupMemberAvatar.tsx");

    expect(source).toContain("MEMBER_ICON_SET");
    expect(source).toContain("stableIndex");
    expect(source).not.toContain("memberInitials");
  });
});
