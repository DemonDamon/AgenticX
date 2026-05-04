/**
 * 集中维护 admin / portal 可授予的 scope 清单。
 * 角色表存 string[]；支持特殊值 "*" 表示该角色拥有全部注册 scope。
 */
export const SCOPE_REGISTRY: Record<string, readonly string[]> = {
  admin: ["enter"],
  user: ["read", "create", "update", "delete", "manage"],
  dept: ["read", "create", "update", "delete", "manage"],
  role: ["read", "create", "update", "delete", "manage"],
  audit: ["read", "read:all", "read:dept", "export", "manage"],
  metering: ["read", "export", "manage"],
  workspace: ["read", "chat", "manage"],
  policy: ["read", "create", "update", "delete", "manage"],
  model: ["read", "create", "update", "delete", "manage"],
  kb: ["read", "create", "update", "delete", "manage"],
  automation: ["read", "create", "update", "delete", "manage"],
  gateway: ["read", "manage"],
  provider: ["read", "create", "update", "delete", "manage"],
} as const;

export const ALL_REGISTERED_SCOPES: string[] = Object.entries(SCOPE_REGISTRY).flatMap(([resource, verbs]) =>
  verbs.map((v) => `${resource}:${v}`)
);

export function isRegisteredScope(scope: string): boolean {
  return scope === "*" || ALL_REGISTERED_SCOPES.includes(scope);
}

/** 展开角色 scopes（含 "*" → 全部注册 scope） */
export function expandRoleScopes(scopes: string[] | null | undefined): string[] {
  if (!scopes?.length) return [];
  if (scopes.includes("*")) return [...ALL_REGISTERED_SCOPES];
  return [...new Set(scopes.filter((s) => typeof s === "string" && isRegisteredScope(s)))];
}

/** 用户最终权限 = 多角色 scopes 去重并展开 */
export function mergeUserScopes(rawScopes: string[][]): string[] {
  const merged = rawScopes.flatMap((arr) => expandRoleScopes(arr));
  return [...new Set(merged)];
}

export function hasEveryScope(userScopes: string[], required: string[]): boolean {
  const set = new Set(expandRoleScopes(userScopes));
  if (set.has("*")) return true;
  return required.every((s) => set.has(s));
}

export function hasSomeScope(userScopes: string[], candidates: string[]): boolean {
  const set = new Set(expandRoleScopes(userScopes));
  if (set.has("*")) return true;
  return candidates.some((s) => set.has(s));
}
