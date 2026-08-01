import { describe, expect, it } from "vitest";
import { formatClarifyAnswer } from "./DeepResearchClarifyCard";

describe("formatClarifyAnswer", () => {
  it("joins multiple selected labels with顿号", () => {
    expect(formatClarifyAnswer(["编程", "产品"])).toBe("编程、产品");
  });

  it("appends custom text after selected labels", () => {
    expect(formatClarifyAnswer(["编程"], "还要覆盖运维")).toBe("编程、还要覆盖运维");
  });

  it("returns only custom when nothing selected", () => {
    expect(formatClarifyAnswer([], "自定义")).toBe("自定义");
  });

  it("returns empty when neither selected nor custom", () => {
    expect(formatClarifyAnswer([])).toBe("");
    expect(formatClarifyAnswer(["", "  "], "  ")).toBe("");
  });

  it("trims whitespace around parts", () => {
    expect(formatClarifyAnswer([" 编程 ", "产品 "], " 补充 ")).toBe("编程、产品、补充");
  });
});
