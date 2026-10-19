import { afterEach, describe, expect, it } from "vitest";
import { enterpriseProjects as pgProjects } from "@agenticx/db-schema";
import { enterpriseProjects as mysqlProjects } from "@agenticx/db-schema/mysql";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  __setAdminProjectsFixtureForTests,
  adminProjectScopeSql,
  getAdminProject,
  listAdminProjectMessages,
  listAdminProjects,
  ProjectForbiddenError,
  ProjectNotFoundError,
  type AdminProjectRoom,
  type AdminProjectsFixture,
  type AdminProjectRow,
  type ProjectVisibility,
} from "../projects";

const TENANT = "t1";
const USER = "u1";

function project(id: string, deptId: string | null, tenantId = TENANT): AdminProjectRow & { tenant_id: string } {
  return {
    tenant_id: tenantId,
    id,
    name: id,
    owner_user_id: "owner",
    owner_name: "Owner",
    dept_id: deptId,
    dept_name: deptId,
    member_count: 2,
    room_count: 2,
    message_count: 3,
    last_activity_at: "2026-10-19T00:00:00.000Z",
    created_at: "2026-10-18T00:00:00.000Z",
    archived_at: null,
  };
}

function room(
  id: string,
  projectId: string,
  roomKind: AdminProjectRoom["room_kind"],
  tenantId = TENANT,
): AdminProjectsFixture["rooms"][number] {
  return {
    tenant_id: tenantId,
    project_id: projectId,
    id,
    title: id,
    room_kind: roomKind,
    parent_room_id: roomKind === "sub" ? "main" : null,
    member_count: 2,
    message_count: 2,
    last_seq: 2,
  };
}

function fixture(): AdminProjectsFixture {
  return {
    projects: [project("p1", "d1"), project("p2", "d1"), project("p3", "d2"), project("p4", "d1", "other-tenant")],
    memberships: [
      { tenant_id: TENANT, project_id: "p2", user_id: USER },
      { tenant_id: TENANT, project_id: "p3", user_id: USER },
    ],
    rooms: [
      room("p1-main", "p1", "main"),
      room("p1-direct", "p1", "direct"),
      room("p2-direct", "p2", "direct"),
      room("p2-main", "p2", "main"),
    ],
    members: [
      {
        tenant_id: TENANT,
        project_id: "p1",
        member_type: "human",
        member_id: "owner",
        display_name: "Owner",
        room_role: "owner",
      },
    ],
    messages: [
      {
        tenant_id: TENANT,
        room_id: "p1-direct",
        seq: 1,
        sender_type: "human",
        sender_name: "Ada",
        content: "hello",
        metadata: null,
        created_at: "2026-10-19T00:00:00.000Z",
      },
      {
        tenant_id: TENANT,
        room_id: "p1-direct",
        seq: 2,
        sender_type: "human",
        sender_name: "Bea",
        content: "hi",
        metadata: { kind: "merge_back", source_title: "小群" },
        created_at: "2026-10-19T00:01:00.000Z",
      },
      {
        tenant_id: TENANT,
        room_id: "p1-main",
        seq: 1,
        sender_type: "human",
        sender_name: "Ada",
        content: "main",
        metadata: null,
        created_at: "2026-10-19T00:00:00.000Z",
      },
    ],
  };
}

function compiled(dialect: "pg" | "mysql", vis: ProjectVisibility, q?: string) {
  const projects = dialect === "pg" ? pgProjects : mysqlProjects;
  const statement = adminProjectScopeSql(projects, TENANT, vis, q);
  const query = dialect === "pg" ? new PgDialect().sqlToQuery(statement) : new MySqlDialect().sqlToQuery(statement);
  return { sql: query.sql.toLowerCase(), params: query.params };
}

describe("admin project visibility", () => {
  afterEach(() => {
    __setAdminProjectsFixtureForTests(null);
  });

  it("dept mode returns only projects in that department", async () => {
    __setAdminProjectsFixtureForTests(fixture());
    const result = await listAdminProjects(TENANT, { mode: "dept", deptId: "d1" });
    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.id).sort()).toEqual(["p1", "p2"]);
  });

  it("self mode returns only projects the user belongs to", async () => {
    __setAdminProjectsFixtureForTests(fixture());
    const result = await listAdminProjects(TENANT, { mode: "self", userId: USER });
    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.id).sort()).toEqual(["p2", "p3"]);
  });

  it("dept mode still lists a direct room but cannot read its messages", async () => {
    __setAdminProjectsFixtureForTests(fixture());
    const detail = await getAdminProject(TENANT, "p1", { mode: "dept", deptId: "d1" });
    expect(detail?.rooms.some((item) => item.room_kind === "direct" && item.id === "p1-direct")).toBe(true);
    await expect(
      listAdminProjectMessages(TENANT, "p1-direct", { mode: "dept", deptId: "d1" }),
    ).rejects.toBeInstanceOf(ProjectForbiddenError);
    await expect(
      listAdminProjectMessages(TENANT, "p2-direct", { mode: "self", userId: USER }),
    ).rejects.toBeInstanceOf(ProjectForbiddenError);
  });

  it("full visibility can read direct messages in seq order", async () => {
    __setAdminProjectsFixtureForTests(fixture());
    const all = await listAdminProjectMessages(TENANT, "p1-direct", { mode: "all" });
    expect(all.messages.map((item) => item.seq)).toEqual([1, 2]);
    const page = await listAdminProjectMessages(TENANT, "p1-direct", { mode: "all" }, { afterSeq: 1, limit: 10 });
    expect(page.messages.map((item) => item.content)).toEqual(["hi"]);
    const main = await listAdminProjectMessages(TENANT, "p1-main", { mode: "dept", deptId: "d1" });
    expect(main.messages.map((item) => item.content)).toEqual(["main"]);
  });

  it("hides projects outside the department and missing rooms", async () => {
    __setAdminProjectsFixtureForTests(fixture());
    expect(await getAdminProject(TENANT, "p3", { mode: "dept", deptId: "d1" })).toBeNull();
    await expect(
      listAdminProjectMessages(TENANT, "missing", { mode: "all" }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(
      listAdminProjectMessages(TENANT, "p2-direct", { mode: "dept", deptId: "d1" }),
    ).rejects.toBeInstanceOf(ProjectForbiddenError);
  });

  it.each(["pg", "mysql"] as const)("encodes %s visibility in SQL", (dialect) => {
    const dept = compiled(dialect, { mode: "dept", deptId: "d1" });
    expect(dept.sql).toContain("dept_id");
    expect(dept.sql).not.toContain("member_id");
    expect(dept.params).toContain("d1");

    const self = compiled(dialect, { mode: "self", userId: USER });
    expect(self.sql).toContain("member_id");
    expect(self.sql).toContain("left_at");
    expect(self.sql).toContain("human");
    expect(self.params).toContain(USER);

    const all = compiled(dialect, { mode: "all" }, "Alpha");
    expect(all.sql).not.toContain("dept_id");
    expect(all.sql).not.toContain("member_id");
    expect(all.sql).toContain("like");
    expect(all.params).toContain(TENANT);
    expect(all.params).toContain("%alpha%");
  });
});
