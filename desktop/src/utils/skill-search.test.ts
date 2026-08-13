import { describe, expect, it } from "vitest";
import { filterAndRankSkills, skillSearchScore } from "./skill-search";

const PLANNING = {
  name: "planning-with-files",
  description:
    "Implements Manus-style file-based planning for complex tasks. Creates task_plan.md, findings.md, and progress.md. Use when starting complex multi-step tasks, research projects, or any task requiring >5 tool calls.",
};

const TECH_BLOG = {
  name: "tech-blog-generator",
  description:
    "基于种子信息（关键词、URL、GitHub 仓库等）进行网络检索与资料爬取。Use when the user wants to research a technical topic and generate a blog post.",
};

const ARCHSCRIBE = {
  name: "archscribe",
  description:
    "Create premium hand-drawn architecture, workflow, and swimlane diagrams in a dark neon or light paper style. Use whenever the user asks for 岚叔动态架构图、手绘架构图.",
};

const SKILLS = [PLANNING, TECH_BLOG, ARCHSCRIBE];

describe("skillSearchScore", () => {
  it("does not match arch inside research", () => {
    expect(skillSearchScore(PLANNING.name, PLANNING.description, "arch")).toBeNull();
    expect(skillSearchScore(TECH_BLOG.name, TECH_BLOG.description, "arch")).toBeNull();
  });

  it("scores archscribe highest for arch via name prefix", () => {
    const score = skillSearchScore(ARCHSCRIBE.name, ARCHSCRIBE.description, "arch");
    expect(score).toBeGreaterThan(800);
  });

  it("matches architecture as a description token prefix", () => {
    const score = skillSearchScore(
      "diagram-kit",
      "Create architecture diagrams",
      "arch",
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(600);
  });

  it("matches Chinese description substring", () => {
    expect(skillSearchScore(ARCHSCRIBE.name, ARCHSCRIBE.description, "架构")).toBeGreaterThan(0);
  });
});

describe("filterAndRankSkills", () => {
  it("ranks archscribe first for arch and drops research false positives", () => {
    const ranked = filterAndRankSkills(SKILLS, "arch");
    expect(ranked.map((s) => s.name)).toEqual(["archscribe"]);
  });

  it("keeps archscribe for archs", () => {
    const ranked = filterAndRankSkills(SKILLS, "archs");
    expect(ranked.map((s) => s.name)).toEqual(["archscribe"]);
  });

  it("still finds hyphenated names by token prefix", () => {
    const ranked = filterAndRankSkills(SKILLS, "planning");
    expect(ranked.map((s) => s.name)).toEqual(["planning-with-files"]);
  });

  it("allows longer name infixes such as scribe", () => {
    const ranked = filterAndRankSkills(SKILLS, "scribe");
    expect(ranked.map((s) => s.name)).toEqual(["archscribe"]);
  });

  it("returns the original list when the query is empty", () => {
    expect(filterAndRankSkills(SKILLS, "  ")).toEqual(SKILLS);
  });
});
