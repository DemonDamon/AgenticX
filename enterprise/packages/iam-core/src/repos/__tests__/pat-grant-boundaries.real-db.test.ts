import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import { createAdminUser, getAdminUser, resetUserPassword, softDeleteUser, updateAdminUser, upsertUserByEmail } from "../users";
import { createCustomRole, duplicateRole, ensureSystemRoles, getRoleByCode, updateRole } from "../roles";
import { createPat } from "../../pat-service";
import { __resetDatabaseForTests } from "../../db";
import type { AdministrativeActor } from "../privilege-guard";

const url = process.env.IAM_PRIVILEGE_TEST_DATABASE_URL;
const dialect = url?.startsWith("mysql:") ? "mysql" : "postgresql";
const tenantId = ulid();
const otherTenantId = ulid();
const foreignDepartmentId = ulid();
const foreignOrgId = ulid();
const system: AdministrativeActor = { kind: "system", tenantId, purpose: "bootstrap" };
let actor: Extract<AdministrativeActor, { kind: "user" }>;
let ownerId: string;
let ordinaryId: string;
let query: (sql: string, args?: unknown[]) => Promise<any[]>;
let close: () => Promise<void>;

// Only a separately configured disposable database is used; DATABASE_URL alone never opts in.
describe.skipIf(!url)(`personal access token grants (${dialect}, real database)`, () => {
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
      for (const table of ["api_tokens", "user_roles", "users", "roles", "audit_events", "tenants"]) {
        await query(`DELETE FROM ${table} WHERE ${table === "tenants" ? "id" : "tenant_id"} = ?`, [tenantId]);
      }
      await query("DELETE FROM departments WHERE tenant_id=?", [otherTenantId]);
      await query("DELETE FROM organizations WHERE tenant_id=?", [otherTenantId]);
      await query("DELETE FROM tenants WHERE id=?", [otherTenantId]);
    }
    await __resetDatabaseForTests();
    if (close) await close();
  });

  it("derives token department and creator from current same-tenant accounts", async () => {
    const token = await createPat({ tenantId, actor, userId: ordinaryId, createdBy: "forged-creator", deptId: "forged-department", name: "Limited token", scopes: ["workspace:chat", "desktop:managed"] });
    expect(token.record.deptId).toBeNull();
    expect(token.record.createdBy).toBe(actor.userId);
    await expect(createPat({ tenantId, actor, userId: ownerId, createdBy: actor.userId, name: "Forbidden", scopes: ["workspace:chat"] })).rejects.toThrow(/forbidden/);
    await expect(createPat({ tenantId: "other", actor, userId: ordinaryId, createdBy: actor.userId, name: "Forbidden" })).rejects.toThrow(/same-tenant/);
  });

  it("does not propagate a legacy foreign department into a new token", async () => {
    await query("UPDATE users SET dept_id=? WHERE tenant_id=? AND id=?", [foreignDepartmentId, tenantId, ordinaryId]);
    await expect(createPat({ tenantId, actor, userId: ordinaryId, createdBy: actor.userId, name: "Foreign department" })).rejects.toThrow(/department/);
    expect(await query("SELECT id FROM api_tokens WHERE tenant_id=? AND name=?", [tenantId, "Foreign department"])).toHaveLength(0);
    await query("UPDATE users SET dept_id=NULL WHERE tenant_id=? AND id=?", [tenantId, ordinaryId]);
  });

  it("preserves current managed-agent scopes but rejects arbitrary PAT privileges", async () => {
    const owner = await getAdminUser(tenantId, ownerId);
    const ownerActor: AdministrativeActor = { kind: "user", tenantId, userId: ownerId, scopes: owner!.scopes };
    const result = await createPat({ tenantId, actor: ownerActor, userId: ownerId, createdBy: ownerId, name: "Managed token", scopes: ["ma:agents:read", "ma:sessions:write"] });
    expect(result.record.scopes).toEqual(["ma:agents:read", "ma:sessions:write"]);
    await expect(createPat({ tenantId, actor: ownerActor, userId: ordinaryId, createdBy: ownerId, name: "Too much", scopes: ["ma:admin"] })).rejects.toThrow(/forbidden/);
    await expect(createPat({ tenantId, actor: ownerActor, userId: ownerId, createdBy: ownerId, name: "Invalid", scopes: ["role:manage"] })).rejects.toThrow(/unsupported/);
  });
});
