/**
 * Read-only admin view of enterprise projects (PostgreSQL and MySQL).
 * Visibility is applied in SQL and again when shaping results.
 *
 * Author: Damon Li
 */

import {
  departments as pgDepartments,
  enterpriseCollabRoomMembers as pgMembers,
  enterpriseCollabRoomMessages as pgMessages,
  enterpriseCollabRooms as pgRooms,
  enterpriseProjects as pgProjects,
  users as pgUsers,
} from "@agenticx/db-schema";
import {
  departments as mysqlDepartments,
  enterpriseCollabRoomMembers as mysqlMembers,
  enterpriseCollabRoomMessages as mysqlMessages,
  enterpriseCollabRooms as mysqlRooms,
  enterpriseProjects as mysqlProjects,
  users as mysqlUsers,
} from "@agenticx/db-schema/mysql";
import { and, asc, eq, gt, inArray, isNull, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { resolveDatabaseConfig } from "../database/config";
import { createMysqlDb, getIamDb } from "../db";

export type AdminProjectRow = {
  id: string;
  name: string;
  owner_user_id: string;
  owner_name: string;
  dept_id: string | null;
  dept_name: string | null;
  member_count: number;
  room_count: number;
  message_count: number;
  last_activity_at: string | null;
  created_at: string;
  archived_at: string | null;
};

export type AdminProjectRoom = {
  id: string;
  title: string;
  room_kind: "main" | "sub" | "direct";
  parent_room_id: string | null;
  member_count: number;
  message_count: number;
  last_seq: number;
};

export type AdminProjectMember = {
  member_type: string;
  member_id: string;
  display_name: string;
  room_role: string;
};

export type AdminProjectMessage = {
  seq: number;
  sender_type: string;
  sender_name: string;
  content: string;
  metadata: unknown;
  created_at: string;
};

export type ProjectVisibility =
  | { mode: "all" }
  | { mode: "dept"; deptId: string }
  | { mode: "self"; userId: string };

export type AdminProjectDetail = {
  project: AdminProjectRow;
  rooms: AdminProjectRoom[];
  members: AdminProjectMember[];
};

export class ProjectForbiddenError extends Error {
  constructor(message = "forbidden") {
    super(message);
    this.name = "ProjectForbiddenError";
  }
}

export class ProjectNotFoundError extends Error {
  constructor(message = "not found") {
    super(message);
    this.name = "ProjectNotFoundError";
  }
}

type VisibilityPlan =
  | { kind: "all" }
  | { kind: "dept"; deptId: string }
  | { kind: "self"; userId: string };

type ProjectColumns = {
  id: AnyColumn;
  tenantId: AnyColumn;
  name: AnyColumn;
  deptId: AnyColumn;
};

type ProjectTables = {
  projects: ProjectColumns & {
    ownerUserId: AnyColumn;
    mainRoomId: AnyColumn;
    createdAt: AnyColumn;
    archivedAt: AnyColumn;
  };
  rooms: {
    id: AnyColumn;
    tenantId: AnyColumn;
    title: AnyColumn;
    projectId: AnyColumn;
    parentRoomId: AnyColumn;
    roomKind: AnyColumn;
  };
  members: {
    roomId: AnyColumn;
    tenantId: AnyColumn;
    memberType: AnyColumn;
    memberId: AnyColumn;
    displayName: AnyColumn;
    roomRole: AnyColumn;
    leftAt: AnyColumn;
  };
  messages: {
    roomId: AnyColumn;
    tenantId: AnyColumn;
    seq: AnyColumn;
    senderType: AnyColumn;
    senderName: AnyColumn;
    content: AnyColumn;
    metadata: AnyColumn;
    createdAt: AnyColumn;
  };
  users: { id: AnyColumn; displayName: AnyColumn };
  departments: { id: AnyColumn; name: AnyColumn };
};

type QueryChain = {
  from: (table: unknown) => QueryChain;
  leftJoin: (table: unknown, on: SQL) => QueryChain;
  innerJoin: (table: unknown, on: SQL) => QueryChain;
  where: (condition: SQL) => QueryChain;
  orderBy: (...order: unknown[]) => QueryChain;
  limit: (count: number) => QueryChain;
} & PromiseLike<unknown[]>;

type QueryDb = {
  select: (fields: object) => QueryChain;
};

type FixtureProject = AdminProjectRow & { tenant_id: string };
type FixtureRoom = AdminProjectRoom & { tenant_id: string; project_id: string };
type FixtureMember = AdminProjectMember & { tenant_id: string; project_id: string };
type FixtureMessage = AdminProjectMessage & { tenant_id: string; room_id: string };

export type AdminProjectsFixture = {
  projects: FixtureProject[];
  memberships: Array<{ tenant_id: string; project_id: string; user_id: string }>;
  rooms: FixtureRoom[];
  members: FixtureMember[];
  messages: FixtureMessage[];
};

const LISTED_ROOM_KINDS = ["main", "sub", "direct"] as const;

const pgTables: ProjectTables = {
  projects: pgProjects,
  rooms: pgRooms,
  members: pgMembers,
  messages: pgMessages,
  users: pgUsers,
  departments: pgDepartments,
};

const mysqlTables: ProjectTables = {
  projects: mysqlProjects,
  rooms: mysqlRooms,
  members: mysqlMembers,
  messages: mysqlMessages,
  users: mysqlUsers,
  departments: mysqlDepartments,
};

let fixture: AdminProjectsFixture | null = null;

export function __setAdminProjectsFixtureForTests(next: AdminProjectsFixture | null): void {
  fixture = next;
}

function visibilityPlan(vis: ProjectVisibility): VisibilityPlan {
  switch (vis.mode) {
    case "all":
      return { kind: "all" };
    case "dept":
      return { kind: "dept", deptId: vis.deptId };
    case "self":
      return { kind: "self", userId: vis.userId };
    default: {
      const exhaustive: never = vis;
      throw new Error(`unknown project visibility ${JSON.stringify(exhaustive)}`);
    }
  }
}

function projectMatchesVisibility(
  project: { id: string; dept_id: string | null },
  vis: ProjectVisibility,
  memberProjectIds: ReadonlySet<string>,
): boolean {
  const plan = visibilityPlan(vis);
  switch (plan.kind) {
    case "all":
      return true;
    case "dept":
      return project.dept_id === plan.deptId;
    case "self":
      return memberProjectIds.has(project.id);
    default: {
      const exhaustive: never = plan;
      throw new Error(`unknown visibility plan ${JSON.stringify(exhaustive)}`);
    }
  }
}

function directMessagesAllowed(vis: ProjectVisibility): boolean {
  switch (vis.mode) {
    case "all":
      return true;
    case "dept":
    case "self":
      return false;
    default: {
      const exhaustive: never = vis;
      throw new Error(`unknown project visibility ${JSON.stringify(exhaustive)}`);
    }
  }
}

function searchNeedle(q: string | undefined): string {
  return (q ?? "").trim().toLowerCase().replace(/[%_\\]/g, "");
}

function activeHumanMemberExists(projects: { id: AnyColumn; tenantId: AnyColumn }, userId: string): SQL {
  return sql`exists (
    select 1
      from enterprise_collab_rooms r
      join enterprise_collab_room_members m
        on m.room_id = r.id
       and m.left_at is null
       and m.member_type = 'human'
     where r.project_id = ${projects.id}
       and r.tenant_id = ${projects.tenantId}
       and m.member_id = ${userId}
  )`;
}

export function adminProjectScopeSql(
  projects: ProjectColumns,
  tenantId: string,
  vis: ProjectVisibility,
  q?: string,
): SQL {
  const parts: SQL[] = [eq(projects.tenantId, tenantId)];
  const plan = visibilityPlan(vis);
  switch (plan.kind) {
    case "all":
      break;
    case "dept":
      parts.push(eq(projects.deptId, plan.deptId));
      break;
    case "self":
      parts.push(activeHumanMemberExists(projects, plan.userId));
      break;
    default: {
      const exhaustive: never = plan;
      throw new Error(`unknown visibility plan ${JSON.stringify(exhaustive)}`);
    }
  }
  const needle = searchNeedle(q);
  if (needle) parts.push(sql`lower(${projects.name}) like ${`%${needle}%`}`);
  const combined = and(...parts);
  if (!combined) throw new Error("empty project scope");
  return combined;
}

function iso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) return String(value);
  return new Date(parsed).toISOString();
}

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function parseMetadata(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function asRoomKind(value: unknown): AdminProjectRoom["room_kind"] | null {
  switch (value) {
    case "main":
    case "sub":
    case "direct":
      return value;
    default:
      return null;
  }
}

function activityMs(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function compareProjects(a: AdminProjectRow, b: AdminProjectRow): number {
  const byActivity = activityMs(b.last_activity_at) - activityMs(a.last_activity_at);
  if (byActivity !== 0) return byActivity;
  return activityMs(b.created_at) - activityMs(a.created_at);
}

function roleRank(role: string): number {
  switch (role) {
    case "owner":
      return 0;
    case "admin":
      return 1;
    case "member":
      return 2;
    default:
      return 9;
  }
}

function clampPage(filter?: { limit?: number; offset?: number }): { limit: number; offset: number } {
  const limit = Math.min(200, Math.max(1, filter?.limit ?? 50));
  const offset = Math.max(0, filter?.offset ?? 0);
  return { limit, offset };
}

function finalizeProjectList(
  rows: AdminProjectRow[],
  vis: ProjectVisibility,
  memberProjectIds: ReadonlySet<string>,
  filter?: { q?: string; limit?: number; offset?: number },
): { items: AdminProjectRow[]; total: number } {
  const needle = searchNeedle(filter?.q);
  let items = rows.filter((row) => projectMatchesVisibility(row, vis, memberProjectIds));
  if (needle) items = items.filter((row) => row.name.toLowerCase().includes(needle));
  items.sort(compareProjects);
  const { limit, offset } = clampPage(filter);
  return { items: items.slice(offset, offset + limit), total: items.length };
}

function sortRooms(rooms: AdminProjectRoom[]): AdminProjectRoom[] {
  const rank: Record<AdminProjectRoom["room_kind"], number> = { main: 0, sub: 1, direct: 2 };
  return [...rooms].sort((a, b) => rank[a.room_kind] - rank[b.room_kind] || a.title.localeCompare(b.title));
}

function dedupeMembers(rows: AdminProjectMember[]): AdminProjectMember[] {
  const map = new Map<string, AdminProjectMember>();
  for (const row of rows) {
    const key = `${row.member_type}:${row.member_id}`;
    const prev = map.get(key);
    if (!prev || roleRank(row.room_role) < roleRank(prev.room_role)) map.set(key, row);
  }
  return [...map.values()].sort(
    (a, b) => roleRank(a.room_role) - roleRank(b.room_role) || a.display_name.localeCompare(b.display_name),
  );
}

function mapProjectRow(row: Record<string, unknown>): AdminProjectRow {
  const deptId = row.dept_id == null || row.dept_id === "" ? null : String(row.dept_id);
  const deptName = row.dept_name == null || row.dept_name === "" ? null : String(row.dept_name);
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    owner_user_id: String(row.owner_user_id ?? ""),
    owner_name: String(row.owner_name ?? ""),
    dept_id: deptId,
    dept_name: deptName,
    member_count: num(row.member_count),
    room_count: num(row.room_count),
    message_count: num(row.message_count),
    last_activity_at: row.last_activity_at == null ? null : iso(row.last_activity_at as Date | string),
    created_at: iso((row.created_at as Date | string | undefined) ?? new Date(0).toISOString()),
    archived_at: row.archived_at == null ? null : iso(row.archived_at as Date | string),
  };
}

function mapRoomRow(row: Record<string, unknown>): AdminProjectRoom | null {
  const roomKind = asRoomKind(row.room_kind);
  if (!roomKind) return null;
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? ""),
    room_kind: roomKind,
    parent_room_id: row.parent_room_id == null || row.parent_room_id === "" ? null : String(row.parent_room_id),
    member_count: num(row.member_count),
    message_count: num(row.message_count),
    last_seq: num(row.last_seq),
  };
}

