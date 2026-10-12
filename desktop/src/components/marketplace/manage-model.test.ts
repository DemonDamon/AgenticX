import { describe, expect, it } from "vitest";
import {
  buildManageAgentRows,
  buildManageCommandRows,
  buildManageMcpRows,
  buildManageSkillRows,
  buildAuthRows,
  matchServerLogoEntry,
  findUnmatchedServerNames,
  type ManageAuthServerInput,
} from "./manage-model";
import type { MarketMcpEntry } from "./model";

describe("buildManageSkillRows", () => {
  const skills = [
    { name: "decidealot", description: "Decision helper", source: "registry", globally_disabled: false },
    { name: "officecli", description: "Office 工具集", source: "builtin", globally_disabled: true },
    { name: "翻译助手", description: "Translate text", source: "custom" },
  ];

  it("maps fields and keeps disabled state", () => {
    const rows = buildManageSkillRows(skills, "");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ key: "skill:decidealot", disabled: false, source: "registry" });
    expect(rows[1]).toMatchObject({ name: "officecli", disabled: true });
  });

  it("filters by name, description and source (case-insensitive)", () => {
    expect(buildManageSkillRows(skills, "decide")).toHaveLength(1);
    expect(buildManageSkillRows(skills, "office")).toHaveLength(1);
    expect(buildManageSkillRows(skills, "翻译")).toHaveLength(1);
    expect(buildManageSkillRows(skills, "registry")).toHaveLength(1);
    expect(buildManageSkillRows(skills, "nope")).toHaveLength(0);
  });
});

describe("buildManageMcpRows", () => {
  const servers = [
    { name: "github", connected: true, tool_count: 12 },
    { name: "amap-maps", connected: false, tool_count: 0 },
  ];
  const entries: MarketMcpEntry[] = [
    {
      serverId: "amap",
      name: "高德地图",
      description: "Maps",
      serverNames: ["amap-maps"],
      logoUrl: "https://example.com/amap.png",
    },
    {
      serverId: "other",
      name: "Other",
      description: "Other",
      serverNames: ["unrelated"],
      logoUrl: "https://example.com/other.png",
    },
  ];

  it("maps server rows with matched marketplace logo", () => {
    const rows = buildManageMcpRows(servers, entries, "");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ key: "mcp:github", connected: true, toolCount: 12, logoUrl: undefined });
    expect(rows[1]).toMatchObject({ name: "amap-maps", connected: false, logoUrl: "https://example.com/amap.png" });
  });

  it("filters by server name", () => {
    expect(buildManageMcpRows(servers, entries, "git")).toHaveLength(1);
    expect(buildManageMcpRows(servers, entries, "amap")).toHaveLength(1);
    expect(buildManageMcpRows(servers, entries, "zzz")).toHaveLength(0);
  });

  it("matches logos with normalized server names", () => {
    const rows = buildManageMcpRows(
      [{ name: "Amap-Maps", connected: true }],
      entries,
      "",
    );
    expect(rows[0].logoUrl).toBe("https://example.com/amap.png");
  });
});

describe("findUnmatchedServerNames", () => {
  const entries: MarketMcpEntry[] = [
    {
      serverId: "amap",
      name: "高德地图",
      description: "",
      serverNames: ["amap-maps"],
      logoUrl: "https://example.com/amap.png",
    },
    {
      serverId: "nologo",
      name: "NoLogo",
      description: "",
      serverNames: ["nologo-server"],
    },
  ];

  it("returns servers without a logo-matched entry, deduped and order-kept", () => {
    const servers = [
      { name: "amap-maps" },
      { name: "12306-mcp" },
      { name: "bocha-search-mcp" },
      { name: "12306-mcp" },
      { name: "" },
    ];
    expect(findUnmatchedServerNames(servers, entries)).toEqual([
      "12306-mcp",
      "bocha-search-mcp",
    ]);
  });

  it("treats entries without logoUrl as non-matching", () => {
    expect(findUnmatchedServerNames([{ name: "nologo-server" }], entries)).toEqual([
      "nologo-server",
    ]);
  });
});

