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

/**
 * 可见模型的解析规则，一共三条，各管一个方向：
 *
 *   1. 部门是**上限**：从根到叶逐级收窄，下级只能更严。
 *   2. 分配是**授予**：个人 key、邮箱 key、所属用户组的 key 取并集，再被上限夹住。
 *   3. 个人只能**关**：最后从结果里减掉本人关掉的。
 *
 * 之前用户组走的是另一条路（配额 JSON 里的 groups[].modelIds），结果是同一个「个人
 * 可见模型」勾选框，在这个人不在组里时是收窄、在组里时变成加法。两种相反的含义共用
 * 一个界面，谁也说不清自己勾的是什么。现在组和个人一样只是一个分配 key。
 */

/**
 * 个人 key 与所属用户组 key 的并集，即「分配给这个人的模型」。
 *
 * 两边都没配过时返回 null，表示未配置——未配置继承部门全集，而不是"配了个空集"。
 * 这两件事必须区分开：空集是"什么都不给"，null 是"没意见"。
 */
export function mergeAssignedModelIds(
  personalModelIds: readonly string[] | null,
  groupModelIds: readonly string[],
): string[] | null {
  if (personalModelIds === null && groupModelIds.length === 0) return null;
  return [...new Set([...(personalModelIds ?? []), ...groupModelIds])];
}

export function computeEffectiveUserAllowed(
  deptEffective: readonly string[],
  assignedModelIds: readonly string[] | null,
  optedOutModelIds: readonly string[] = [],
): string[] {
  const deptSet = new Set(deptEffective);
  // null = 个人与所属组都没配过，继承部门的全集。
  const effective = assignedModelIds === null ? deptSet : intersectSets(deptSet, assignedModelIds);
  for (const modelId of optedOutModelIds) effective.delete(modelId);
  return [...effective];
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
