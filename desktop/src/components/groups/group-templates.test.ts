import { describe, expect, it } from "vitest";

import { GROUP_TEMPLATES } from "./group-templates";

describe("desktop group templates", () => {
  it("ships the six visible templates with concrete members", () => {
    expect(GROUP_TEMPLATES.map((template) => template.id)).toEqual([
      "product-flow",
      "market-research",
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
