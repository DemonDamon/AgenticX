/** 从叶到根挑第一个仍在可见集合内的部门默认模型。与 admin-console 同逻辑。 */
export function resolveDeptDefaultModel(input: {
  effectiveModelIds: readonly string[];
  defaultsLeafToRoot: readonly (string | null | undefined)[];
}): string | null {
  const allowed = new Set(input.effectiveModelIds);
  for (const raw of input.defaultsLeafToRoot) {
    const id = raw?.trim() ?? "";
    if (id && allowed.has(id)) return id;
  }
  return null;
}
