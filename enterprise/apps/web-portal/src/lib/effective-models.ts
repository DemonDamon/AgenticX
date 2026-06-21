/**
 * 可见模型级联收窄（cascading restriction）纯函数 — portal 副本。
 * 与 admin-console/src/lib/effective-models.ts 保持语义一致。
 */

export const DEPT_ASSIGNMENT_PREFIX = "dept:";

export type EffectiveModelsContext = {
  allEnabledIds: readonly string[];
  userVisibleMap: Record<string, string[]>;
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

export function collectUserAssignmentKeys(userId: string, email?: string): string[] {
  const keys: string[] = [];
  if (userId) keys.push(userId);
  if (!email) return keys;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return keys;
  keys.push(`email:${normalized}`);
  return keys;
}
