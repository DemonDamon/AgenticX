import { departments, organizations, users } from "@agenticx/db-schema";
import { and, asc, desc, eq, inArray, isNull, like, ne, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { getIamDb, type IamDb } from "../db";
import { insertAuditEvent } from "./audit";

export type DepartmentRow = {
  id: string;
  tenantId: string;
  orgId: string;
  parentId: string | null;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  memberCount?: number;
  children?: DepartmentRow[];
};

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

export async function getDefaultOrgId(tenantId: string): Promise<string | null> {
  const db = getIamDb();
  const row = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.tenantId, tenantId))
    .orderBy(organizations.createdAt)
    .limit(1);
  return row[0]?.id ?? null;
}

async function memberCountsByDept(tenantId: string): Promise<Map<string, number>> {
  const db = getIamDb();
  const rows = await db
    .select({
      deptId: users.deptId,
      c: sql<number>`count(*)::int`,
    })
    .from(users)
    .where(
      and(
        eq(users.tenantId, tenantId),
        eq(users.isDeleted, false),
        isNull(users.deletedAt),
        sql`${users.deptId} is not null`
      )
    )
    .groupBy(users.deptId);
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.deptId) m.set(r.deptId, r.c);
  }
  return m;
}

export async function listDepartmentsFlat(tenantId: string): Promise<DepartmentRow[]> {
  const db = getIamDb();
  const rows = await db
    .select()
    .from(departments)
    .where(eq(departments.tenantId, tenantId))
    .orderBy(asc(departments.path));
  const counts = await memberCountsByDept(tenantId);
  return rows.map((r) => ({ ...mapRow(r), memberCount: counts.get(r.id) ?? 0 }));
}

export async function listDepartmentsTree(tenantId: string): Promise<DepartmentRow[]> {
  const flat = await listDepartmentsFlat(tenantId);
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
  const roots = (byParent.get(null) ?? []).map(attachChildren).sort((a, b) => a.name.localeCompare(b.name));
  return roots;
}

export async function getDepartment(tenantId: string, id: string): Promise<DepartmentRow | null> {
  const db = getIamDb();
  const row = await db
    .select()
    .from(departments)
    .where(and(eq(departments.tenantId, tenantId), eq(departments.id, id)))
    .limit(1);
  if (!row[0]) return null;
  const counts = await memberCountsByDept(tenantId);
  return { ...mapRow(row[0]), memberCount: counts.get(row[0].id) ?? 0 };
}

export async function createDepartment(input: {
  tenantId: string;
  orgId: string;
  name: string;
  parentId?: string | null;
  actorUserId?: string | null;
}): Promise<DepartmentRow> {
  const db = getIamDb();
  const name = input.name.trim();
  if (!name) throw new Error("部门名称不能为空");

  let parentPath = "";
  let parentId: string | null = input.parentId ?? null;
  if (parentId) {
    const parent = await getDepartment(input.tenantId, parentId);
    if (!parent) throw new Error("父部门不存在");
    parentPath = parent.path;
  }
  const path = parentPath === "" ? `/${name}/` : `${parentPath.replace(/\/$/, "")}/${name}/`;

  const exists = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.tenantId, input.tenantId), eq(departments.path, path)))
    .limit(1);
  if (exists[0]) throw new Error("同路径部门已存在");

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

  await insertAuditEvent({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    eventType: "iam.dept.create",
    targetKind: "dept",
    targetId: id,
    detail: { name, path, parentId },
  });

  const created = await getDepartment(input.tenantId, id);
  return created!;
}

export async function updateDepartmentName(input: {
  tenantId: string;
  id: string;
  name: string;
  actorUserId?: string | null;
}): Promise<DepartmentRow> {
  const db = getIamDb();
  const name = input.name.trim();
  if (!name) throw new Error("部门名称不能为空");
  const current = await getDepartment(input.tenantId, input.id);
  if (!current) throw new Error("部门不存在");

  const oldPath = current.path;
  const parentPath =
    current.parentId === null ? "" : (await getDepartment(input.tenantId, current.parentId))?.path.replace(/\/$/, "") ?? "";
  const newPath = current.parentId === null ? `/${name}/` : `${parentPath}/${name}/`;

  await db.transaction(async (tx) => {
    await tx
      .update(departments)
      .set({ name, path: newPath, updatedAt: new Date() })
      .where(and(eq(departments.tenantId, input.tenantId), eq(departments.id, input.id)));

    const descend = await tx
      .select({ id: departments.id, path: departments.path })
      .from(departments)
      .where(and(eq(departments.tenantId, input.tenantId), like(departments.path, `${oldPath}%`), ne(departments.id, input.id)));

    for (const d of descend) {
      if (!d.path.startsWith(oldPath)) continue;
      const suffix = d.path.slice(oldPath.length);
      const nextPath = `${newPath.replace(/\/$/, "")}/${suffix.replace(/^\//, "")}`;
      await tx
        .update(departments)
        .set({ path: nextPath.endsWith("/") ? nextPath : `${nextPath}/`, updatedAt: new Date() })
        .where(and(eq(departments.tenantId, input.tenantId), eq(departments.id, d.id)));
    }
  });

  await insertAuditEvent({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    eventType: "iam.dept.update",
    targetKind: "dept",
    targetId: input.id,
    detail: { before: { name: current.name, path: oldPath }, after: { name, path: newPath } },
  });

  return (await getDepartment(input.tenantId, input.id))!;
}

