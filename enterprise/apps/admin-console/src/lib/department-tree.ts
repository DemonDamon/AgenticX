/**
 * 部门树上那几条纯规则。
 *
 * 单独拆出来是因为它们是「点下去会不会把组织结构改坏」的判断，而这类判断在界面里
 * 手测一遍很难覆盖全：把一个部门移到自己的子孙下面，树会从主干上整个断掉，那批人
 * 之后在任何一棵树里都找不到。
 */

export type DepartmentNode = {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  memberCount: number;
};

/** 父 → 子。父 id 指向一个不存在的节点时当作顶级，免得整棵子树在界面上消失。 */
export function childrenByParent(
  nodes: readonly DepartmentNode[],
): Map<string | null, DepartmentNode[]> {
  const map = new Map<string | null, DepartmentNode[]>();
  const ids = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    const parent = node.parentId && ids.has(node.parentId) ? node.parentId : null;
    const siblings = map.get(parent) ?? [];
    siblings.push(node);
    map.set(parent, siblings);
  }
  for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return map;
}

/**
 * 选中一个部门时，子部门的人也要算进来。
 *
 * 管理员点「研发中心」想看的是研发中心所有人，不是只有直挂在这一层的那几个——
 * 按部门树管人的时候，父节点天然代表整棵子树。
 */
export function departmentSubtreeIds(
  nodes: readonly DepartmentNode[],
  rootId: string,
): Set<string> {
  const children = childrenByParent(nodes);
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || out.has(current)) continue;
    out.add(current);
    for (const child of children.get(current) ?? []) stack.push(child.id);
  }
  return out;
}

/**
 * 「移动到哪个部门下」可以选的目标。
 *
 * 自己和自己的子孙都不能选：把 A 移到 A 的子部门下，这一支就从树上脱开成一个环，
 * 界面上的表现是那批人凭空消失。后端会不会拦另说，界面先不该给出这个选项。
 */
export function movableParentOptions(
  nodes: readonly DepartmentNode[],
  movingId: string,
): DepartmentNode[] {
  const forbidden = departmentSubtreeIds(nodes, movingId);
  return nodes
    .filter((node) => !forbidden.has(node.id))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** 删不掉时后端回的是错误码，给管理员一句能照着做的话。 */
export function deleteBlockedReason(message: string): string | null {
  if (message === "dept_has_children") return "这个部门下面还有子部门，先把子部门移走或删掉。";
  if (message === "dept_has_members") return "这个部门里还有人，先把成员调到别的部门。";
  return null;
}
