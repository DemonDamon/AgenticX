import { describe, expect, it } from "vitest";

import { nextKeys } from "../MemberBatchBar";

describe("nextKeys", () => {
  it("adds the selected users without dropping who was already there", () => {
    expect(nextKeys(["all", "u_a"], ["u_b", "u_c"], true).sort()).toEqual([
      "all",
      "u_a",
      "u_b",
      "u_c",
    ]);
  });

  it("removes only the selected users", () => {
    expect(nextKeys(["u_a", "u_b"], ["u_a"], false)).toEqual(["u_b"]);
  });

  it("does not duplicate a user who is already assigned", () => {
    expect(nextKeys(["u_a"], ["u_a"], true)).toEqual(["u_a"]);
  });

  it("turns an unassigned pack into one assigned to exactly these users", () => {
    // 能力包的空分配 = 谁都没有，所以从空集合起步写入选中的人就是字面意思。
    // （功能开关那边曾经是反的——空 = 全员，写入几个人等于把其余所有人关掉。
    // 那条语义已经随功能并入能力包一起消失，操作条上也不再有那两个开关。）
    expect(nextKeys([], ["u_a"], true)).toEqual(["u_a"]);
  });
});
