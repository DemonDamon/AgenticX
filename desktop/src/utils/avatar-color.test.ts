import { describe, expect, it } from "vitest";
import { expertLabelChipStyle } from "./avatar-color";

describe("expertLabelChipStyle", () => {
  it("uses theme accent for meta / empty id", () => {
    const meta = expertLabelChipStyle("meta", null, "light");
    expect(meta.backgroundColor).toContain("--theme-color-rgb");
    expect(meta.color).toContain("--theme-color-rgb");
  });

  it("keeps the same palette for a stable avatar id across themes", () => {
    const light = expertLabelChipStyle("avatar-architect", "violet", "light");
    const dark = expertLabelChipStyle("avatar-architect", "violet", "dark");
    expect(light.color).toBe("rgb(124, 58, 237)");
    expect(dark.color).toBe("rgb(167, 139, 250)");
    expect(light.backgroundColor).not.toBe(dark.backgroundColor);
  });

  it("hashes unset color so different experts diverge", () => {
    const a = expertLabelChipStyle("expert-a", null, "light");
    const b = expertLabelChipStyle("expert-b", null, "light");
    expect(a.color).not.toBe(b.color);
  });
});
