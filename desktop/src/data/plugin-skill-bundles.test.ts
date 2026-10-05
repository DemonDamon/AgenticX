import { describe, expect, it } from "vitest";
import { getSkillsForPlugin, hasBundledSkills } from "./plugin-skill-bundles";

describe("plugin-skill-bundles", () => {
  it("returns bundled skills for known plugins", () => {
    const feishu = getSkillsForPlugin("feishu");
    expect(feishu.length).toBeGreaterThan(0);
    expect(feishu.every((s) => s.kind === "recommended" || s.kind === "registry")).toBe(true);
  });

  it("returns empty array for unknown plugins", () => {
    expect(getSkillsForPlugin("nonexistent-server")).toEqual([]);
  });

  it("hasBundledSkills reflects existence", () => {
    expect(hasBundledSkills("feishu")).toBe(true);
    expect(hasBundledSkills("unknown")).toBe(false);
  });

  it("registry skills carry source and name", () => {
    const github = getSkillsForPlugin("github");
    const registry = github.filter((s) => s.kind === "registry");
    expect(registry.length).toBeGreaterThan(0);
    for (const s of registry) {
      if (s.kind === "registry") {
        expect(s.source).toBeTruthy();
        expect(s.name).toBeTruthy();
      }
    }
  });

  it("recommended skills carry id", () => {
    const feishu = getSkillsForPlugin("feishu");
    const rec = feishu.filter((s) => s.kind === "recommended");
    expect(rec.length).toBeGreaterThan(0);
    for (const s of rec) {
      if (s.kind === "recommended") {
        expect(s.id).toBeTruthy();
      }
    }
  });
});