function mapMessageRow(row: Record<string, unknown>): AdminProjectMessage {
  return {
    seq: num(row.seq),
    sender_type: String(row.sender_type ?? ""),
    sender_name: String(row.sender_name ?? ""),
    content: String(row.content ?? ""),
    metadata: parseMetadata(row.metadata),
    created_at: iso((row.created_at as Date | string | undefined) ?? new Date(0).toISOString()),
  };
}

function fixtureMemberIds(tenantId: string, vis: ProjectVisibility): Set<string> {
  const plan = visibilityPlan(vis);
  if (plan.kind !== "self" || !fixture) return new Set();
  return new Set(
    fixture.memberships
      .filter((row) => row.tenant_id === tenantId && row.user_id === plan.userId)
      .map((row) => row.project_id),
  );
}

function fixtureProjects(tenantId: string): AdminProjectRow[] {
  if (!fixture) return [];
  return fixture.projects.filter((row) => row.tenant_id === tenantId).map(({ tenant_id: _tenant, ...project }) => project);
}

async function openDb(): Promise<{ db: QueryDb; tables: ProjectTables }> {
  const config = resolveDatabaseConfig();
  switch (config.dialect) {
    case "mysql": {
      const { raw } = await createMysqlDb(config);
      return { db: raw as unknown as QueryDb, tables: mysqlTables };
    }
    case "postgresql":
      return { db: getIamDb() as unknown as QueryDb, tables: pgTables };
    default: {
      const exhaustive: never = config;
      throw new Error(`unsupported database ${JSON.stringify(exhaustive)}`);
    }
  }
}

