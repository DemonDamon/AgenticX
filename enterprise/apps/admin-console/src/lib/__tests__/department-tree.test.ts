import { describe, expect, it } from "vitest";

import {
  childrenByParent,
  deleteBlockedReason,
  departmentSubtreeIds,
  movableParentOptions,
  type DepartmentNode,
} from "../department-tree";

const node = (id: string, parentId: string | null, name = id): DepartmentNode => ({
  id,
  name,
  parentId,
  path: name,
  memberCount: 0,
});

/** 研发中心 → 前端组 → 前端一组；销售部单独一支。 */
const tree: DepartmentNode[] = [
  node("rd", null, "研发中心"),
  node("fe", "rd", "前端组"),
  node("fe1", "fe", "前端一组"),
  node("sales", null, "销售部"),
];

describe("childrenByParent", () => {
  it("groups nodes under their parent", () => {
    const map = childrenByParent(tree);
    expect(map.get(null)?.map((n) => n.id).sort()).toEqual(["rd", "sales"]);
    expect(map.get("rd")?.map((n) => n.id)).toEqual(["fe"]);
  });

  it("treats a dangling parent as top level instead of hiding the subtree", () => {
    // 父 id 指向一个已经不在列表里的节点时，整棵子树不能就此从界面上消失。
    const orphan = [node("x", "gone")];
    expect(childrenByParent(orphan).get(null)?.map((n) => n.id)).toEqual(["x"]);
  });
});

describe("departmentSubtreeIds", () => {
  it("includes the node itself and every descendant", () => {
    expect([...departmentSubtreeIds(tree, "rd")].sort()).toEqual(["fe", "fe1", "rd"]);
  });

  it("is just the node when it has no children", () => {
    expect([...departmentSubtreeIds(tree, "sales")]).toEqual(["sales"]);
  });
});

describe("movableParentOptions", () => {
  it("never offers the node itself", () => {
    expect(movableParentOptions(tree, "fe").map((n) => n.id)).not.toContain("fe");
  });

  it("never offers a descendant", () => {
    // 把前端组移到前端一组下面，这一支会从主干上断开，那批人在任何一棵树里都找不到。
    expect(movableParentOptions(tree, "fe").map((n) => n.id)).not.toContain("fe1");
  });

  it("still offers unrelated branches and the node's own ancestors", () => {
    expect(movableParentOptions(tree, "fe").map((n) => n.id).sort()).toEqual(["rd", "sales"]);
  });
});

describe("deleteBlockedReason", () => {
  it("turns each backend code into something the admin can act on", () => {
    expect(deleteBlockedReason("dept_has_children")).toContain("子部门");
    expect(deleteBlockedReason("dept_has_members")).toContain("成员");
  });

  it("passes anything else through as unrecognised", () => {
    expect(deleteBlockedReason("boom")).toBeNull();
  });
});
