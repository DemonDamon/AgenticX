import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import zh from "../../messages/zh.json";
import { quotaResetHintKey } from "./QuotaCard";

const CJK = /[\u4e00-\u9fff]/;

const REQUIRED_WORKSPACE_KEYS = [
  "collabRoom",
  "quotaTitle",
  "quotaToday",
  "quotaWeek",
  "quotaMonth",
  "quotaDept",
  "quotaUnlimited",
  "quotaSharedPool",
  "quotaRemaining",
  "quotaResetNextDay",
  "quotaResetNextWeek",
  "quotaResetNextMonth",
  "quotaLoading",
  "quotaTokenUnlimited",
  "quotaWindowsUnlimited",
  "quotaPoolShort",
  "quotaLeftShort",
] as const;

describe("workspace sidebar i18n", () => {
  it("has paired zh/en keys for collab room and quota chrome", () => {
    for (const key of REQUIRED_WORKSPACE_KEYS) {
      expect(zh.workspace[key], `zh missing ${key}`).toEqual(expect.any(String));
      expect(en.workspace[key], `en missing ${key}`).toEqual(expect.any(String));
      expect(en.workspace[key]).not.toMatch(CJK);
      expect(zh.workspace[key]).toMatch(CJK);
    }
  });
});

describe("quotaResetHintKey", () => {
  it("maps period formats to translation keys", () => {
    expect(quotaResetHintKey("2026-09-08")).toBe("quotaResetNextDay");
    expect(quotaResetHintKey("2026-W37")).toBe("quotaResetNextWeek");
    expect(quotaResetHintKey("2026-09")).toBe("quotaResetNextMonth");
    expect(quotaResetHintKey("custom")).toBeNull();
  });
});