async function readRows(query: QueryChain): Promise<Record<string, unknown>[]> {
  const rows = await query;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

function projectSelect(tables: ProjectTables) {
  return {
    id: tables.projects.id,
    name: tables.projects.name,
    owner_user_id: tables.projects.ownerUserId,
    owner_name: sql<string>`coalesce(${tables.users.displayName}, '')`,
    dept_id: tables.projects.deptId,
    dept_name: tables.departments.name,
    member_count: sql<number>`(
      select count(*) from enterprise_collab_room_members m
      where m.room_id = ${tables.projects.mainRoomId} and m.left_at is null
    )`,
    room_count: sql<number>`(
      select count(*) from enterprise_collab_rooms r
      where r.project_id = ${tables.projects.id}
        and r.tenant_id = ${tables.projects.tenantId}
        and r.room_kind in ('main', 'sub', 'direct')
    )`,
    message_count: sql<number>`(
      select count(*)
        from enterprise_collab_room_messages g
        join enterprise_collab_rooms r on r.id = g.room_id
       where r.project_id = ${tables.projects.id}
         and r.tenant_id = ${tables.projects.tenantId}
         and r.room_kind in ('main', 'sub', 'direct')
    )`,
    last_activity_at: sql<Date | string | null>`(
      select max(g.created_at)
        from enterprise_collab_room_messages g
        join enterprise_collab_rooms r on r.id = g.room_id
       where r.project_id = ${tables.projects.id}
         and r.tenant_id = ${tables.projects.tenantId}
         and r.room_kind in ('main', 'sub', 'direct')
    )`,
    created_at: tables.projects.createdAt,
    archived_at: tables.projects.archivedAt,
  };
}

async function queryProjectRows(
  tenantId: string,
  vis: ProjectVisibility,
  q?: string,
  projectId?: string,
): Promise<AdminProjectRow[]> {
  const { db, tables } = await openDb();
  const parts = [adminProjectScopeSql(tables.projects, tenantId, vis, q)];
  if (projectId) parts.push(eq(tables.projects.id, projectId));
  const where = and(...parts);
  if (!where) return [];
  const rows = await readRows(
    db
      .select(projectSelect(tables))
      .from(tables.projects)
      .leftJoin(tables.users, eq(tables.users.id, tables.projects.ownerUserId))
      .leftJoin(tables.departments, eq(tables.departments.id, tables.projects.deptId))
      .where(where),
  );
  return rows.map(mapProjectRow);
}

async function queryRooms(tenantId: string, projectId: string): Promise<AdminProjectRoom[]> {
  const { db, tables } = await openDb();
  const where = and(
    eq(tables.rooms.tenantId, tenantId),
    eq(tables.rooms.projectId, projectId),
    inArray(tables.rooms.roomKind, [...LISTED_ROOM_KINDS]),
  );
  if (!where) return [];
  const rows = await readRows(
    db
      .select({
        id: tables.rooms.id,
        title: tables.rooms.title,
        room_kind: tables.rooms.roomKind,
        parent_room_id: tables.rooms.parentRoomId,
        member_count: sql<number>`(
          select count(*) from enterprise_collab_room_members m
          where m.room_id = ${tables.rooms.id} and m.left_at is null
        )`,
        message_count: sql<number>`(
          select count(*) from enterprise_collab_room_messages g
          where g.room_id = ${tables.rooms.id}
        )`,
        last_seq: sql<number>`coalesce((
          select max(g.seq) from enterprise_collab_room_messages g
          where g.room_id = ${tables.rooms.id}
        ), 0)`,
      })
      .from(tables.rooms)
      .where(where),
  );
  const rooms: AdminProjectRoom[] = [];
  for (const row of rows) {
    const mapped = mapRoomRow(row);
    if (mapped) rooms.push(mapped);
  }
  return sortRooms(rooms);
}

async function queryMembers(tenantId: string, projectId: string): Promise<AdminProjectMember[]> {
  const { db, tables } = await openDb();
  const where = and(
    eq(tables.rooms.tenantId, tenantId),
    eq(tables.rooms.projectId, projectId),
    eq(tables.rooms.roomKind, "main"),
    isNull(tables.members.leftAt),
  );
  if (!where) return [];
  const joined = and(eq(tables.members.roomId, tables.rooms.id), eq(tables.members.tenantId, tenantId));
  if (!joined) return [];
  const rows = await readRows(
    db
      .select({
        member_type: tables.members.memberType,
        member_id: tables.members.memberId,
        display_name: tables.members.displayName,
        room_role: tables.members.roomRole,
      })
      .from(tables.members)
      .innerJoin(tables.rooms, joined)
      .where(where),
  );
  return dedupeMembers(
    rows.map((row) => ({
      member_type: String(row.member_type ?? ""),
      member_id: String(row.member_id ?? ""),
      display_name: String(row.display_name ?? ""),
      room_role: String(row.room_role ?? "member"),
    })),
  );
}

async function queryRoomRef(
  tenantId: string,
  roomId: string,
): Promise<{ project_id: string | null; room_kind: string } | null> {
  const { db, tables } = await openDb();
  const where = and(eq(tables.rooms.tenantId, tenantId), eq(tables.rooms.id, roomId));
  if (!where) return null;
  const rows = await readRows(
    db
      .select({
        project_id: tables.rooms.projectId,
        room_kind: tables.rooms.roomKind,
      })
      .from(tables.rooms)
      .where(where)
      .limit(1),
  );
  const row = rows[0];
  if (!row) return null;
  return {
    project_id: row.project_id == null || row.project_id === "" ? null : String(row.project_id),
    room_kind: String(row.room_kind ?? ""),
  };
}

async function queryMessages(
  tenantId: string,
  roomId: string,
  opts?: { afterSeq?: number; limit?: number },
): Promise<AdminProjectMessage[]> {
  const { db, tables } = await openDb();
  const parts: SQL[] = [eq(tables.messages.roomId, roomId), eq(tables.messages.tenantId, tenantId)];
  if (opts?.afterSeq != null) parts.push(gt(tables.messages.seq, opts.afterSeq));
  const where = and(...parts);
  if (!where) return [];
  const limit = Math.min(200, Math.max(1, opts?.limit ?? 50));
  const rows = await readRows(
    db
      .select({
        seq: tables.messages.seq,
        sender_type: tables.messages.senderType,
        sender_name: tables.messages.senderName,
        content: tables.messages.content,
        metadata: tables.messages.metadata,
        created_at: tables.messages.createdAt,
      })
      .from(tables.messages)
      .where(where)
      .orderBy(asc(tables.messages.seq))
      .limit(limit),
  );
  return rows.map(mapMessageRow);
}

async function memberProjectIdsFor(tenantId: string, vis: ProjectVisibility): Promise<Set<string>> {
  if (vis.mode !== "self") return new Set();
  const { db, tables } = await openDb();
  const where = adminProjectScopeSql(tables.projects, tenantId, vis);
  const rows = await readRows(db.select({ id: tables.projects.id }).from(tables.projects).where(where));
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.id != null && row.id !== "") ids.add(String(row.id));
  }
  return ids;
}

