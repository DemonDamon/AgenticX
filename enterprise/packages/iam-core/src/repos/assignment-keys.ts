/**
 * **唯一一处**分配键解析。
 *
 * 可见模型、能力包、功能开关此前各自拼一遍「这个人算哪些 key」，网关那边还有第四份。
 * 拼得不一样就会出现「后台说他有、真去用被拒」这种最难查的故障，所以这里收成一个
 * 函数，各处只管拿到键集合之后查自己的表。
 *
 * 这个文件原本还带着 enterprise_feature_assignments 的读写。联网搜索和深度研究并入
 * 能力包（`feature:web_search` / `feature:deep_research`）之后，那张表没有任何运行时
 * 再查了，表和读写一起删了 —— 见 drizzle/0058、drizzle-mysql/0032。
 */

import { listDepartmentAncestorIds } from "./departments";
import { groupAssignmentKey, listUserGroupIdsForUser } from "./user-groups";

/** 分配给全员的固定 key。 */
export const ALL_MEMBERS_ASSIGNMENT_KEY = "all";
export const DEPT_ASSIGNMENT_PREFIX = "dept:";

export function deptAssignmentKey(deptId: string): string {
  return `${DEPT_ASSIGNMENT_PREFIX}${String(deptId ?? "").trim()}`;
}

/**
 * 一个用户名下所有生效的分配键：全员 + 本人 + 邮箱 + 部门链到根 + 所属用户组。
 *
 * 部门链从直属取到根——上级分配的东西，下级成员同样拿得到。用户组取并集——属于
 * 多个组只会多拿，不会少拿。
 */
export async function resolveAssignmentKeysForUser(
  tenantId: string,
  userId: string,
  email?: string,
  deptId?: string | null,
): Promise<string[]> {
  const keys = new Set<string>([ALL_MEMBERS_ASSIGNMENT_KEY]);
  const id = String(userId ?? "").trim();
  if (id) keys.add(id);
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  if (normalizedEmail) keys.add(`email:${normalizedEmail}`);
  if (deptId) {
    for (const ancestor of await listDepartmentAncestorIds(tenantId, deptId)) {
      keys.add(deptAssignmentKey(ancestor));
    }
  }
  // 组表尚未建好的租户不该因此失去访问，只是没有组维度的分配。
  const groupIds = await listUserGroupIdsForUser(tenantId, id).catch(() => [] as string[]);
  for (const groupId of groupIds) keys.add(groupAssignmentKey(groupId));
  return [...keys];
}