describe("matchServerLogoEntry", () => {
  const candidates: MarketMcpEntry[] = [
    {
      serverId: "community/12306-mcp",
      name: "12306 火车票",
      description: "",
      serverNames: ["train-12306"],
      logoUrl: "https://example.com/community.png",
    },
    {
      serverId: "@Joooook/12306-mcp",
      name: "12306-MCP车票查询工具",
      description: "",
      serverNames: ["12306-mcp"],
      logoUrl: "https://example.com/official.png",
    },
  ];

  it("picks the first candidate whose server names match (normalized)", () => {
    expect(matchServerLogoEntry("12306-MCP", candidates)?.logoUrl).toBe(
      "https://example.com/official.png",
    );
  });

  it("returns undefined when no candidate matches", () => {
    expect(matchServerLogoEntry("xiniudata", candidates)).toBeUndefined();
  });
});

describe("buildManageAgentRows", () => {
  const agents = [
    { id: "a1", name: "写作助手", role: "写作", avatar_url: "https://x/1.png" },
    { id: "a2", name: "Code Reviewer", description: "Reviews pull requests" },
    { id: "", name: "broken" },
  ];

  it("maps avatar rows with role/description fallback and filters invalid ids", () => {
    const rows = buildManageAgentRows(agents, "");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      key: "agent:a1",
      id: "a1",
      name: "写作助手",
      description: "写作",
      avatarUrl: "https://x/1.png",
    });
    expect(rows[1]).toMatchObject({ description: "Reviews pull requests", avatarUrl: undefined });
  });

  it("filters by name and description (case-insensitive)", () => {
    expect(buildManageAgentRows(agents, "写作")).toHaveLength(1);
    expect(buildManageAgentRows(agents, "review")).toHaveLength(1);
    expect(buildManageAgentRows(agents, "nope")).toHaveLength(0);
  });
});

describe("buildAuthRows", () => {
  const servers: ManageAuthServerInput[] = [
    { name: "feishu", connected: true, env: { APP_ID: "x", APP_SECRET: "y" } },
    { name: "github", connected: true },
    { name: "fetch", connected: true },
    { name: "custom-data", connected: false, env: { API_TOKEN: "abc" } },
    { name: "plain-server", connected: true },
  ];
  const entries: MarketMcpEntry[] = [
    { serverId: "feishu", name: "飞书", description: "Lark", serverNames: ["feishu"], logoUrl: "https://x/feishu.png" },
  ];

  it("includes servers with credential env vars or known OAuth provider names", () => {
    const rows = buildAuthRows(servers, entries, "");
    const names = rows.map((r) => r.name);
    expect(names).toContain("feishu");
    expect(names).toContain("github");
    expect(names).toContain("custom-data");
    expect(names).not.toContain("fetch");
    expect(names).not.toContain("plain-server");
  });

  it("marks connected state and hasCredentials correctly", () => {
    const rows = buildAuthRows(servers, entries, "");
    const feishu = rows.find((r) => r.name === "feishu");
    expect(feishu?.connected).toBe(true);
    expect(feishu?.hasCredentials).toBe(true);
    const github = rows.find((r) => r.name === "github");
    expect(github?.hasCredentials).toBe(false);
  });

  it("filters by name case-insensitively", () => {
    expect(buildAuthRows(servers, entries, "feishu")).toHaveLength(1);
    expect(buildAuthRows(servers, entries, "nope")).toHaveLength(0);
  });

  it("matches marketplace logo by server name", () => {
    const rows = buildAuthRows(servers, entries, "");
    expect(rows.find((r) => r.name === "feishu")?.logoUrl).toBe("https://x/feishu.png");
  });
});

describe("buildManageCommandRows", () => {
  const commands = [
    { name: "plan", description: "Make a plan", builtin: true, enabled: true },
    { name: "summarize", description: "Summarize thread", builtin: true, enabled: false },
    { id: "c3", name: "deploy-check", description: "Custom deploy guard", builtin: false, scope: "global" },
  ];

  it("maps builtin rows with enabled state and custom rows with command id", () => {
    const rows = buildManageCommandRows(commands, "");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ key: "command:builtin:plan", builtin: true, enabled: true });
    expect(rows[1]).toMatchObject({ builtin: true, enabled: false });
    expect(rows[2]).toMatchObject({
      key: "command:global:deploy-check",
      builtin: false,
      enabled: true,
      commandId: "c3",
    });
  });

  it("filters by name and description (case-insensitive)", () => {
    expect(buildManageCommandRows(commands, "plan")).toHaveLength(1);
    expect(buildManageCommandRows(commands, "deploy")).toHaveLength(1);
    expect(buildManageCommandRows(commands, "nope")).toHaveLength(0);
  });
});
