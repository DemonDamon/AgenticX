import { describe, expect, it } from "vitest";
import {
  buildAgentItems,
  buildCommandItems,
  buildMcpItems,
  buildSkillItems,
  buildUnifiedItems,
  filterSkills,
  filterUnifiedItems,
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

describe("buildSkillItems with local market skills", () => {
  const localMarketSkills = [
    { name: "decidealot", description: "Installed from clawhub earlier", source: "registry" },
    { name: "deep research", description: "Local copy colliding with registry catalog entry", source: "registry" },
    { name: "builtin_skill", description: "Not market-installed", source: "builtin" },
  ];

  it("adds installed cards for market-installed local skills missing from the catalog", () => {
    const items = buildSkillItems(RECOMMENDED_SKILLS, registryItems, localNames, localMarketSkills);
    const decidealot = items.find((it) => it.name === "decidealot");
    expect(decidealot?.installed).toBe(true);
    expect(decidealot?.tier).toBe("third_party");
    expect(decidealot?.origin).toBe("registry");
  });

  it("dedupes local skills already covered by recommended/registry entries", () => {
    const items = buildSkillItems(RECOMMENDED_SKILLS, registryItems, localNames, localMarketSkills);
    const deep = items.filter((it) => normalizeSkillName(it.name) === "deep research");
    expect(deep).toHaveLength(1);
    expect(deep[0].origin).toBe("registry");
    expect(deep[0].source).toBe("clawhub");
  });

  it("ignores non-market local skills", () => {
    const items = buildSkillItems(RECOMMENDED_SKILLS, registryItems, localNames, localMarketSkills);
    expect(items.some((it) => it.name === "builtin_skill")).toBe(false);
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

  it("keeps installable entries for the installable tag", () => {
    const installable = filterSkills(items, "installable", "");
    expect(installable.length).toBeGreaterThan(0);
    expect(installable.every((it) => it.origin === "registry" || it.cta === "install")).toBe(true);
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

  it("inserts installable after recommended when installable entries exist", () => {
    const items = buildSkillItems(RECOMMENDED_SKILLS, registryItems, localNames);
    const tags = skillFilterTags(items);
    expect(tags.indexOf("installable")).toBe(2);
  });

  it("omits installable when nothing is installable", () => {
    const onlyOfficialSite = RECOMMENDED_SKILLS.filter((s) => s.cta !== "install");
    const tags = skillFilterTags(buildSkillItems(onlyOfficialSite, [], new Set()));
    expect(tags).not.toContain("installable");
  });
});

describe("buildMcpItems", () => {
  const mcpEntries = [
    {
      serverId: "github",
      name: "GitHub",
      description: "Code hosting",
      serverNames: ["github"],
      logoUrl: "https://x/github.png",
    },
    { serverId: "zhihu", name: "Zhihu", description: "Q&A data", serverNames: ["zhihu"] },
  ];

  it("maps entries to unified kind=mcp items with roster-based install state", () => {
    const items = buildMcpItems(mcpEntries, new Set(["github"]));
    expect(items).toHaveLength(2);
    const gh = items.find((it) => it.key === "mcp:github");
    expect(gh?.kind).toBe("mcp");
    expect(gh?.installed).toBe(true);
    expect(gh?.serverId).toBe("github");
    expect(gh?.logoUrl).toBe("https://x/github.png");
    expect(items.find((it) => it.key === "mcp:zhihu")?.installed).toBe(false);
  });
});

describe("buildAgentItems", () => {
  it("maps local avatars to always-installed kind=agent items", () => {
    const items = buildAgentItems([
      { id: "a1", name: "写作助手", role: "写作", avatar_url: "https://x/1.png" },
      { id: "a2", name: "Code Reviewer" },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      key: "agent:a1",
      kind: "agent",
      name: "写作助手",
      installed: true,
      avatarUrl: "https://x/1.png",
    });
    expect(items[0].description).toBe("写作");
    expect(items[1].description).toBe("");
  });
});

describe("buildCommandItems", () => {
  it("maps builtin and custom commands with scope-aware keys and builtin flag", () => {
    const items = buildCommandItems([
      { name: "plan", description: "Make a plan", builtin: true },
      { name: "deploy-check", description: "Custom", builtin: false, scope: "global" },
    ]);
    expect(items[0]).toMatchObject({
      key: "command:builtin:plan",
      kind: "command",
      installed: true,
      builtin: true,
    });
    expect(items[1]).toMatchObject({
      key: "command:global:deploy-check",
      builtin: false,
      commandScope: "global",
    });
  });
});

describe("buildUnifiedItems", () => {
  const mcpEntries = [
    { serverId: "github", name: "GitHub", description: "Code hosting", serverNames: ["github"] },
  ];
  const agents = [{ id: "a1", name: "写作助手", role: "写作" }];
  const commands = [{ name: "plan", description: "Make a plan", builtin: true }];
  const skillItems = buildSkillItems(RECOMMENDED_SKILLS, registryItems, localNames);

  it("merges mcp, skills, agents and commands in stable kind order", () => {
    const items = buildUnifiedItems(mcpEntries, skillItems, agents, commands, new Set(["github"]));
    const kinds = items.map((it) => it.kind);
    expect(kinds[0]).toBe("mcp");
    expect(kinds.lastIndexOf("mcp")).toBeLessThan(kinds.indexOf("skill"));
    expect(kinds.lastIndexOf("skill")).toBeLessThan(kinds.indexOf("agent"));
    expect(kinds.lastIndexOf("agent")).toBeLessThan(kinds.indexOf("command"));
  });

  it("projects skill items with install-flow fields preserved", () => {
    const items = buildUnifiedItems(mcpEntries, skillItems, agents, commands, new Set());
    const officecli = items.find((it) => it.kind === "skill" && it.id === "officecli");
    expect(officecli).toMatchObject({
      name: "OfficeCLI",
      provider: "iOfficeAI",
      origin: "recommended",
      installed: true,
    });
    expect(officecli?.iconSrc).toBeTruthy();
    const deep = items.find((it) => it.kind === "skill" && it.name === "Deep Research");
    expect(deep).toMatchObject({ origin: "registry", source: "clawhub", installed: false });
  });

  it("marks mcp install state via the configured roster", () => {
    const items = buildUnifiedItems(mcpEntries, skillItems, agents, commands, new Set(["github"]));
    expect(items.find((it) => it.key === "mcp:github")?.installed).toBe(true);
  });
});

describe("filterUnifiedItems", () => {
  const mcpEntries = [
    { serverId: "github", name: "GitHub", description: "Code hosting", serverNames: ["github"] },
  ];
  const agents = [{ id: "a1", name: "写作助手", role: "写作" }];
  const commands = [{ name: "plan", description: "Make a plan", builtin: true }];
  const items = buildUnifiedItems(
    mcpEntries,
    buildSkillItems(RECOMMENDED_SKILLS, registryItems, localNames),
    agents,
    commands,
    new Set(),
  );

  it("filters by kind tag", () => {
    expect(filterUnifiedItems(items, "mcp", "").every((it) => it.kind === "mcp")).toBe(true);
    expect(filterUnifiedItems(items, "skill", "").every((it) => it.kind === "skill")).toBe(true);
    expect(filterUnifiedItems(items, "agent", "").every((it) => it.kind === "agent")).toBe(true);
    expect(filterUnifiedItems(items, "command", "").every((it) => it.kind === "command")).toBe(true);
    expect(filterUnifiedItems(items, "all", "").length).toBe(items.length);
  });

  it("matches query against name and description", () => {
    expect(filterUnifiedItems(items, "all", "github").some((it) => it.key === "mcp:github")).toBe(
      true,
    );
    expect(filterUnifiedItems(items, "all", "写作助手").some((it) => it.kind === "agent")).toBe(true);
    expect(filterUnifiedItems(items, "all", "zzz-none")).toHaveLength(0);
  });
});