/** 移动部门到新的父节点下（不能移入自身子树） */
export async function moveDepartment(input: {
  tenantId: string;
  id: string;
  newParentId: string | null;
  actorUserId?: string | null;
}): Promise<DepartmentRow> {
  const db = getIamDb();
  const current = await getDepartment(input.tenantId, input.id);
  if (!current) throw new Error("部门不存在");
  if (input.newParentId === input.id) throw new Error("不能将部门设为自己的子节点");

  if (input.newParentId) {
    const allDesc = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.tenantId, input.tenantId), like(departments.path, `${current.path}%`)));
    const descIds = new Set(allDesc.map((r) => r.id));
    if (descIds.has(input.newParentId)) throw new Error("不能移动到子部门下");
  }

  const newParent = input.newParentId ? await getDepartment(input.tenantId, input.newParentId) : null;
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
      .where(and(eq(departments.tenantId, input.tenantId), like(departments.path, `${oldPath}%`), ne(departments.id, input.id)));

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

  await insertAuditEvent({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    eventType: "iam.dept.move",
    targetKind: "dept",
    targetId: input.id,
    detail: { oldPath, newPath, newParentId: input.newParentId },
  });

  return (await getDepartment(input.tenantId, input.id))!;
}

export async function deleteDepartment(input: {
  tenantId: string;
  id: string;
  actorUserId?: string | null;
}): Promise<void> {
  const db = getIamDb();
  const current = await getDepartment(input.tenantId, input.id);
  if (!current) throw new Error("部门不存在");

  const children = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.tenantId, input.tenantId), eq(departments.parentId, input.id)))
    .limit(1);
  if (children[0]) {
    const err = new Error("dept_has_children");
    (err as Error & { code?: string }).code = "409";
    throw err;
  }

  const members = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.tenantId, input.tenantId),
        eq(users.deptId, input.id),
        eq(users.isDeleted, false),
        isNull(users.deletedAt)
      )
    )
    .limit(1);
  if (members[0]) {
    const err = new Error("dept_has_members");
    (err as Error & { code?: string }).code = "409";
    throw err;
  }

  await db.delete(departments).where(and(eq(departments.tenantId, input.tenantId), eq(departments.id, input.id)));

  await insertAuditEvent({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    eventType: "iam.dept.delete",
    targetKind: "dept",
    targetId: input.id,
    detail: { path: current.path, name: current.name },
  });
}

function normalizePathSegments(raw: string): string[] {
  return raw
    .split(/\/+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 按路径查找或创建部门链；path 如 "总部/研发/前端" 或 "/总部/研发/"
 * 传入 `tx` 时与调用方共用事务，不写嵌套 transaction。
 */
export async function findOrCreateDepartmentPath(input: {
  tenantId: string;
  orgId: string;
  path: string;
  actorUserId?: string | null;
  tx?: IamDb;
}): Promise<{ leafDeptId: string; created: string[] }> {
  const segments = normalizePathSegments(input.path);
  if (!segments.length) throw new Error("部门路径为空");

  const runInTx = async (tx: IamDb) => {
    const created: string[] = [];
    let parentId: string | null = null;
    let accPath = "";

    for (const seg of segments) {
      const nextPath: string =
        parentId === null && accPath === "" ? `/${seg}/` : `${accPath.replace(/\/$/, "")}/${seg}/`;
      const existing = await tx
        .select()
        .from(departments)
        .where(and(eq(departments.tenantId, input.tenantId), eq(departments.path, nextPath)))
        .limit(1);
      if (existing[0]) {
        parentId = existing[0].id;
        accPath = nextPath;
        continue;
      }
      const id = ulid();
      const now = new Date();
      await tx.insert(departments).values({
        id,
        tenantId: input.tenantId,
        orgId: input.orgId,
        parentId,
        name: seg,
        path: nextPath,
        createdAt: now,
        updatedAt: now,
      });
      created.push(nextPath);
      parentId = id;
      accPath = nextPath;
    }

    if (!parentId) throw new Error("部门创建失败");

    if (created.length) {
      await insertAuditEvent(
        {
          tenantId: input.tenantId,
          actorUserId: input.actorUserId ?? null,
          eventType: "iam.bulk_import.dept_autocreate",
          targetKind: "bulk_import",
          detail: { paths: created },
        },
        tx
      );
    }

    return { leafDeptId: parentId, created };
  };

  if (input.tx) {
    return runInTx(input.tx);
  }

  const db = getIamDb();
  let out!: { leafDeptId: string; created: string[] };
  await db.transaction(async (tx) => {
    out = await runInTx(tx);
  });
  return out;
}

/** 返回某部门及其子部门 id 列表（含自身） */
export async function listDepartmentSubtreeIds(tenantId: string, deptId: string): Promise<string[]> {
  const db = getIamDb();
  const self = await getDepartment(tenantId, deptId);
  if (!self) return [];
  const base = self.path;
  const rows = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.tenantId, tenantId), like(departments.path, `${base}%`)));
  return rows.map((r) => r.id);
}
