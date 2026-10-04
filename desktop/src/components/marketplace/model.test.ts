import { describe, expect, it } from "vitest";
import {
  buildPluginItems,
  buildSkillItems,
  filterPlugins,
  filterSkills,
  isMcpInstalled,
  isSkillInstalled,
  normalizeSkillName,
  skillFilterTags,
} from "./model";
import { RECOMMENDED_SKILLS } from "../../data/recommended-skills";

const localNames = new Set(["officecli", "腾讯文档"]);

const registryItems = [
  {
    name: "Deep Research",
    description: "Multi-step web research skill",
    version: "1.0.0",
    author: "agx",
    source: "clawhub",
    source_type: "clawhub",
    install_hint: "",
  },
  {
    name: "officecli",
    description: "Duplicate of recommended entry",
    version: "2.0.0",
    author: "someone",
    source: "clawhub",
    source_type: "clawhub",
    install_hint: "",
  },
];

describe("normalizeSkillName", () => {
  it("trims and lowercases", () => {
    expect(normalizeSkillName("  OfficeCLI ")).toBe("officecli");
  });
});

describe("isSkillInstalled", () => {
  it("matches case-insensitively against local skill names", () => {
    expect(isSkillInstalled("OfficeCLI", localNames)).toBe(true);
    expect(isSkillInstalled("Deep Research", localNames)).toBe(false);
  });
});

describe("isMcpInstalled", () => {
  it("matches when any provided server name is configured", () => {
    const configured = new Set(["github", "notion"]);
    expect(isMcpInstalled(["GitHub"], configured)).toBe(true);
    expect(isMcpInstalled(["jira"], configured)).toBe(false);
    expect(isMcpInstalled([], configured)).toBe(false);
  });
});

describe("buildSkillItems", () => {
  const items = buildSkillItems(RECOMMENDED_SKILLS, registryItems, localNames);

  it("puts recommended entries first and marks installed state", () => {
    expect(items[0].origin).toBe("recommended");
    const officecli = items.find((it) => it.name === "OfficeCLI");
    expect(officecli?.installed).toBe(true);
    expect(officecli?.origin).toBe("recommended");
  });

  it("dedupes registry entries that collide with recommended names", () => {
    const registryOfficecli = items.filter((it) => it.origin === "registry" && normalizeSkillName(it.name) === "officecli");
    expect(registryOfficecli).toHaveLength(0);
  });

  it("keeps non-colliding registry entries with source for install", () => {
    const deep = items.find((it) => it.name === "Deep Research");
    expect(deep?.origin).toBe("registry");
    expect(deep?.source).toBe("clawhub");
    expect(deep?.installed).toBe(false);
  });
});

describe("filterSkills", () => {
  const items = buildSkillItems(RECOMMENDED_SKILLS, registryItems, localNames);

  it("returns everything for the all tag", () => {
    expect(filterSkills(items, "all", "").length).toBe(items.length);
  });

  it("keeps only recommended origin for the recommended tag", () => {
    const rec = filterSkills(items, "recommended", "");
    expect(rec.length).toBeGreaterThan(0);
    expect(rec.every((it) => it.origin === "recommended")).toBe(true);
  });

  it("filters by tier", () => {
    const enterprise = filterSkills(items, "enterprise", "");
    expect(enterprise.every((it) => it.tier === "enterprise")).toBe(true);
  });

  it("filters by category", () => {
    const office = filterSkills(items, "Office 创作", "");
    expect(office.every((it) => it.category === "Office 创作")).toBe(true);
  });

  it("matches query against name/description/provider case-insensitively", () => {
    const byName = filterSkills(items, "all", "officecli");
    expect(byName.some((it) => normalizeSkillName(it.name) === "officecli")).toBe(true);
    const none = filterSkills(items, "all", "zzz-no-such-thing");
    expect(none).toHaveLength(0);
  });
});

describe("skillFilterTags", () => {
  it("starts with all + recommended and includes tiers and categories", () => {
    const items = buildSkillItems(RECOMMENDED_SKILLS, registryItems, localNames);
    const tags = skillFilterTags(items);
    expect(tags[0]).toBe("all");
    expect(tags[1]).toBe("recommended");
    expect(tags).toContain("enterprise");
    expect(tags).toContain("third_party");
  });
});

describe("buildPluginItems", () => {
  const mcpEntries = [
    { serverId: "github", name: "GitHub", description: "Code hosting", serverNames: ["github"] },
    { serverId: "zhihu", name: "Zhihu", description: "Q&A data", serverNames: ["zhihu"] },
  ];

  it("merges mcp entries and cta=install tools, skipping official_site tools", () => {
    const items = buildPluginItems(mcpEntries, RECOMMENDED_SKILLS, new Set(["github"]), localNames);
    expect(items.some((it) => it.kind === "mcp" && it.key === "mcp:github")).toBe(true);
    expect(items.some((it) => it.kind === "tool")).toBe(true);
    // tools with official_site cta are excluded from the plugin grid
    const tencent = items.find((it) => it.name === "腾讯文档");
    expect(tencent).toBeUndefined();
  });

  it("marks installed state for mcp (roster) and tools (local skills)", () => {
    const items = buildPluginItems(mcpEntries, RECOMMENDED_SKILLS, new Set(["github"]), localNames);
    expect(items.find((it) => it.key === "mcp:github")?.installed).toBe(true);
    expect(items.find((it) => it.key === "mcp:zhihu")?.installed).toBe(false);
    const officecli = items.find((it) => it.key.startsWith("tool:officecli"));
    expect(officecli?.installed).toBe(true);
  });
});

describe("filterPlugins", () => {
  const mcpEntries = [{ serverId: "github", name: "GitHub", description: "Code hosting", serverNames: ["github"] }];
  const items = buildPluginItems(mcpEntries, RECOMMENDED_SKILLS, new Set(), new Set());

  it("filters by kind tag", () => {
    expect(filterPlugins(items, "mcp", "").every((it) => it.kind === "mcp")).toBe(true);
    expect(filterPlugins(items, "tool", "").every((it) => it.kind === "tool")).toBe(true);
  });

  it("matches query against name and description", () => {
    expect(filterPlugins(items, "all", "github").some((it) => it.key === "mcp:github")).toBe(true);
    expect(filterPlugins(items, "all", "zzz-none")).toHaveLength(0);
  });
});
