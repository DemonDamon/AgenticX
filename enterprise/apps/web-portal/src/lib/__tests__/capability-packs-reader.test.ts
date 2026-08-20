import type { PlatformFeature } from "@agenticx/config";
import { describe, expect, it } from "vitest";
import {
  ALL_MEMBERS_ASSIGNMENT_KEY,
  capabilityStatesFromView,
  effectiveFromView,
  findUnmetSkillDependencies,
  type PortalCapability,
} from "../capability-packs-reader";

const MCP_ID = "mcp:01JQMZ8K3N4P5Q6R7S8T9VWXYZ";
const SKILL_ID = "skill:01JQMZ8K3N4P5Q6R7S8T9VWXY0";

function skill(id: string, requires: string[] = []): PortalCapability {
  return { id, kind: "skill", name: "s", displayName: "S", requires };
}
function mcp(id: string): PortalCapability {
  return { id, kind: "mcp", name: "m", displayName: "M", requires: [] };
}

describe("findUnmetSkillDependencies", () => {
  it("reports a declared dependency that was not delivered with the pack", () => {
    // Skill 装上了但依赖的 MCP 没随包下发，员工那边点了就是报错。
    expect(findUnmetSkillDependencies([skill(SKILL_ID, [MCP_ID])])).toEqual([MCP_ID]);
  });

  it("stays silent once the dependency is delivered too", () => {
    expect(findUnmetSkillDependencies([skill(SKILL_ID, [MCP_ID]), mcp(MCP_ID)])).toEqual([]);
  });

  it("ignores malformed dependency entries rather than reporting them as missing", () => {
    expect(findUnmetSkillDependencies([skill(SKILL_ID, ["market-data", ""])])).toEqual([]);
  });

  it("dedupes a dependency shared by several skills", () => {
    expect(
      findUnmetSkillDependencies([
        skill("skill:01JQMZ8K3N4P5Q6R7S8T9VWXY1", [MCP_ID]),
        skill("skill:01JQMZ8K3N4P5Q6R7S8T9VWXY2", [MCP_ID]),
      ]),
    ).toEqual([MCP_ID]);
  });
});

describe("assignment keys", () => {
  it("pins the all-members key that admin and portal must agree on", () => {
    expect(ALL_MEMBERS_ASSIGNMENT_KEY).toBe("all");
  });
});

describe("view -> delivery / listing", () => {
  const view = {
    assigned: [skill(SKILL_ID), mcp(MCP_ID)],
    assignedPlatformFeatures: new Set<PlatformFeature>(["deep_research"]),
    optOuts: new Set([SKILL_ID]),
  };

  it("does not deliver user-disabled or server-only platform capabilities", () => {
    expect(effectiveFromView(view).map((item) => item.id)).toEqual([MCP_ID]);
  });

  it("still lists the disabled one, otherwise it can never be turned back on", () => {
    expect(capabilityStatesFromView(view).map((item) => [item.id, item.state])).toEqual([
      [SKILL_ID, "off"],
      [MCP_ID, "on"],
    ]);
  });
});
