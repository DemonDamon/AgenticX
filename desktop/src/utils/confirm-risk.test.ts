import { describe, expect, it } from "vitest";
import { migrateRunModeFromUnknown, RUN_MODE_OPTIONS } from "../constants/confirm-strategy-options";
import { isProtectedRisk, normalizeRisk, riskPresentation } from "./confirm-risk";

describe("normalizeRisk", () => {
  it("treats missing or unknown values as unknown", () => {
    expect(normalizeRisk(undefined)).toBe("unknown");
    expect(normalizeRisk("")).toBe("unknown");
    expect(normalizeRisk("weird")).toBe("unknown");
  });

  it("returns legal values as-is", () => {
    expect(normalizeRisk("low")).toBe("low");
    expect(normalizeRisk("medium")).toBe("medium");
    expect(normalizeRisk("high")).toBe("high");
  });
});

describe("isProtectedRisk", () => {
  it("only lets explicit low risk through", () => {
    expect(isProtectedRisk("low")).toBe(false);
    expect(isProtectedRisk("unknown")).toBe(true);
    expect(isProtectedRisk("medium")).toBe(true);
    expect(isProtectedRisk("high")).toBe(true);
  });
});

describe("riskPresentation", () => {
  it("returns a non-empty label and className for every risk", () => {
    for (const risk of ["low", "medium", "high", "unknown"] as const) {
      const presentation = riskPresentation(risk);
      expect(presentation.label.trim()).not.toBe("");
      expect(presentation.className.trim()).not.toBe("");
    }
  });
});

describe("RUN_MODE_OPTIONS", () => {
  it("has three unique values with non-empty descriptions", () => {
    expect(RUN_MODE_OPTIONS).toHaveLength(3);
    const values = RUN_MODE_OPTIONS.map((option) => option.value);
    expect(new Set(values).size).toBe(3);
    for (const option of RUN_MODE_OPTIONS) {
      expect(option.description.trim()).not.toBe("");
    }
  });

  it("describes auto as no-more-prompts without claiming isolation is off", () => {
    const auto = RUN_MODE_OPTIONS.find((option) => option.value === "auto");
    expect(auto?.label).toBe("全部允许");
    expect(auto?.description).toContain("不再询问");
    // 后端沙箱与路径拒绝仍然生效，文案不得暗示「直接在本机裸跑」。
    expect(auto?.description).toContain("隔离仍生效");
  });

  it("names the three modes 始终询问 / 按需确认 / 全部允许", () => {
    expect(RUN_MODE_OPTIONS.map((option) => option.label)).toEqual([
      "始终询问",
      "按需确认",
      "全部允许",
    ]);
  });

  it("migrates old stored values without dropping the mode", () => {
    expect(migrateRunModeFromUnknown({ confirmStrategy: "manual" })).toBe("ask");
    expect(migrateRunModeFromUnknown({ confirm_strategy: "semi-auto" })).toBe("allowlist");
    expect(migrateRunModeFromUnknown({ confirmStrategy: "auto" })).toBe("auto");
    expect(migrateRunModeFromUnknown({})).toBe("ask");
  });
});
