import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import { createAdminUser, getAdminUser, resetUserPassword, softDeleteUser, updateAdminUser, upsertUserByEmail } from "../users";
import { createCustomRole, duplicateRole, ensureSystemRoles, getRoleByCode, updateRole } from "../roles";
import { __resetDatabaseForTests } from "../../db";
import type { AdministrativeActor } from "../privilege-guard";

const url = process.env.IAM_PRIVILEGE_TEST_DATABASE_URL;
const dialect = url?.startsWith("mysql:") ? "mysql" : "postgresql";
const tenantId = ulid();
const otherTenantId = ulid();
const foreignDepartmentId = ulid();
const foreignOrgId = ulid();
const ownOrgId = ulid();
const ownDepartmentId = ulid();
const system: AdministrativeActor = { kind: "system", tenantId, purpose: "bootstrap" };
let actor: Extract<AdministrativeActor, { kind: "user" }>;
let ownerId: string;
let ordinaryId: string;
let query: (sql: string, args?: unknown[]) => Promise<any[]>;
let close: () => Promise<void>;

// Only a separately configured disposable database is used; DATABASE_URL alone never opts in.
describe.skipIf(!url)(`administrative privilege writes (${dialect}, real database)`, () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.DATABASE_DIALECT = dialect;
    if (dialect === "mysql") {
      const mysql = await import("mysql2/promise");
      const connection = await mysql.createConnection(url!);
      query = async (sql, args = []) => (await connection.query(sql, args))[0] as any[];
      close = () => connection.end();
    } else {
      const { Client } = await import("pg");
      const client = new Client({ connectionString: url });
      await client.connect();
      query = async (sql, args = []) => {
        let i = 0;
        return (await client.query(sql.replace(/\?/g, () => `$${++i}`), args)).rows;
      };
      close = () => client.end();
    }
    await query("INSERT INTO tenants (id,code,name) VALUES (?,?,?)", [tenantId, tenantId, "Synthetic test tenant"]);
    await query("INSERT INTO tenants (id,code,name) VALUES (?,?,?)", [otherTenantId, otherTenantId, "Synthetic foreign tenant"]);
    await query("INSERT INTO organizations (id,tenant_id,name) VALUES (?,?,?)", [foreignOrgId, otherTenantId, "Synthetic org"]);
    await query("INSERT INTO departments (id,tenant_id,org_id,name,path) VALUES (?,?,?,?,?)", [foreignDepartmentId, otherTenantId, foreignOrgId, "Foreign", "/foreign/"]);
    await query("INSERT INTO organizations (id,tenant_id,name) VALUES (?,?,?)", [ownOrgId, tenantId, "Synthetic own org"]);
    await query("INSERT INTO departments (id,tenant_id,org_id,name,path) VALUES (?,?,?,?,?)", [ownDepartmentId, tenantId, ownOrgId, "Own", "/own/"]);
    await ensureSystemRoles(tenantId);
    const owner = await createAdminUser({ tenantId, actor: system, email: "owner@example.invalid", displayName: "Owner", roleCodes: ["super_admin"], defaultOrgId: null, initialPassword: "Synthetic-fixture-724!" });
    ownerId = owner.user.id;
    const limitedScopes = ["user:create", "user:update", "user:delete", "role:create", "role:update", "role:delete", "role:manage", "workspace:chat", "user:read"];
    await createCustomRole({ tenantId, actor: system, code: "limited", name: "Limited administrator", scopes: limitedScopes });
    const limited = await createAdminUser({ tenantId, actor: system, email: "limited@example.invalid", displayName: "Limited", roleCodes: ["limited"], defaultOrgId: null, initialPassword: "Synthetic-fixture-724!" });
    actor = { kind: "user", tenantId, userId: limited.user.id, scopes: limited.user.scopes };
    const ordinary = await createAdminUser({ tenantId, actor: system, email: "member@example.invalid", displayName: "Member", roleCodes: ["member"], defaultOrgId: null, initialPassword: "Synthetic-fixture-724!" });
    ordinaryId = ordinary.user.id;
  }, 30000);

  afterAll(async () => {
    if (query) {
      for (const table of ["api_tokens", "user_roles", "users", "roles", "audit_events", "departments", "organizations", "tenants"]) {
        await query(`DELETE FROM ${table} WHERE ${table === "tenants" ? "id" : "tenant_id"} = ?`, [tenantId]);
      }
      await query("DELETE FROM departments WHERE tenant_id=?", [otherTenantId]);
      await query("DELETE FROM organizations WHERE tenant_id=?", [otherTenantId]);
      await query("DELETE FROM tenants WHERE id=?", [otherTenantId]);
    }
    await __resetDatabaseForTests();
    if (close) await close();
  });

  it("rejects wildcard creation before any user row is written, and permits ordinary creation", async () => {
    await expect(createAdminUser({ tenantId, actor, email: "escalated@example.invalid", displayName: "Forbidden", roleCodes: ["super_admin"], defaultOrgId: null })).rejects.toThrow(/forbidden/);
    expect(await query("SELECT id FROM users WHERE tenant_id=? AND email=?", [tenantId, "escalated@example.invalid"])).toHaveLength(0);
    const created = await createAdminUser({ tenantId, actor, email: "allowed@example.invalid", displayName: "Allowed", roleCodes: ["member"], defaultOrgId: null });
    expect(created.user.scopes).toContain("workspace:chat");
  });

  it("cannot mutate, reset, delete or bulk-upsert a higher privileged account", async () => {
    await expect(updateAdminUser(tenantId, ownerId, { status: "disabled" }, { actor, defaultOrgId: null })).rejects.toThrow(/forbidden/);
    await expect(resetUserPassword({ tenantId, actor, userId: ownerId })).rejects.toThrow(/forbidden/);
    await expect(softDeleteUser(tenantId, ownerId, actor)).rejects.toThrow(/forbidden/);
    await expect(upsertUserByEmail({ tenantId, actor, email: "owner@example.invalid", displayName: "Changed", deptId: null, passwordHash: "must-not-be-written", roleCodes: ["member"], defaultOrgId: null })).rejects.toThrow(/forbidden/);
    expect((await getAdminUser(tenantId, ownerId))?.status).toBe("active");
    expect((await getAdminUser(tenantId, ownerId))?.displayName).toBe("Owner");
  });

  it("does not turn create-only bulk access into update access", async () => {
    const createOnly = { ...actor, scopes: actor.scopes.filter((scope) => scope !== "user:update") };
    await expect(upsertUserByEmail({ tenantId, actor: createOnly, email: "member@example.invalid", displayName: "Forbidden update", deptId: null, passwordHash: "must-not-be-written", roleCodes: ["member"], defaultOrgId: null })).rejects.toThrow(/capability/);
    expect((await getAdminUser(tenantId, ordinaryId))?.displayName).toBe("Member");
  });

  it("checks retained privileges before restoring a deleted account", async () => {
    await query("UPDATE users SET is_deleted=?, deleted_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=?", [true, tenantId, ownerId]);
    await expect(createAdminUser({ tenantId, actor, email: "owner@example.invalid", displayName: "Restored", roleCodes: ["member"], defaultOrgId: null })).rejects.toThrow(/forbidden/);
    await query("UPDATE users SET is_deleted=?, deleted_at=NULL WHERE tenant_id=? AND id=?", [false, tenantId, ownerId]);
  });

  it("rejects foreign departments before create, update, restore and bulk upsert", async () => {
    const input = { tenantId, actor, email: "foreign-dept@example.invalid", displayName: "Forbidden", deptId: foreignDepartmentId, roleCodes: ["member"], defaultOrgId: null };
    await expect(createAdminUser(input)).rejects.toThrow(/department/);
    expect(await query("SELECT id FROM users WHERE tenant_id=? AND email=?", [tenantId, input.email])).toHaveLength(0);
    await expect(updateAdminUser(tenantId, ordinaryId, { deptId: foreignDepartmentId }, { actor, defaultOrgId: null })).rejects.toThrow(/department/);
    await expect(upsertUserByEmail({ ...input, email: "member@example.invalid", passwordHash: "must-not-be-written" })).rejects.toThrow(/department/);
    expect((await getAdminUser(tenantId, ordinaryId))?.deptId).toBeNull();
    const restored = await createAdminUser({ ...input, actor: system, deptId: null });
    await softDeleteUser(tenantId, restored.user.id, actor);
    await expect(createAdminUser(input)).rejects.toThrow(/department/);
    expect(await getAdminUser(tenantId, restored.user.id)).toBeNull();
  });

  it("permits same-tenant departments and nullable updates", async () => {
    const created = await createAdminUser({ tenantId, actor, email: "own-dept@example.invalid", displayName: "Own department", deptId: ownDepartmentId, roleCodes: ["member"], defaultOrgId: ownOrgId });
    expect(created.user.deptId).toBe(ownDepartmentId);
    expect((await updateAdminUser(tenantId, ordinaryId, { deptId: ownDepartmentId }, { actor, defaultOrgId: ownOrgId })).deptId).toBe(ownDepartmentId);
    expect((await updateAdminUser(tenantId, ordinaryId, { deptId: null }, { actor, defaultOrgId: ownOrgId })).deptId).toBeNull();
  });

  it("does not let role creation, copying, or editing bypass grant ceilings", async () => {
    await expect(createCustomRole({ tenantId, actor, code: "escalated", name: "Forbidden", scopes: ["*"] })).rejects.toThrow(/forbidden/);
    const source = await getRoleByCode(tenantId, "super_admin");
    await expect(duplicateRole({ tenantId, actor, sourceId: source!.id, newCode: "copied_owner", newName: "Forbidden" })).rejects.toThrow(/forbidden/);
    const high = await createCustomRole({ tenantId, actor: system, code: "high", name: "High", scopes: ["sso:manage"] });
    await expect(updateRole({ tenantId, actor, id: high.id, name: "Changed" })).rejects.toThrow(/forbidden/);
    expect((await getRoleByCode(tenantId, "high"))?.name).toBe("High");
  });

});
