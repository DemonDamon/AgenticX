import { describe, expect, it } from "vitest";
import {
  ALL_MEMBERS_ASSIGNMENT_KEY,
  capabilityLabel,
  danglingCapabilityIds,
  disabledMemberIds,
  fromAssignmentKeys,
  groupCapabilityChoices,
  mcpCapabilityId,
  toAssignmentKeys,
  type CapabilityChoice,
} from "../capability-pack-form";

const MCP_ROW = "01JQMZ8K3N4P5Q6R7S8T9VWXYZ";
const MCP_ID = `mcp:${MCP_ROW}`;
const SKILL_ID = "skill:01JQMZ8K3N4P5Q6R7S8T9VWXY0";

const choices: CapabilityChoice[] = [
  { id: MCP_ID, kind: "mcp", name: "market-data", displayName: "行情数据", disabled: false },
  { id: SKILL_ID, kind: "skill", name: "research", displayName: "研究", disabled: true },
];

describe("assignment drafts", () => {
  it("sends only the all-members key when all members is checked", () => {
    // 叠加部门/个人不会让范围变小，只会在取消全员后留下没人记得勾过的残留分配。
    expect(
      toAssignmentKeys({ allMembers: true, deptIds: ["d1"], groupIds: ["g1"], userIds: ["u1"] }),
    ).toEqual([ALL_MEMBERS_ASSIGNMENT_KEY]);
  });

  it("prefixes departments and groups but leaves user ids bare, matching the portal", () => {
    expect(
      toAssignmentKeys({ allMembers: false, deptIds: ["d1"], groupIds: ["g1"], userIds: ["u1"] }),
    ).toEqual(["dept:d1", "group:g1", "u1"]);
  });

  it("round-trips a stored key list back into checkboxes", () => {
    expect(fromAssignmentKeys(["dept:d1", "group:g1", "u1", "all"])).toEqual({
      allMembers: true,
      deptIds: ["d1"],
      groupIds: ["g1"],
      userIds: ["u1"],
    });
  });

  it("drops blank entries instead of writing an empty assignment key", () => {
    expect(
      toAssignmentKeys({ allMembers: false, deptIds: ["  "], groupIds: [""], userIds: [""] }),
    ).toEqual([]);
  });
});

describe("capability ids", () => {
  it("builds ids from the row primary key, never from a name", () => {
    expect(mcpCapabilityId(MCP_ROW)).toBe(MCP_ID);
  });

  it("refuses a non-ULID row id rather than storing an id nothing can resolve", () => {
    expect(() => mcpCapabilityId("market-data")).toThrow();
  });
});

describe("member diagnostics", () => {
  it("reports a member whose underlying row no longer exists", () => {
    // 界面上这条什么都不显示，不标出来管理员会以为包里就剩下的那些。
    expect(danglingCapabilityIds([MCP_ID, "mcp:01JQMZ8K3N4P5Q6R7S8T9VWXY1"], choices)).toEqual([
      "mcp:01JQMZ8K3N4P5Q6R7S8T9VWXY1",
    ]);
  });

  it("reports a member that is disabled, since employees will not receive it", () => {
    expect(disabledMemberIds([MCP_ID, SKILL_ID], choices)).toEqual([SKILL_ID]);
  });

  it("falls back to the raw id when labelling an unknown capability", () => {
    expect(capabilityLabel("mcp:01JQMZ8K3N4P5Q6R7S8T9VWXY1", choices)).toBe(
      "mcp:01JQMZ8K3N4P5Q6R7S8T9VWXY1",
    );
  });

  it("groups choices so the picker can show MCP and Skill separately", () => {
    const grouped = groupCapabilityChoices(choices);
    expect(grouped.mcp.map((i) => i.id)).toEqual([MCP_ID]);
    expect(grouped.skill.map((i) => i.id)).toEqual([SKILL_ID]);
  });
});
