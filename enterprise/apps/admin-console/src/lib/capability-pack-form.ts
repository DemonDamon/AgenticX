/**
 * 能力包管理界面的取值逻辑。
 *
 * 抽出来是因为这里的规则不是显示细节：分配范围一旦选了「全员」，再叠加部门和个人
 * 就只会让人误以为范围变小了；能力 id 必须由 kind + 行主键拼出来，界面上不该出现
 * 第二种拼法。
 */

import { formatCapabilityId, parseCapabilityId } from "@agenticx/config";

/** 分配给全员的固定 key，与 web-portal 侧同一个约定。 */
export const ALL_MEMBERS_ASSIGNMENT_KEY = "all";
export const DEPT_ASSIGNMENT_PREFIX = "dept:";
export const GROUP_ASSIGNMENT_PREFIX = "group:";

export type CapabilityChoice = {
  /** `mcp:<ulid>` / `skill:<ulid>` */
  id: string;
  kind: "mcp" | "skill" | "feature";
  name: string;
  displayName: string;
  disabled: boolean;
};

export type AssignmentDraft = {
  allMembers: boolean;
  deptIds: string[];
  /** 用户组是**授予**：属于多个组取并集，多一个组只会多一份能力。 */
  groupIds: string[];
  userIds: string[];
};

export function mcpCapabilityId(serverId: string): string {
  return formatCapabilityId("mcp", serverId);
}

export function skillCapabilityId(skillId: string): string {
  return formatCapabilityId("skill", skillId);
}

export function deptAssignmentKey(deptId: string): string {
  return `${DEPT_ASSIGNMENT_PREFIX}${deptId}`;
}

export function groupAssignmentKey(groupId: string): string {
  return `${GROUP_ASSIGNMENT_PREFIX}${groupId}`;
}

/**
 * 勾选状态 → 落库的 assignmentKey 列表。
 *
 * 勾了全员就只发 `all`：再带上部门和个人不会让范围变小，只会在之后取消全员时
 * 留下一批没人记得自己勾过的残留分配。
 */
export function toAssignmentKeys(draft: AssignmentDraft): string[] {
  if (draft.allMembers) return [ALL_MEMBERS_ASSIGNMENT_KEY];
  const keys = new Set<string>();
  for (const deptId of draft.deptIds) {
    const trimmed = deptId.trim();
    if (trimmed) keys.add(deptAssignmentKey(trimmed));
  }
  for (const groupId of draft.groupIds) {
    const trimmed = groupId.trim();
    if (trimmed) keys.add(groupAssignmentKey(trimmed));
  }
  for (const userId of draft.userIds) {
    const trimmed = userId.trim();
    if (trimmed) keys.add(trimmed);
  }
  return [...keys].sort();
}

/** 落库的 assignmentKey 列表 → 勾选状态。 */
export function fromAssignmentKeys(keys: readonly string[]): AssignmentDraft {
  const draft: AssignmentDraft = { allMembers: false, deptIds: [], groupIds: [], userIds: [] };
  for (const raw of keys) {
    const key = String(raw ?? "").trim();
    if (!key) continue;
    if (key === ALL_MEMBERS_ASSIGNMENT_KEY) {
      draft.allMembers = true;
      continue;
    }
    if (key.startsWith(DEPT_ASSIGNMENT_PREFIX)) {
      draft.deptIds.push(key.slice(DEPT_ASSIGNMENT_PREFIX.length));
      continue;
    }
    if (key.startsWith(GROUP_ASSIGNMENT_PREFIX)) {
      draft.groupIds.push(key.slice(GROUP_ASSIGNMENT_PREFIX.length));
      continue;
    }
    draft.userIds.push(key);
  }
  return draft;
}

/** 能力清单按类型分组，供两栏勾选。 */
export function groupCapabilityChoices(choices: readonly CapabilityChoice[]): {
  mcp: CapabilityChoice[];
  skill: CapabilityChoice[];
  feature: CapabilityChoice[];
} {
  return {
    mcp: choices.filter((item) => item.kind === "mcp"),
    skill: choices.filter((item) => item.kind === "skill"),
    feature: choices.filter((item) => item.kind === "feature"),
  };
}

/**
 * 包里引用了但已经不在可选清单里的能力 id（被删掉的行）。
 *
 * 这类成员在界面上什么都不显示，管理员会以为包里就这些；标出来才知道要清理。
 */
export function danglingCapabilityIds(
  memberIds: readonly string[],
  choices: readonly CapabilityChoice[],
): string[] {
  const known = new Set(choices.map((item) => item.id));
  return [...new Set(memberIds.filter((id) => !known.has(id)))].sort();
}

/** 包引用了一个企业已停用的能力时，员工那边收不到；这里提前说清楚。 */
export function disabledMemberIds(
  memberIds: readonly string[],
  choices: readonly CapabilityChoice[],
): string[] {
  const disabled = new Set(choices.filter((item) => item.disabled).map((item) => item.id));
  return [...new Set(memberIds.filter((id) => disabled.has(id)))].sort();
}

export function capabilityLabel(id: string, choices: readonly CapabilityChoice[]): string {
  const found = choices.find((item) => item.id === id);
  if (found) return found.displayName || found.name;
  const parsed = parseCapabilityId(id);
  return parsed ? `${parsed.kind}:${parsed.rowId}` : id;
}
