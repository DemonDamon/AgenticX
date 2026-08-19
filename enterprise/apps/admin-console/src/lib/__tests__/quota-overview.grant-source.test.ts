import { describe, expect, it } from "vitest";

import {
  featureSummary,
  modelOrigin,
  originForKeys,
  type OriginContext,
} from "../quota-overview";

/** 张三：在研发组里，挂在前端部门下。 */
const ctx: OriginContext = {
  userKeys: new Set(["all", "u_zhangsan", "email:zhang@example.com", "group:g_rd", "dept:d_fe", "dept:d_root"]),
  groupNameByKey: new Map([["group:g_rd", "研发组"]]),
  deptNameByKey: new Map([
    ["dept:d_fe", "前端组"],
    ["dept:d_root", "研发中心"],
  ]),
};

describe("originForKeys", () => {
  it("names the group a pack came from", () => {
    expect(originForKeys(["group:g_rd"], ctx)).toEqual({ source: "group", sourceLabel: "研发组" });
  });

  it("reports the most specific key when several match", () => {
    // 既在全员范围里、又被单独特批过，卡片该显示「特批」——把他移出全员也收不回这一项。
    expect(originForKeys(["all", "group:g_rd", "u_zhangsan"], ctx)).toEqual({ source: "personal" });
    expect(originForKeys(["all", "dept:d_fe"], ctx)).toEqual({
      source: "department",
      sourceLabel: "前端组",
    });
  });

  it("ignores assignments aimed at someone else", () => {
    expect(originForKeys(["group:g_sales", "u_lisi"], ctx)).toBeNull();
  });
});

describe("modelOrigin", () => {
  const groups = [{ name: "研发组", modelIds: ["p/claude", "p/gpt4o"] }];

  it("calls a model the user holds personally a personal grant", () => {
    expect(modelOrigin("p/o1", new Set(["p/o1"]), groups)).toEqual({ source: "personal" });
  });

  it("attributes a model to the group that grants it", () => {
    expect(modelOrigin("p/claude", new Set(), groups)).toEqual({
      source: "group",
      sourceLabel: "研发组",
    });
  });

  it("treats anything left as inherited from the department ceiling", () => {
    expect(modelOrigin("p/other", new Set(), groups)).toEqual({ source: "department" });
  });

  it("prefers personal over group when both hold it", () => {
    // 两边都有时算特批：退出研发组他仍然留着这个模型。
    expect(modelOrigin("p/claude", new Set(["p/claude"]), groups)).toEqual({ source: "personal" });
  });
});

describe("featureSummary", () => {
  it("treats no assignment rows at all as open to everyone", () => {
    // 一行都没有 = 还没管过这项功能，全员可用；不是「谁都没有」。
    expect(featureSummary([], ctx)).toEqual({ enabled: true, source: "all" });
  });

  it("reports which group switched the feature on", () => {
    expect(featureSummary(["group:g_rd"], ctx)).toEqual({
      enabled: true,
      source: "group",
      sourceLabel: "研发组",
    });
  });

  it("reports off when the rows exist but none name this user", () => {
    expect(featureSummary(["group:g_sales"], ctx)).toEqual({ enabled: false, source: "all" });
  });
});
