import { describe, expect, it } from "vitest";
import { findRuleMatches, normalizeAppliesTo, normalizeRulePayload } from "../src/services/rule-utils";

describe("rule-utils", () => {
  it("normalizes applies_to with defaults", () => {
    const applies = normalizeAppliesTo({ roleCodes: ["sales", "sales", "member"] });
    expect(applies.departmentIds).toEqual(["*"]);
    expect(applies.roleCodes).toEqual(["sales", "member"]);
    expect(applies.clientTypes).toEqual(["*"]);
    expect(applies.stages).toEqual(["request", "response"]);
  });

  it("normalizes keyword payload and removes duplicates", () => {
    const payload = normalizeRulePayload("keyword", { keywords: ["内幕交易", "内幕交易", " 资金挪用 "] });
    expect(payload.keywords).toEqual(["内幕交易", "资金挪用"]);
  });

  it("matches keyword/regex/pii similarly to go baseline", () => {
    expect(findRuleMatches("keyword", { keywords: ["内幕交易"] }, "这段文本包含内幕交易信息")).toEqual(["内幕交易"]);
    expect(findRuleMatches("regex", { pattern: "(?i)(账户余额|资金流水)" }, "资金流水存在异常").length).toBe(1);
    expect(findRuleMatches("pii", { piiType: "email" }, "联系邮箱是 foo@example.com").length).toBe(1);
  });
});
