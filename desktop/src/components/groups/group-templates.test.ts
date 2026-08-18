import { describe, expect, it } from "vitest";

import { GROUP_TEMPLATES } from "./group-templates";

describe("desktop group templates", () => {
  it("ships the eight visible templates with concrete members", () => {
    expect(GROUP_TEMPLATES.map((template) => template.id)).toEqual([
      "product-flow",
      "market-research",
      "deal-materials",
      "market-watch",
      "team-kb",
      "delivery",
      "bug-track",
      "fullstack-squad",
    ]);
    for (const template of GROUP_TEMPLATES) {
      expect(template.members.length).toBeGreaterThanOrEqual(3);
      expect(new Set(template.members.map((member) => member.id)).size).toBe(template.members.length);
      expect(template).not.toHaveProperty("memberRoleHints");
    }
  });

  it("keeps the finance-adjacent templates inside an information-assistance boundary", () => {
    const dealMaterials = GROUP_TEMPLATES.find((template) => template.id === "deal-materials");
    const marketWatch = GROUP_TEMPLATES.find((template) => template.id === "market-watch");

    expect(dealMaterials?.members).toHaveLength(3);
    expect(marketWatch?.members).toHaveLength(3);

    for (const template of [dealMaterials, marketWatch]) {
      expect(template).toBeDefined();
      for (const member of template?.members ?? []) {
        expect(member.systemPrompt).toContain("能力边界：");
      }
    }

    const dealPrompt = dealMaterials?.members.map((member) => member.systemPrompt).join("\n") ?? "";
    expect(dealPrompt).toContain("不判断项目好坏");
    expect(dealPrompt).toContain("不代替法律、财务或商业尽调");
    expect(dealPrompt).toContain("不生成投决意见");

    const marketPrompt = marketWatch?.members.map((member) => member.systemPrompt).join("\n") ?? "";
    expect(marketPrompt).toContain("不预测价格走势");
    expect(marketPrompt).toContain("不构成专业研究报告或投资建议");
    expect(marketPrompt).toContain("不提供价格预测或交易结论");
  });

  it("gives every generated avatar a complete role contract", () => {
    for (const template of GROUP_TEMPLATES) {
      for (const member of template.members) {
        expect(member.name.trim()).not.toBe("");
        expect(member.role.trim()).not.toBe("");
        expect(member.description.trim()).not.toBe("");
        expect(member.tags.length).toBeGreaterThan(0);
        expect(member.systemPrompt).toContain(`「${template.name}」`);
        expect(member.systemPrompt).toContain("核心职责：");
        expect(member.systemPrompt).toContain("默认交付物：");
        expect(member.systemPrompt).toContain("协作规则：");
      }
    }
  });
});
