import { departments, organizations, users } from "@agenticx/db-schema/mysql";
import { and, asc, eq, isNull, like, ne, sql } from "drizzle-orm";
import { ulid } from "ulid";

import type { DepartmentRow } from "../departments";
import type { DepartmentsRepository } from "../contracts";
import { insertMysqlAuditEvent } from "./audit";
import { getMysqlRepositoryDb } from "./db";

function mapRow(r: typeof departments.$inferSelect): DepartmentRow {
  return {
    id: r.id,
    tenantId: r.tenantId,
    orgId: r.orgId,
    parentId: r.parentId,
    name: r.name,
    path: r.path,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

async function memberCountsByDept(tenantId: string): Promise<Map<string, number>> {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select({
      deptId: users.deptId,
      c: sql<number>`cast(count(*) as signed)`,
    })
    .from(users)
    .where(
      and(
        eq(users.tenantId, tenantId),
        eq(users.isDeleted, false),
        isNull(users.deletedAt),
        sql`${users.deptId} is not null`,
      ),
    )
    .groupBy(users.deptId);
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.deptId) m.set(r.deptId, r.c);
  }
  return m;
}

async function getDepartmentInternal(tenantId: string, id: string): Promise<DepartmentRow | null> {
  const db = await getMysqlRepositoryDb();
  const [row] = await db
    .select()
    .from(departments)
    .where(and(eq(departments.tenantId, tenantId), eq(departments.id, id)))
    .limit(1);
  if (!row) return null;
  const counts = await memberCountsByDept(tenantId);
  return { ...mapRow(row), memberCount: counts.get(row.id) ?? 0 };
}

