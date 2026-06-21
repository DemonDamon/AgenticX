/**
 * 可见模型级联收窄（cascading restriction）纯函数。
 * 父部门配置为上限；子部门/用户只能在父 effective 集合内再筛。
 */

export const DEPT_ASSIGNMENT_PREFIX = "dept:";

export type EffectiveModelsContext = {
  allEnabledIds: readonly string[];
  userVisibleMap: Record<string, string[]>;
  /** 从直属部门到根：[dept, parent, ..., root] */
  ancestorChain: readonly string[];
};

export function deptAssignmentKey(deptId: string): string {
  return `${DEPT_ASSIGNMENT_PREFIX}${deptId}`;
}

export function isScopeConfigured(set: string[] | undefined): boolean {
  return Array.isArray(set) && set.length > 0;
}

export function intersectSets(base: Set<string>, ids: readonly string[]): Set<string> {
  const allowed = new Set(ids);
  const out = new Set<string>();
  for (const id of base) {
    if (allowed.has(id)) out.add(id);
  }
  return out;
}

/** 沿 ancestorChain 从根到叶逐级收窄，返回该部门 effective 集合。 */
export function computeEffectiveDeptAllowed(ctx: EffectiveModelsContext): string[] {
  const all = new Set(ctx.allEnabledIds);
  const rootToLeaf = [...ctx.ancestorChain].reverse();
  let effective = all;
  for (const deptId of rootToLeaf) {
    const configured = ctx.userVisibleMap[deptAssignmentKey(deptId)];
    if (isScopeConfigured(configured)) {
      effective = intersectSets(effective, configured!);
    }
  }
  return [...effective];
}

/** 编辑某部门时，可选上限 = 父级 effective（根部门 = 全部启用）。 */
export function computeParentAllowedIds(
  allEnabledIds: readonly string[],
  userVisibleMap: Record<string, string[]>,
  ancestorChain: readonly string[],
): string[] {
  if (ancestorChain.length <= 1) {
    return [...allEnabledIds];
  }
  return computeEffectiveDeptAllowed({
    allEnabledIds,
    userVisibleMap,
    ancestorChain: ancestorChain.slice(1),
  });
}

export function computePrunedModelIds(stored: readonly string[], allowed: ReadonlySet<string>): string[] {
  return stored.filter((id) => !allowed.has(id));
}

export function clipToAllowed(modelIds: readonly string[], allowed: ReadonlySet<string>): {
  saved: string[];
  prunedModelIds: string[];
} {
  const unique = [...new Set(modelIds.map((m) => m.trim()).filter(Boolean))];
  const prunedModelIds = unique.filter((id) => !allowed.has(id));
  const saved = unique.filter((id) => allowed.has(id));
  return { saved, prunedModelIds };
}

export function collectUserAssignmentKeys(userId: string, email?: string): string[] {
  const keys: string[] = [];
  if (userId) keys.push(userId);
  if (!email) return keys;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return keys;
  keys.push(`email:${normalized}`);
  return keys;
}

/** 合并 user / email 等 key 的已存配置；均未配置则返回 null。 */
export function mergeUserStoredSet(
  userVisibleMap: Record<string, string[]>,
  keys: readonly string[],
): string[] | null {
  const merged = new Set<string>();
  let configured = false;
  for (const key of keys) {
    const set = userVisibleMap[key];
    if (isScopeConfigured(set)) {
      configured = true;
      for (const id of set!) merged.add(id);
    }
  }
  return configured ? [...merged] : null;
}

export function computeEffectiveUserAllowed(
  deptEffective: readonly string[],
  userStored: readonly string[] | null,
): string[] {
  const deptSet = new Set(deptEffective);
  if (userStored === null) return [...deptEffective];
  return [...intersectSets(deptSet, userStored)];
}
