#!/usr/bin/env node
/**
 * MySQL seed — same logical rows as db-seed.mjs (default tenant / admin / super_admin).
 */
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";

const databaseUrl = process.env.DATABASE_URL ?? "mysql://agenticx:agenticx@127.0.0.1:3306/agenticx";

const ids = {
  tenant: "01J00000000000000000000001",
  org: "01J00000000000000000000002",
  dept: "01J00000000000000000000003",
  user: "01J00000000000000000000004",
  role: "01J00000000000000000000005",
};

function parseMysqlUrl(url) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, "") || "agenticx",
    timezone: "Z",
    charset: "utf8mb4",
  };
}

async function main() {
  const conn = await mysql.createConnection(parseMysqlUrl(databaseUrl));
  await conn.query("SET time_zone = '+00:00'");
  const seedPassword = process.env.AUTH_DEV_OWNER_PASSWORD?.trim() || "ChangeMe_Dev14!Aa";
  const passwordHash = await bcrypt.hash(seedPassword, 12);

  try {
    await conn.beginTransaction();

    await conn.query(
      `INSERT INTO tenants (id, code, name, plan)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), plan = VALUES(plan), updated_at = UTC_TIMESTAMP(6)`,
      [ids.tenant, "default", "Default Tenant", "enterprise"],
    );

    await conn.query(
      `INSERT INTO organizations (id, tenant_id, name)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE updated_at = UTC_TIMESTAMP(6)`,
      [ids.org, ids.tenant, "总部"],
    );

    await conn.query(
      `INSERT INTO departments (id, tenant_id, org_id, parent_id, name, path)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = UTC_TIMESTAMP(6)`,
      [ids.dept, ids.tenant, ids.org, null, "平台研发部", "/总部/平台研发部/"],
    );

    await conn.query(
      `INSERT INTO users (id, tenant_id, dept_id, email, display_name, password_hash, status, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         password_hash = VALUES(password_hash),
         status = VALUES(status),
         is_deleted = 0,
         deleted_at = NULL,
         updated_at = UTC_TIMESTAMP(6)`,
      [ids.user, ids.tenant, ids.dept, "admin@agenticx.local", "Seed Admin", passwordHash, "active"],
    );

    await conn.query(
      `INSERT INTO roles (id, tenant_id, code, name, scopes, immutable)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         scopes = VALUES(scopes),
         immutable = VALUES(immutable),
         updated_at = UTC_TIMESTAMP(6)`,
      [ids.role, ids.tenant, "super_admin", "Super Admin", JSON.stringify(["*"]), true],
    );

    await conn.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id, scope_org_id, scope_dept_id)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         scope_org_id = VALUES(scope_org_id),
         scope_dept_id = VALUES(scope_dept_id),
         updated_at = UTC_TIMESTAMP(6)`,
      [ids.tenant, ids.user, ids.role, ids.org, ids.dept],
    );

    await conn.commit();
    console.log("Seed complete (mysql): default tenant + admin + super_admin.");
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exitCode = 1;
});
