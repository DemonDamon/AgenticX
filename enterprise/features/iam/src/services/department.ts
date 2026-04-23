import type { AuthContext } from "@agenticx/auth";
import { assertTenantScope } from "../middleware/rbac";
import type { Department, DepartmentTreeNode, UpsertDepartmentInput } from "../types";
import { upsertDepartmentSchema } from "../types";

function now(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildPath(name: string, parentPath?: string): string {
  const normalized = name.trim().replace(/\//g, "-");
  return `${parentPath ?? "/"}${normalized}/`;
}

export class DepartmentService {
  private readonly departments = new Map<string, Department>();

  public async upsert(auth: AuthContext, input: UpsertDepartmentInput): Promise<Department> {
    const parsed = upsertDepartmentSchema.parse(input);
    assertTenantScope(auth, parsed.tenantId, ["dept:create"]);

    const parent = parsed.parentId ? this.departments.get(parsed.parentId) : null;
    if (parsed.parentId && !parent) throw new Error("Parent department not found.");
    if (parent && parent.tenantId !== parsed.tenantId) throw new Error("Parent tenant mismatch.");

    const id = parsed.id ?? makeId("dept");
    const existing = this.departments.get(id);
    const path = buildPath(parsed.name, parent?.path);
    const department: Department = {
      id,
      tenantId: parsed.tenantId,
      parentId: parsed.parentId ?? null,
      name: parsed.name,
      path,
      memberCount: existing?.memberCount ?? 0,
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
    };

    this.departments.set(id, department);
    return department;
  }

  public async remove(auth: AuthContext, tenantId: string, departmentId: string): Promise<void> {
    assertTenantScope(auth, tenantId, ["dept:delete"]);
    const node = this.departments.get(departmentId);
    if (!node || node.tenantId !== tenantId) throw new Error("Department not found.");

    for (const department of this.departments.values()) {
      if (department.parentId === departmentId && department.tenantId === tenantId) {
        throw new Error("Department has child nodes.");
      }
    }

    this.departments.delete(departmentId);
  }

  public async assignMemberCount(auth: AuthContext, tenantId: string, departmentId: string, memberCount: number): Promise<void> {
    assertTenantScope(auth, tenantId, ["dept:update"]);
    const node = this.departments.get(departmentId);
    if (!node || node.tenantId !== tenantId) throw new Error("Department not found.");
    this.departments.set(departmentId, {
      ...node,
      memberCount,
      updatedAt: now(),
    });
  }

  public async listTree(auth: AuthContext, tenantId: string): Promise<DepartmentTreeNode[]> {
    assertTenantScope(auth, tenantId, ["dept:read"]);

    const scoped = [...this.departments.values()].filter((department) => department.tenantId === tenantId);
    const byParent = new Map<string, Department[]>();
    for (const department of scoped) {
      const key = department.parentId ?? "__root__";
      const list = byParent.get(key) ?? [];
      list.push(department);
      byParent.set(key, list);
    }

    const toTree = (parentId: string | null): DepartmentTreeNode[] => {
      const children = byParent.get(parentId ?? "__root__") ?? [];
      return children
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((department) => ({
          ...department,
          children: toTree(department.id),
        }));
    };

    return toTree(null);
  }
}