export const mysqlDepartmentsRepository: DepartmentsRepository = {
  dialect: "mysql",
  async getDefaultOrgId(tenantId) {
    const db = await getMysqlRepositoryDb();
    const [row] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.tenantId, tenantId))
      .orderBy(organizations.createdAt)
      .limit(1);
    return row?.id ?? null;
  },
  async listDepartmentsFlat(tenantId) {
    const db = await getMysqlRepositoryDb();
    const rows = await db
      .select()
      .from(departments)
      .where(eq(departments.tenantId, tenantId))
      .orderBy(asc(departments.path));
    const counts = await memberCountsByDept(tenantId);
    return rows.map((r) => ({ ...mapRow(r), memberCount: counts.get(r.id) ?? 0 }));
  },
  async listDepartmentsTree(tenantId) {
    const flat = await mysqlDepartmentsRepository.listDepartmentsFlat(tenantId);
    const byParent = new Map<string | null, DepartmentRow[]>();
    for (const d of flat) {
      const key = d.parentId;
      const list = byParent.get(key) ?? [];
      list.push({ ...d, children: [] });
      byParent.set(key, list);
    }
    function attachChildren(node: DepartmentRow): DepartmentRow {
      const kids = byParent.get(node.id) ?? [];
      return {
        ...node,
        children: kids.map(attachChildren).sort((a, b) => a.name.localeCompare(b.name)),
      };
    }
    return (byParent.get(null) ?? []).map(attachChildren).sort((a, b) => a.name.localeCompare(b.name));
  },
  getDepartment: getDepartmentInternal,
  async createDepartment(input) {
    const name = input.name.trim();
    if (!name) throw new Error("部门名称不能为空");

    let parentPath = "";
    const parentId: string | null = input.parentId ?? null;
    if (parentId) {
      const parent = await getDepartmentInternal(input.tenantId, parentId);
      if (!parent) throw new Error("父部门不存在");
      parentPath = parent.path;
    }
    const path = parentPath === "" ? `/${name}/` : `${parentPath.replace(/\/$/, "")}/${name}/`;

    const db = await getMysqlRepositoryDb();
    const [exists] = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.tenantId, input.tenantId), eq(departments.path, path)))
      .limit(1);
    if (exists) throw new Error("同路径部门已存在");

    const id = ulid();
    const now = new Date();
    await db.insert(departments).values({
      id,
      tenantId: input.tenantId,
      orgId: input.orgId,
      parentId,
      name,
      path,
      createdAt: now,
      updatedAt: now,
    });

    await insertMysqlAuditEvent({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      eventType: "iam.dept.create",
      targetKind: "dept",
      targetId: id,
      detail: { name, path, parentId },
    });

    const created = await getDepartmentInternal(input.tenantId, id);
    if (!created) throw new Error("dept create failed");
    return created;
  },
  async updateDepartmentName(input) {
    const name = input.name.trim();
    if (!name) throw new Error("部门名称不能为空");
    const current = await getDepartmentInternal(input.tenantId, input.id);
    if (!current) throw new Error("部门不存在");

    const oldPath = current.path;
    const parentPath =
      current.parentId === null
        ? ""
        : (await getDepartmentInternal(input.tenantId, current.parentId))?.path.replace(/\/$/, "") ?? "";
    const newPath = current.parentId === null ? `/${name}/` : `${parentPath}/${name}/`;

    const db = await getMysqlRepositoryDb();
    await db.transaction(async (tx) => {
      await tx
        .update(departments)
        .set({ name, path: newPath, updatedAt: new Date() })
        .where(and(eq(departments.tenantId, input.tenantId), eq(departments.id, input.id)));

      const descend = await tx
        .select({ id: departments.id, path: departments.path })
        .from(departments)
        .where(
          and(
            eq(departments.tenantId, input.tenantId),
            like(departments.path, `${oldPath}%`),
            ne(departments.id, input.id),
          ),
        );

      for (const d of descend) {
        if (!d.path.startsWith(oldPath)) continue;
        const suffix = d.path.slice(oldPath.length);
        const nextPath = `${newPath.replace(/\/$/, "")}/${suffix.replace(/^\//, "")}`;
        await tx
          .update(departments)
          .set({
            path: nextPath.endsWith("/") ? nextPath : `${nextPath}/`,
            updatedAt: new Date(),
          })
          .where(and(eq(departments.tenantId, input.tenantId), eq(departments.id, d.id)));
      }
    });

    await insertMysqlAuditEvent({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      eventType: "iam.dept.update",
      targetKind: "dept",
      targetId: input.id,
      detail: { before: { name: current.name, path: oldPath }, after: { name, path: newPath } },
    });

    const updated = await getDepartmentInternal(input.tenantId, input.id);
    if (!updated) throw new Error("dept update failed");
    return updated;
  },
  async moveDepartment(input) {
    const current = await getDepartmentInternal(input.tenantId, input.id);
    if (!current) throw new Error("部门不存在");
    if (input.newParentId === input.id) throw new Error("不能将部门设为自己的子节点");

    const db = await getMysqlRepositoryDb();
    if (input.newParentId) {
      const allDesc = await db
        .select({ id: departments.id })
        .from(departments)
        .where(and(eq(departments.tenantId, input.tenantId), like(departments.path, `${current.path}%`)));
      const descIds = new Set(allDesc.map((r) => r.id));
      if (descIds.has(input.newParentId)) throw new Error("不能移动到子部门下");
    }

    const newParent = input.newParentId
      ? await getDepartmentInternal(input.tenantId, input.newParentId)
      : null;
    if (input.newParentId && !newParent) throw new Error("目标父部门不存在");

    const oldPath = current.path;
    const newPath =
      input.newParentId === null
        ? `/${current.name}/`
        : `${newParent!.path.replace(/\/$/, "")}/${current.name}/`;

    await db.transaction(async (tx) => {
      await tx
        .update(departments)
        .set({
          parentId: input.newParentId,
          path: newPath,
          updatedAt: new Date(),
        })
        .where(and(eq(departments.tenantId, input.tenantId), eq(departments.id, input.id)));

      const descend = await tx
        .select({ id: departments.id, path: departments.path })
        .from(departments)
        .where(
          and(
            eq(departments.tenantId, input.tenantId),
            like(departments.path, `${oldPath}%`),
            ne(departments.id, input.id),
          ),
        );

      for (const d of descend) {
        const suffix = d.path.slice(oldPath.length);
        const merged = `${newPath.replace(/\/$/, "")}/${suffix.replace(/^\//, "")}`;
        const finalPath = merged.endsWith("/") ? merged : `${merged}/`;
        await tx
          .update(departments)
          .set({ path: finalPath, updatedAt: new Date() })
          .where(and(eq(departments.tenantId, input.tenantId), eq(departments.id, d.id)));
      }
    });

    await insertMysqlAuditEvent({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      eventType: "iam.dept.move",
      targetKind: "dept",
      targetId: input.id,
      detail: { oldPath, newPath, newParentId: input.newParentId },
    });

    const moved = await getDepartmentInternal(input.tenantId, input.id);
    if (!moved) throw new Error("dept move failed");
    return moved;
  },
  async deleteDepartment(input) {
    const current = await getDepartmentInternal(input.tenantId, input.id);
    if (!current) throw new Error("部门不存在");

    const db = await getMysqlRepositoryDb();
    const [children] = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.tenantId, input.tenantId), eq(departments.parentId, input.id)))
      .limit(1);
    if (children) {
      const err = new Error("dept_has_children");
      (err as Error & { code?: string }).code = "409";
      throw err;
    }

    const [members] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.tenantId, input.tenantId),
          eq(users.deptId, input.id),
          eq(users.isDeleted, false),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    if (members) {
      const err = new Error("dept_has_members");
      (err as Error & { code?: string }).code = "409";
      throw err;
    }

    await db.delete(departments).where(and(eq(departments.tenantId, input.tenantId), eq(departments.id, input.id)));

    await insertMysqlAuditEvent({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      eventType: "iam.dept.delete",
      targetKind: "dept",
      targetId: input.id,
      detail: { path: current.path, name: current.name },
    });
  },
  async listDepartmentAncestorIds(tenantId, deptId) {
    const ids: string[] = [];
    let currentId: string | null = deptId;
    const seen = new Set<string>();
    while (currentId && !seen.has(currentId)) {
      seen.add(currentId);
      const dept = await getDepartmentInternal(tenantId, currentId);
      if (!dept) break;
      ids.push(dept.id);
      currentId = dept.parentId;
    }
    return ids;
  },
  async listDepartmentSubtreeIds(tenantId, deptId) {
    const self = await getDepartmentInternal(tenantId, deptId);
    if (!self) return [];
    const db = await getMysqlRepositoryDb();
    const rows = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.tenantId, tenantId), like(departments.path, `${self.path}%`)));
    return rows.map((r) => r.id);
  },
};
