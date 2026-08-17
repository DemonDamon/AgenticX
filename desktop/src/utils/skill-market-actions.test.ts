import { describe, expect, it } from "vitest";

import {
  buildSkillTryPrompt,
  findInstalledMarketplaceSkill,
  hasAlternateSkillVariant,
  skillMarkdownPath,
} from "./skill-market-actions";

describe("skill marketplace actions", () => {
  it("binds actions only to the installed registry folder", () => {
    const local = {
      name: "report-reader",
      base_dir: "/tmp/project/report-reader",
      source: "custom",
    };
    const installed = {
      name: "report-reader",
      base_dir: "/home/user/.agenticx/skills/registry/report-reader",
      source: "skillhub",
    };

    expect(findInstalledMarketplaceSkill([local], "report-reader")).toBeNull();
    expect(findInstalledMarketplaceSkill([local, installed], "report-reader")).toEqual(
      installed,
    );
  });

  it("does not confuse a similarly named custom registry folder with a managed install", () => {
    expect(
      findInstalledMarketplaceSkill(
        [
          {
            name: "report-reader",
            base_dir: "/tmp/registry/report-reader",
            source: "custom",
          },
          {
            name: "report-reader-copy",
            base_dir: "/tmp/.agenticx/skills/registry/report-reader",
            source: "custom",
          },
        ],
        "report-reader",
      ),
    ).toBeNull();
  });

  it("uses a registry variant when another source wins the visible conflict", () => {
    const selected = findInstalledMarketplaceSkill(
      [
        {
          name: "sheet-helper",
          base_dir: "/tmp/project/sheet-helper",
          source: "custom",
          variants: [
            {
              source: "skillhub",
              base_dir: "C:\\Users\\me\\.agenticx\\skills\\registry\\sheet-helper\\",
            },
          ],
        },
      ],
      "sheet-helper",
    );

    expect(selected?.source).toBe("skillhub");
    expect(selected?.base_dir).toContain("registry\\sheet-helper");
  });

  it("preserves a disabled name when uninstall leaves another source variant", () => {
    expect(
      hasAlternateSkillVariant({
        name: "sheet-helper",
        base_dir: "/home/me/.agenticx/skills/registry/sheet-helper",
        source: "skillhub",
        variants: [
          {
            source: "skillhub",
            base_dir: "/home/me/.agenticx/skills/registry/sheet-helper",
          },
          { source: "custom", base_dir: "/work/skills/sheet-helper" },
        ],
      }),
    ).toBe(true);
    expect(
      hasAlternateSkillVariant({
        name: "sheet-helper",
        base_dir: "/home/me/.agenticx/skills/registry/sheet-helper",
        source: "skillhub",
        variants: [
          {
            source: "skillhub",
            base_dir: "/home/me/.agenticx/skills/registry/sheet-helper",
          },
        ],
      }),
    ).toBe(false);
  });

  it("builds a real skill reference and its editable markdown path", () => {
    expect(buildSkillTryPrompt("financial-review")).toContain(
      "@skill://financial-review",
    );
    expect(skillMarkdownPath("/tmp/financial-review/")).toBe(
      "/tmp/financial-review/SKILL.md",
    );
  });
});
