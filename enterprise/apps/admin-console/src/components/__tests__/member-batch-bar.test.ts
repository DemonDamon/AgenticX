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

  it("would silently revoke everyone if handed an empty feature set", () => {
    // 这不是 nextKeys 的 bug，是功能开关那条语义的陷阱：分配表一行都没有 = 全员可用。
    // 此时写入「被选中的这几个人」，效果是把其他所有人关掉。MemberBatchBar 因此在
    // 调用之前就拦住空集合——这个用例把「为什么必须拦」钉在这儿。
    expect(nextKeys([], ["u_a"], true)).toEqual(["u_a"]);
  });
});
