import { describe, expect, it } from "vitest";

import {
  dragPayloadIds,
  moveResultText,
  parseDragPayload,
  planMove,
  type MovableMember,
} from "../member-move";

const member = (id: string, deptId: string | null): MovableMember => ({
  id,
  displayName: id.toUpperCase(),
  deptId,
});

describe("planMove", () => {
  it("把已经在目标部门的人挑出去，不重复发请求", () => {
    const plan = planMove([member("a", "d1"), member("b", "d2"), member("c", null)], "d1");
    expect(plan.move.map((m) => m.id)).toEqual(["b", "c"]);
    expect(plan.alreadyThere.map((m) => m.id)).toEqual(["a"]);
  });

  it("移到未归属时，null 和 undefined 视为同一档", () => {
    const plan = planMove(
      [{ id: "a", displayName: "A", deptId: null }, member("b", "d1")],
      null,
    );
    expect(plan.move.map((m) => m.id)).toEqual(["b"]);
    expect(plan.alreadyThere.map((m) => m.id)).toEqual(["a"]);
  });
});

describe("moveResultText", () => {
  it("只报真的动了的人数", () => {
    expect(moveResultText("研发部", 2, 3, [])).toBe("已把 2 人移到「研发部」；3 人本来就在这里");
  });

  it("一个都没动时不说「已移动 0 人」", () => {
    expect(moveResultText("研发部", 0, 0, [])).toBe("没有需要移动的人");
  });

  it("部分失败要点名，超过三个才省略", () => {
    expect(moveResultText("研发部", 1, 0, ["张三", "李四"])).toContain("未成功：张三、李四");
    expect(moveResultText("研发部", 1, 0, ["a", "b", "c", "d"])).toContain("未成功：a、b、c 等");
  });
});

describe("dragPayloadIds", () => {
  it("拖选中的人时带上整个选中集合", () => {
    expect(dragPayloadIds("b", ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("拖没选中的人时只拖他一个，不把选中的人一起卷走", () => {
    expect(dragPayloadIds("z", ["a", "b"])).toEqual(["z"]);
  });
});

describe("parseDragPayload", () => {
  it("读回 id 列表", () => {
    expect(parseDragPayload(JSON.stringify(["a", "b"]))).toEqual(["a", "b"]);
  });

  it("外部拖进来的东西一律当作不是成员拖动", () => {
    expect(parseDragPayload(null)).toEqual([]);
    expect(parseDragPayload("not json")).toEqual([]);
    expect(parseDragPayload(JSON.stringify({ id: "a" }))).toEqual([]);
    expect(parseDragPayload(JSON.stringify(["a", 3, ""]))).toEqual(["a"]);
  });
});
