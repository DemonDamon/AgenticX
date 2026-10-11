import { describe, expect, it } from "vitest";
import {
  ENTERPRISE_SKILLS_MARKER,
  buildEnterpriseSkillBlock,
  withEnterpriseSkillContext,
  type SkillPromptSource,
} from "../enterprise-skill-prompt";

function skill(overrides: Partial<SkillPromptSource> = {}): SkillPromptSource {
  return {
    id: "skill:01",
    displayName: "合同核验",
    description: "对照条款",
    scanVerdict: "safe",
    status: "active",
    optedOut: false,
    body: null,
    ...overrides,
  };
}

describe("buildEnterpriseSkillBlock", () => {
  it("lists at most safe active skills without bodies", () => {
    const block = buildEnterpriseSkillBlock({
      catalog: [
        skill(),
        skill({ id: "skill:02", displayName: "费用", scanVerdict: "caution" }),
        skill({ id: "skill:03", displayName: "停用", status: "disabled" }),
        skill({ id: "skill:04", displayName: "关闭", optedOut: true }),
        skill({ id: "skill:05", displayName: "未扫", scanVerdict: null }),
      ],
      focusedId: null,
    });
    expect(block).toContain("合同核验");
    expect(block).not.toContain("费用");
    expect(block).not.toContain("停用");
    expect(block).not.toContain("关闭");
    expect(block).not.toContain("未扫");
    expect(block).not.toContain("```");
  });

  it("injects only the focused body", () => {
    const block = buildEnterpriseSkillBlock({
      catalog: [skill({ body: "步骤一" }), skill({ id: "skill:02", displayName: "另一条", body: "别的正文" })],
      focusedId: "skill:01",
    });
    expect(block).toContain("步骤一");
    expect(block).not.toContain("别的正文");
  });

  it("replaces an existing skill block instead of stacking it", () => {
    const once = withEnterpriseSkillContext(
      [{ role: "system", content: "时间" }],
      buildEnterpriseSkillBlock({ catalog: [skill()], focusedId: null }),
    );
    const twice = withEnterpriseSkillContext(
      once,
      buildEnterpriseSkillBlock({ catalog: [skill({ displayName: "新技能" })], focusedId: null }),
    );
    const content = String(twice[0]?.content);
    expect(content.split(ENTERPRISE_SKILLS_MARKER)).toHaveLength(2);
    expect(content).toContain("新技能");
    expect(content).toContain("时间");
  });
});
