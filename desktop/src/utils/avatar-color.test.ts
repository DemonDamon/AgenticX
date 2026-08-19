import { describe, expect, it } from "vitest";
import { expertLabelChipStyle } from "./avatar-color";

describe("expertLabelChipStyle", () => {
  // 底色用主题强调色本身，文字用 --theme-color-fg-rgb —— 两者不是同一个变量。
  // 白色/浅色强调主题下，强调色直接当文字就读不出来了（见 762a092d），fg 是做过
  // 对比度校正的那一份。这里分别钉住，避免有人图省事把文字改回强调色原值。
  it("uses theme accent for meta / empty id", () => {
    const meta = expertLabelChipStyle("meta", null, "light");
    expect(meta.backgroundColor).toContain("--theme-color-rgb");
    expect(meta.borderColor).toContain("--theme-color-rgb");
    expect(meta.color).toContain("--theme-color-fg-rgb");
  });

  it("keeps the same palette for a stable avatar id across themes", () => {
    const light = expertLabelChipStyle("avatar-architect", "blue", "light");
    const dark = expertLabelChipStyle("avatar-architect", "blue", "dark");
    expect(light.color).toBe("rgb(59, 130, 246)");
    expect(dark.color).toBe("rgb(59, 130, 246)");
    expect(light.backgroundColor).not.toBe(dark.backgroundColor);
  });

  it("hashes unset color so different experts diverge", () => {
    const a = expertLabelChipStyle("expert-a", null, "light");
    const b = expertLabelChipStyle("expert-b", null, "light");
    expect(a.color).not.toBe(b.color);
  });
});
