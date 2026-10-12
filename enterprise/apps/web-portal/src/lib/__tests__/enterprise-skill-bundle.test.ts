import { afterEach, describe, expect, it } from "vitest";
import { loadSkillBody } from "../enterprise-skill-bundle";

function jsonResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

describe("loadSkillBody", () => {
  afterEach(() => {
    delete process.env.ENTERPRISE_SKILL_BUNDLE_HOST_ALLOWLIST;
  });

  it("rejects non-https, userinfo, and hosts outside the allowlist", async () => {
    process.env.ENTERPRISE_SKILL_BUNDLE_HOST_ALLOWLIST = "cdn.example.com";
    const fetchImpl = async () => jsonResponse(200, "body");
    expect(await loadSkillBody("http://cdn.example.com/SKILL.md", fetchImpl)).toBeNull();
    expect(await loadSkillBody("https://user:pass@cdn.example.com/SKILL.md", fetchImpl)).toBeNull();
    expect(await loadSkillBody("https://evil.example/SKILL.md", fetchImpl)).toBeNull();
  });

  it("returns null on non-2xx and strips frontmatter on allowlisted https", async () => {
    process.env.ENTERPRISE_SKILL_BUNDLE_HOST_ALLOWLIST = "cdn.example.com";
    expect(
      await loadSkillBody("https://cdn.example.com/a.md", async () => jsonResponse(404, "no")),
    ).toBeNull();
    const body = await loadSkillBody("https://cdn.example.com/a.md", async () =>
      jsonResponse(200, "---\nname: x\n---\n步骤"),
    );
    expect(body).toBe("步骤");
  });
});