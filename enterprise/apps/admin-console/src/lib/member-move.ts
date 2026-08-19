/**
 * 批量调部门的纯逻辑。
 *
 * 「把人换个部门」原本只能一个一个点开详情改。选中一批人之后当场移走，是成员页
 * 唯一还缺的批量动作——组织树能建能删能改，人却搬不动。
 */

export type MovableMember = {
  id: string;
  displayName: string;
  /** null 表示未归属组织。 */
  deptId: string | null;
};

export type MovePlan = {
  /** 真的要发请求的那些。 */
  move: MovableMember[];
  /** 已经在目标部门里的。 */
  alreadyThere: MovableMember[];
};

/**
 * 已经在目标部门里的人不发请求，也不计入「已移动 N 人」。
 *
 * 差别不是省几个请求：把 5 个人拖到他们本来就在的部门，回一句「已移动 5 人」是在
 * 撒谎——管理员会以为刚才那一下改变了什么。
 */
export function planMove(
  members: readonly MovableMember[],
  targetDeptId: string | null,
): MovePlan {
  const move: MovableMember[] = [];
  const alreadyThere: MovableMember[] = [];
  for (const member of members) {
    if ((member.deptId ?? null) === targetDeptId) alreadyThere.push(member);
    else move.push(member);
  }
  return { move, alreadyThere };
}

/**
 * 结果播报。部分失败必须说出是谁——批量接口没有事务，失败的那几个还留在原部门，
 * 只说「3 人失败」管理员得自己回去一个个比对。
 */
export function moveResultText(
  targetName: string,
  moved: number,
  alreadyThere: number,
  failed: readonly string[],
): string {
  const parts: string[] = [];
  if (moved > 0) parts.push(`已把 ${moved} 人移到「${targetName}」`);
  if (alreadyThere > 0) parts.push(`${alreadyThere} 人本来就在这里`);
  if (failed.length > 0) {
    const names = failed.slice(0, 3).join("、");
    parts.push(`${failed.length} 人未成功：${names}${failed.length > 3 ? " 等" : ""}`);
  }
  return parts.length > 0 ? parts.join("；") : "没有需要移动的人";
}

/** 拖拽载荷的 MIME。用私有类型，避免把文本拖进来的时候误判成一次成员拖动。 */
export const MEMBER_DRAG_MIME = "application/x-agenticx-member-ids";

/**
 * 拖动哪些人：拖的这个人在选中集合里，就带上整个选中集合；不在，就只拖他自己。
 *
 * 反过来（永远只拖一个 / 永远拖整个选中集合）都会让人失手：前者让勾选形同虚设，
 * 后者会在勾了 8 个人之后，因为顺手拖了第 9 个而把 9 个人一起搬走。
 */
export function dragPayloadIds(
  draggedId: string,
  selectedIds: readonly string[],
): string[] {
  return selectedIds.includes(draggedId) ? [...selectedIds] : [draggedId];
}

/** 从 dataTransfer 里读回 id 列表。任何解析失败都当作「不是我们的拖动」。 */
export function parseDragPayload(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string" && value !== "");
  } catch {
    return [];
  }
}