export async function listAdminProjects(
  tenantId: string,
  vis: ProjectVisibility,
  filter?: { q?: string; limit?: number; offset?: number },
): Promise<{ items: AdminProjectRow[]; total: number }> {
  if (fixture) {
    return finalizeProjectList(fixtureProjects(tenantId), vis, fixtureMemberIds(tenantId, vis), filter);
  }
  const [rows, memberProjectIds] = await Promise.all([
    queryProjectRows(tenantId, vis, filter?.q),
    memberProjectIdsFor(tenantId, vis),
  ]);
  return finalizeProjectList(rows, vis, memberProjectIds, filter);
}

export async function getAdminProject(
  tenantId: string,
  projectId: string,
  vis: ProjectVisibility,
): Promise<AdminProjectDetail | null> {
  if (fixture) {
    const project = fixtureProjects(tenantId).find((row) => row.id === projectId);
    if (!project || !projectMatchesVisibility(project, vis, fixtureMemberIds(tenantId, vis))) return null;
    const rooms = sortRooms(
      (fixture.rooms ?? [])
        .filter((row) => row.tenant_id === tenantId && row.project_id === projectId)
        .map(({ tenant_id: _tenant, project_id: _project, ...room }) => room),
    );
    const members = dedupeMembers(
      (fixture.members ?? [])
        .filter((row) => row.tenant_id === tenantId && row.project_id === projectId)
        .map(({ tenant_id: _tenant, project_id: _project, ...member }) => member),
    );
    return { project, rooms, members };
  }
  const rows = await queryProjectRows(tenantId, vis, undefined, projectId);
  const project = rows[0];
  const memberProjectIds = await memberProjectIdsFor(tenantId, vis);
  if (!project || !projectMatchesVisibility(project, vis, memberProjectIds)) return null;
  const [rooms, members] = await Promise.all([
    queryRooms(tenantId, projectId),
    queryMembers(tenantId, projectId),
  ]);
  return { project, rooms, members };
}

