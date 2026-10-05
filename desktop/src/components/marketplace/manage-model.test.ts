import { describe, expect, it } from "vitest";
import { buildManageMcpRows, buildManageSkillRows } from "./manage-model";
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
});
