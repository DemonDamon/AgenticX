export type SharedPoolScopeType = "tenant" | "dept";

/** 用户套餐不进入部门或租户共享池。调用方必须先排除 user。 */
export function poolScopeForAssignment(
  scopeType: SharedPoolScopeType,
  tenant: string,
  scopeId: string,
): { scopeType: SharedPoolScopeType; scopeId: string } {
  if (scopeType === "dept") return { scopeType: "dept", scopeId };
  return { scopeType: "tenant", scopeId: tenant };
}
