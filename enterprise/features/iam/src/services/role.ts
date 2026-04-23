import type { AuthContext } from "@agenticx/auth";
import { assertTenantScope } from "../middleware/rbac";
import type { IamRole, UpsertRoleInput } from "../types";
import { roleSchema } from "../types";

function now(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const SYSTEM_ROLE_TEMPLATES: Record<string, { name: string; scopes: string[] }> = {
  owner: {
    name: "Owner",
    scopes: ["user:create", "user:read", "user:update", "user:delete", "dept:create", "dept:read", "dept:update", "dept:delete", "role:create", "role:read", "role:update", "role:delete", "audit:read", "metering:read"],
  },
  admin: {
    name: "Admin",
    scopes: ["user:create", "user:read", "user:update", "dept:read", "dept:update", "role:read", "audit:read", "metering:read"],
  },
  member: {
    name: "Member",
    scopes: ["user:read"],
  },
  auditor: {
    name: "Auditor",
    scopes: ["audit:read", "metering:read", "user:read", "dept:read", "role:read"],
  },
};

export class RoleService {
  private readonly roles = new Map<string, IamRole>();
  private readonly bindings = new Map<string, Set<string>>();

  public async bootstrapSystemRoles(tenantId: string): Promise<IamRole[]> {
    const roles: IamRole[] = [];
    for (const [code, template] of Object.entries(SYSTEM_ROLE_TEMPLATES)) {
      const role = await this.upsertSystemRole(tenantId, code, template.name, template.scopes);
      roles.push(role);
    }
    return roles;
  }

  private async upsertSystemRole(tenantId: string, code: string, name: string, scopes: string[]): Promise<IamRole> {
    const key = `${tenantId}:${code}`;
    const existing = this.roles.get(key);
    const role: IamRole = {
      id: existing?.id ?? makeId("role"),
      tenantId,
      code,
      name,
      scopes,
      immutable: true,
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
    };
    this.roles.set(key, role);
    return role;
  }

  public async upsertRole(auth: AuthContext, input: UpsertRoleInput): Promise<IamRole> {
    const parsed = roleSchema.parse(input);
    assertTenantScope(auth, parsed.tenantId, ["role:create"]);
    const key = `${parsed.tenantId}:${parsed.code}`;
    const existing = this.roles.get(key);
    if (existing?.immutable && !parsed.immutable) {
      throw new Error("System role cannot downgrade immutable flag.");
    }

    // 自定义角色 scope 不能超出当前管理员已有 scope。
    const overScoped = parsed.scopes.filter((scope) => !auth.scopes.includes(scope));
    if (overScoped.length > 0 && !auth.scopes.includes("role:super")) {
      throw new Error(`Requested scopes exceed operator permission: ${overScoped.join(", ")}`);
    }

    const role: IamRole = {
      id: existing?.id ?? parsed.id ?? makeId("role"),
      tenantId: parsed.tenantId,
      code: parsed.code,
      name: parsed.name,
      scopes: parsed.scopes,
      immutable: existing?.immutable ?? parsed.immutable ?? false,
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
    };
    this.roles.set(key, role);
    return role;
  }

  public async listRoles(auth: AuthContext): Promise<IamRole[]> {
    assertTenantScope(auth, auth.tenantId, ["role:read"]);
    return [...this.roles.values()].filter((role) => role.tenantId === auth.tenantId);
  }

  public async bindRole(auth: AuthContext, userId: string, roleId: string): Promise<void> {
    assertTenantScope(auth, auth.tenantId, ["role:update"]);
    const role = [...this.roles.values()].find((item) => item.id === roleId && item.tenantId === auth.tenantId);
    if (!role) throw new Error("Role not found.");

    const key = `${auth.tenantId}:${userId}`;
    const set = this.bindings.get(key) ?? new Set<string>();
    set.add(roleId);
    this.bindings.set(key, set);
  }

  public async unbindRole(auth: AuthContext, userId: string, roleId: string): Promise<void> {
    assertTenantScope(auth, auth.tenantId, ["role:update"]);
    const key = `${auth.tenantId}:${userId}`;
    const set = this.bindings.get(key);
    if (!set) return;
    set.delete(roleId);
    this.bindings.set(key, set);
  }
}

