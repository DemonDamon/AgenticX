import { describe, expect, it } from "vitest";

import { groupPackBindingChanges } from "../capability-pack-form";

const packs = [
  { id: "p_base", assignmentKeys: ["all"] },
  { id: "p_rd", assignmentKeys: ["group:g_rd", "dept:d_fe"] },
  { id: "p_sales", assignmentKeys: ["group:g_sales"] },
];

describe("groupPackBindingChanges", () => {
  it("adds the group key to a pack that was just ticked", () => {
    expect(groupPackBindingChanges(packs, "group:g_rd", ["p_rd", "p_base"])).toEqual([
      { id: "p_base", assignmentKeys: ["all", "group:g_rd"] },
    ]);
  });

  it("removes only this group's key and leaves the pack's other scopes alone", () => {
    // 取消勾选不能把包的部门分配一起清掉——那会波及一批和这个组无关的人。
    expect(groupPackBindingChanges(packs, "group:g_rd", [])).toEqual([
      { id: "p_rd", assignmentKeys: ["dept:d_fe"] },
    ]);
  });

  it("touches nothing when the selection already matches", () => {
    // 每次保存都全量写回所有包，会踩到别人的并发修改，审计日志里也全是噪音。
    expect(groupPackBindingChanges(packs, "group:g_rd", ["p_rd"])).toEqual([]);
  });

  it("never confuses one group's binding with another's", () => {
    expect(groupPackBindingChanges(packs, "group:g_sales", ["p_sales"])).toEqual([]);
    expect(groupPackBindingChanges(packs, "group:g_sales", [])).toEqual([
      { id: "p_sales", assignmentKeys: [] },
    ]);
  });
});