function fixtureMessages(
  tenantId: string,
  roomId: string,
  opts?: { afterSeq?: number; limit?: number },
): AdminProjectMessage[] {
  if (!fixture) return [];
  const limit = Math.min(200, Math.max(1, opts?.limit ?? 50));
  return fixture.messages
    .filter((row) => row.tenant_id === tenantId && row.room_id === roomId)
    .filter((row) => (opts?.afterSeq == null ? true : row.seq > opts.afterSeq))
    .sort((a, b) => a.seq - b.seq)
    .slice(0, limit)
    .map(({ tenant_id: _tenant, room_id: _room, ...message }) => message);
}

export async function listAdminProjectMessages(
  tenantId: string,
  roomId: string,
  vis: ProjectVisibility,
  opts?: { afterSeq?: number; limit?: number },
): Promise<{ messages: AdminProjectMessage[] }> {
  const room = fixture
    ? fixture.rooms.find((row) => row.tenant_id === tenantId && row.id === roomId) ?? null
    : await queryRoomRef(tenantId, roomId);
  if (!room?.project_id) throw new ProjectNotFoundError();
  const memberProjectIds = fixture ? fixtureMemberIds(tenantId, vis) : await memberProjectIdsFor(tenantId, vis);
  const projects = fixture
    ? fixtureProjects(tenantId)
    : await queryProjectRows(tenantId, vis, undefined, room.project_id);
  const visible = projects.some(
    (project) => project.id === room.project_id && projectMatchesVisibility(project, vis, memberProjectIds),
  );
  if (!visible) throw new ProjectNotFoundError();
  if (room.room_kind === "direct" && !directMessagesAllowed(vis)) throw new ProjectForbiddenError();
  const messages = fixture
    ? fixtureMessages(tenantId, roomId, opts)
    : await queryMessages(tenantId, roomId, opts);
  return { messages };
}
